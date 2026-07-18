#!/usr/bin/env python3
"""Synchronize Indian stock fundamentals from Yahoo Finance into Postgres.

Distinct company tickers are fetched once and applied to matching NSE/BSE asset
rows. Quarterly and annual reports are stored in asset_financial_reports; the
existing latest_financials view then feeds Swing Candidates automatically.
"""

from __future__ import annotations

import argparse
import math
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
import yfinance as yf


DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
CRORE = 10_000_000


@dataclass(frozen=True)
class CompanyState:
    ticker: str
    yahoo_symbol: str
    asset_ids: tuple[str, ...]
    last_updated: datetime | None
    fully_covered: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL),
    )
    parser.add_argument("--symbols", help="Comma-separated NSE/BSE tickers")
    parser.add_argument("--limit", type=int, help="Maximum companies to process")
    parser.add_argument("--sleep", type=float, default=1.5, help="Provider delay per company")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--stale-days", type=int, default=7)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_companies(
    conn,
    requested: set[str] | None,
    limit: int | None,
    stale_days: int,
    force: bool,
) -> list[CompanyState]:
    params: list[object] = []
    filters = ["a.country='IN'", "a.asset_class='STOCK'", "a.exchange in ('NSE','BSE')"]
    if requested:
        filters.append("a.ticker = any(%s)")
        params.append(sorted(requested))

    stale_before = datetime.now(timezone.utc) - timedelta(days=max(0, stale_days))
    freshness = ""
    if not force:
        params.append(stale_before)
        freshness = "having not bool_and(f.asset_id is not null) or min(f.last_updated) < %s"
    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"

    with conn.cursor() as cur:
        cur.execute(
            f"""
            with coverage as (
              select asset_id, max(updated_at) last_updated
                from public.asset_financial_reports
               group by asset_id
            )
            select a.ticker,
                   array_agg(a.id::text order by case when a.exchange='NSE' then 0 else 1 end),
                   bool_or(a.exchange='NSE') has_nse,
                   min(f.last_updated) last_updated,
                   bool_and(f.asset_id is not null) fully_covered
              from public.assets a
              left join coverage f on f.asset_id=a.id
             where {' and '.join(filters)}
             group by a.ticker
             {freshness}
             order by coalesce(min(f.last_updated), timestamptz '1900-01-01'), a.ticker
             {limit_sql}
            """,
            params,
        )
        return [
            CompanyState(
                ticker=row[0],
                yahoo_symbol=f"{row[0]}.{'NS' if row[2] else 'BO'}",
                asset_ids=tuple(row[1]),
                last_updated=row[3],
                fully_covered=bool(row[4]),
            )
            for row in cur.fetchall()
        ]


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def statement_value(frame: pd.DataFrame, column, names: tuple[str, ...]) -> float | None:
    for name in names:
        if name in frame.index and column in frame.columns:
            value = finite(frame.at[name, column])
            if value is not None:
                return value
    return None


def nearest_balance_column(frame: pd.DataFrame, report_date) -> object | None:
    if frame.empty:
        return None
    target = pd.Timestamp(report_date)
    candidates = sorted(
        ((abs((pd.Timestamp(column) - target).days), column) for column in frame.columns),
        key=lambda item: item[0],
    )
    return candidates[0][1] if candidates and candidates[0][0] <= 120 else None


def pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / abs(previous) * 100, 4)


def build_reports(
    income: pd.DataFrame,
    balance: pd.DataFrame,
    report_type: str,
    monetary_divisor: float = CRORE,
) -> list[dict]:
    reports: list[dict] = []
    for column in income.columns:
        report_date = pd.Timestamp(column).date()
        balance_column = nearest_balance_column(balance, column)
        revenue = statement_value(income, column, ("Total Revenue", "Operating Revenue"))
        net_profit = statement_value(
            income,
            column,
            ("Net Income Common Stockholders", "Net Income"),
        )
        operating_profit = statement_value(income, column, ("Operating Income",))
        ebit = statement_value(income, column, ("EBIT", "Operating Income"))
        eps = statement_value(income, column, ("Diluted EPS", "Basic EPS"))

        total_assets = (
            statement_value(balance, balance_column, ("Total Assets",))
            if balance_column is not None
            else None
        )
        current_liabilities = (
            statement_value(balance, balance_column, ("Current Liabilities",))
            if balance_column is not None
            else None
        )
        capital_employed = (
            total_assets - current_liabilities
            if total_assets is not None and current_liabilities is not None
            else None
        )
        roce = (
            round(ebit / capital_employed * 100, 4)
            if ebit is not None and capital_employed not in (None, 0)
            else None
        )

        reports.append(
            {
                "period_end_date": report_date,
                "report_type": report_type,
                "fiscal_period": (
                    f"Q{((report_date.month - 1) // 3) + 1} {report_date.year}"
                    if report_type == "QUARTERLY"
                    else f"FY {report_date.year}"
                ),
                "revenue": revenue / monetary_divisor if revenue is not None else None,
                "net_profit": net_profit / monetary_divisor if net_profit is not None else None,
                "operating_profit": operating_profit / monetary_divisor if operating_profit is not None else None,
                "ebit": ebit / monetary_divisor if ebit is not None else None,
                "capital_employed": capital_employed / monetary_divisor if capital_employed is not None else None,
                "eps": eps,
                "roce": roce,
            }
        )

    reports.sort(key=lambda report: report["period_end_date"])
    for report in reports:
        target = report["period_end_date"].replace(year=report["period_end_date"].year - 1)
        prior = min(
            reports,
            key=lambda candidate: abs((candidate["period_end_date"] - target).days),
            default=None,
        )
        if prior is None or abs((prior["period_end_date"] - target).days) > 45:
            prior = None
        report["profit_variance_yoy"] = pct_change(
            report["net_profit"], prior["net_profit"] if prior else None
        )
        report["sales_variance_yoy"] = pct_change(
            report["revenue"], prior["revenue"] if prior else None
        )
    return reports


def fetch_company(
    state: CompanyState,
    retries: int,
    monetary_divisor: float = CRORE,
) -> tuple[list[dict], dict]:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            ticker = yf.Ticker(state.yahoo_symbol)
            quarterly = build_reports(
                ticker.quarterly_income_stmt,
                ticker.quarterly_balance_sheet,
                "QUARTERLY",
                monetary_divisor,
            )
            annual = build_reports(
                ticker.income_stmt,
                ticker.balance_sheet,
                "ANNUAL",
                monetary_divisor,
            )
            info = ticker.get_info()
            if not quarterly and not annual:
                raise ValueError("no financial statements returned")
            return quarterly + annual, info
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"fundamentals unavailable after {retries} attempts: {last_error}")


def load_quotes(conn, asset_ids: tuple[str, ...]) -> dict[str, float]:
    with conn.cursor() as cur:
        cur.execute(
            "select asset_id::text,price from public.latest_quotes where asset_id=any(%s::uuid[])",
            (list(asset_ids),),
        )
        return {row[0]: float(row[1]) for row in cur.fetchall()}


def upsert_reports(
    conn,
    state: CompanyState,
    reports: list[dict],
    info: dict,
    monetary_divisor: float = CRORE,
    default_currency: str = "INR",
    source: str = "YAHOO_FINANCE",
) -> int:
    quotes = load_quotes(conn, state.asset_ids)
    newest_quarter = max(
        (report["period_end_date"] for report in reports if report["report_type"] == "QUARTERLY"),
        default=None,
    )
    market_cap = finite(info.get("marketCap"))
    normalized_market_cap = market_cap / monetary_divisor if market_cap is not None else None
    provider_price = finite(info.get("currentPrice") or info.get("regularMarketPrice"))
    trailing_pe = finite(info.get("trailingPE"))
    currency = str(info.get("financialCurrency") or info.get("currency") or default_currency)

    # Screener fundamentals from yfinance .info. Normalise to the app's units:
    #   ROE                fraction -> percent
    #   Debt/Equity        yfinance reports debt/equity * 100 -> back to a ratio
    #   Dividend yield     trailingAnnualDividendYield is a reliable fraction -> percent
    #   Free cash flow     absolute currency units -> Rs. Cr / USD mn
    roe_raw = finite(info.get("returnOnEquity"))
    roe = round(roe_raw * 100, 4) if roe_raw is not None else None
    de_raw = finite(info.get("debtToEquity"))
    debt_to_equity = round(de_raw / 100, 4) if de_raw is not None else None
    dy_raw = finite(info.get("trailingAnnualDividendYield"))
    dividend_yield = round(dy_raw * 100, 4) if dy_raw is not None else None
    fcf_raw = finite(info.get("freeCashflow"))
    free_cash_flow = fcf_raw / monetary_divisor if fcf_raw is not None else None
    sector = (str(info.get("sector")).strip() or None) if info.get("sector") else None

    rows: list[tuple] = []
    for asset_id in state.asset_ids:
        cmp = quotes.get(asset_id, provider_price)
        for report in reports:
            latest = report["report_type"] == "QUARTERLY" and report["period_end_date"] == newest_quarter
            rows.append(
                (
                    asset_id,
                    report["period_end_date"],
                    report["report_type"],
                    report["fiscal_period"],
                    currency,
                    report["revenue"],
                    report["net_profit"],
                    report["operating_profit"],
                    report["ebit"],
                    report["capital_employed"],
                    report["eps"],
                    cmp if latest else None,
                    trailing_pe if latest else None,
                    normalized_market_cap if latest else None,
                    report["roce"],
                    roe if latest else None,
                    debt_to_equity if latest else None,
                    dividend_yield if latest else None,
                    free_cash_flow if latest else None,
                    report["profit_variance_yoy"],
                    report["sales_variance_yoy"],
                    source,
                )
            )

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.asset_financial_reports
              (asset_id,period_end_date,report_type,fiscal_period,currency,
               revenue,net_profit,operating_profit,ebit,capital_employed,
               eps,cmp,pe_ratio,market_cap,roce,
               roe,debt_to_equity,dividend_yield,free_cash_flow,
               profit_variance_yoy,sales_variance_yoy,source)
            values %s
            on conflict (asset_id,period_end_date,report_type) do update set
              fiscal_period=excluded.fiscal_period,
              currency=excluded.currency,
              revenue=excluded.revenue,
              net_profit=excluded.net_profit,
              operating_profit=excluded.operating_profit,
              ebit=excluded.ebit,
              capital_employed=excluded.capital_employed,
              eps=excluded.eps,
              cmp=excluded.cmp,
              pe_ratio=excluded.pe_ratio,
              market_cap=excluded.market_cap,
              roce=excluded.roce,
              roe=excluded.roe,
              debt_to_equity=excluded.debt_to_equity,
              dividend_yield=excluded.dividend_yield,
              free_cash_flow=excluded.free_cash_flow,
              profit_variance_yoy=excluded.profit_variance_yoy,
              sales_variance_yoy=excluded.sales_variance_yoy,
              source=excluded.source,
              updated_at=now()
            """,
            rows,
            page_size=500,
        )
        # Sector lives on the instrument, not the periodic report; update once.
        if sector:
            cur.execute(
                "update public.assets set sector=%s where id=any(%s::uuid[])",
                (sector, list(state.asset_ids)),
            )
    conn.commit()
    return len(rows)


def main() -> None:
    args = parse_args()
    requested = (
        {symbol.strip().upper() for symbol in args.symbols.split(",") if symbol.strip()}
        if args.symbols
        else None
    )
    conn = psycopg2.connect(args.database_url)
    try:
        companies = load_companies(
            conn,
            requested,
            args.limit,
            args.stale_days,
            args.force,
        )
        print(f"Identified {len(companies)} Indian companies requiring fundamentals.")
        covered = 0
        reports_written = 0
        failed = 0
        for index, state in enumerate(companies, 1):
            print(f"[{index}/{len(companies)}] {state.ticker} ({state.yahoo_symbol})")
            try:
                reports, info = fetch_company(state, max(1, args.retries))
                count = 0 if args.dry_run else upsert_reports(conn, state, reports, info)
                reports_written += count
                covered += 1
                print(
                    f"   {'validated' if args.dry_run else 'upserted'} "
                    f"{len(reports)} reports across {len(state.asset_ids)} listing(s)"
                )
            except Exception as exc:
                conn.rollback()
                failed += 1
                print(f"   ERROR: {exc}")
            if index < len(companies) and args.sleep > 0:
                time.sleep(args.sleep)

        print(
            "Fundamentals sync complete: "
            f"companies={len(companies)} covered={covered} "
            f"reports_written={reports_written} failed={failed}"
        )
        if failed:
            raise SystemExit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
