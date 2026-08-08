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
PROVIDER = "YAHOO"
ERROR_RETRY_DAYS = 7


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
    retry_before = datetime.now(timezone.utc) - timedelta(days=ERROR_RETRY_DAYS)
    freshness = ""
    if not force:
        params.append(retry_before)
        filters.append("(s.last_error is null or s.last_attempt_at < %s)")
        params.append(stale_before)
        freshness = """having not bool_and(
          f.asset_id is not null and f.balance_covered and f.cashflow_covered
        ) or min(f.last_updated) < %s"""
    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"

    with conn.cursor() as cur:
        cur.execute(
            f"""
            with coverage as (
              select f.asset_id, max(f.updated_at) last_updated,
                     exists(select 1 from public.asset_balance_sheets b where b.asset_id=f.asset_id) balance_covered,
                     exists(select 1 from public.asset_cash_flow_statements c where c.asset_id=f.asset_id) cashflow_covered
                from public.asset_financial_reports f
               group by f.asset_id
            )
            select a.ticker,
                   array_agg(a.id::text order by case when a.exchange='NSE' then 0 else 1 end),
                   bool_or(a.exchange='NSE') has_nse,
                   min(f.last_updated) last_updated,
                   bool_and(f.asset_id is not null and f.balance_covered and f.cashflow_covered) fully_covered
              from public.assets a
              left join coverage f on f.asset_id=a.id
              left join public.fundamentals_sync_state s
                on s.country='IN' and s.ticker=a.ticker and s.provider='YAHOO'
             where {' and '.join(filters)}
             group by a.ticker
             {freshness}
             -- Drain known companies before probing never-covered catalog rows.
             -- BSE includes funds/debt instruments that were historically typed STOCK;
             -- unsupported probes are then kept out of the next batch by sync state.
             order by bool_or(a.exchange='NSE') desc,
                      (min(f.last_updated) is null), min(f.last_updated), a.ticker
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


def record_sync_state(conn, ticker: str, error: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into public.fundamentals_sync_state
              (country, ticker, provider, last_attempt_at, last_success_at, last_error)
            values ('IN', %s, %s, now(), case when %s is null then now() end, %s)
            on conflict (country, ticker, provider) do update set
              last_attempt_at=excluded.last_attempt_at,
              last_success_at=case
                when excluded.last_error is null then excluded.last_success_at
                else public.fundamentals_sync_state.last_success_at
              end,
              last_error=excluded.last_error
            """,
            (ticker, PROVIDER, error, error),
        )
    conn.commit()


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
        gross_profit = statement_value(income, column, ("Gross Profit",))
        ebitda = statement_value(income, column, ("EBITDA", "Normalized EBITDA"))
        interest_expense = statement_value(
            income,
            column,
            ("Interest Expense", "Interest Expense Non Operating"),
        )
        income_tax_expense = statement_value(income, column, ("Tax Provision",))
        diluted_average_shares = statement_value(
            income,
            column,
            ("Diluted Average Shares", "Basic Average Shares"),
        )
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
                "gross_profit": gross_profit / monetary_divisor if gross_profit is not None else None,
                "ebitda": ebitda / monetary_divisor if ebitda is not None else None,
                "interest_expense": interest_expense / monetary_divisor if interest_expense is not None else None,
                "income_tax_expense": income_tax_expense / monetary_divisor if income_tax_expense is not None else None,
                "diluted_average_shares": diluted_average_shares,
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


def build_balance_sheets(
    frame: pd.DataFrame,
    report_type: str,
    monetary_divisor: float = CRORE,
) -> list[dict]:
    fields = {
        "total_assets": ("Total Assets",),
        "current_assets": ("Current Assets",),
        "cash_and_equivalents": (
            "Cash Cash Equivalents And Short Term Investments",
            "Cash And Cash Equivalents",
        ),
        "inventory": ("Inventory",),
        "receivables": ("Receivables", "Accounts Receivable", "Gross Accounts Receivable"),
        "total_liabilities": ("Total Liabilities Net Minority Interest",),
        "current_liabilities": ("Current Liabilities",),
        "accounts_payable": ("Payables And Accrued Expenses", "Payables", "Accounts Payable"),
        "total_debt": ("Total Debt",),
        "short_term_debt": ("Current Debt And Capital Lease Obligation", "Current Debt"),
        "long_term_debt": ("Long Term Debt And Capital Lease Obligation", "Long Term Debt"),
        "shareholders_equity": ("Stockholders Equity", "Common Stock Equity"),
        "retained_earnings": ("Retained Earnings",),
        "goodwill": ("Goodwill",),
        "intangible_assets": ("Other Intangible Assets", "Goodwill And Other Intangible Assets"),
        "net_tangible_assets": ("Net Tangible Assets",),
    }
    rows: list[dict] = []
    for column in frame.columns:
        row = {
            "period_end_date": pd.Timestamp(column).date(),
            "report_type": report_type,
        }
        for key, names in fields.items():
            value = statement_value(frame, column, names)
            row[key] = value / monetary_divisor if value is not None else None
        if any(row[key] is not None for key in fields):
            rows.append(row)
    return rows


def build_cash_flows(
    frame: pd.DataFrame,
    report_type: str,
    monetary_divisor: float = CRORE,
) -> list[dict]:
    fields = {
        "operating_cash_flow": ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities"),
        "capital_expenditure": ("Capital Expenditure",),
        "free_cash_flow": ("Free Cash Flow",),
        "dividends_paid": ("Cash Dividends Paid", "Common Stock Dividend Paid"),
        "share_repurchase": ("Repurchase Of Capital Stock",),
        "share_issuance": ("Issuance Of Capital Stock", "Common Stock Issuance"),
        "debt_issuance": ("Issuance Of Debt", "Long Term Debt Issuance"),
        "debt_repayment": ("Repayment Of Debt", "Long Term Debt Payments"),
        "investing_cash_flow": ("Investing Cash Flow", "Cash Flow From Continuing Investing Activities"),
        "financing_cash_flow": ("Financing Cash Flow", "Cash Flow From Continuing Financing Activities"),
    }
    rows: list[dict] = []
    for column in frame.columns:
        row = {
            "period_end_date": pd.Timestamp(column).date(),
            "report_type": report_type,
        }
        for key, names in fields.items():
            value = statement_value(frame, column, names)
            row[key] = value / monetary_divisor if value is not None else None
        if any(row[key] is not None for key in fields):
            rows.append(row)
    return rows


def fetch_company(
    state: CompanyState,
    retries: int,
    monetary_divisor: float = CRORE,
) -> tuple[list[dict], list[dict], list[dict], dict]:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            ticker = yf.Ticker(state.yahoo_symbol)
            quarterly_income = ticker.quarterly_income_stmt
            quarterly_balance = ticker.quarterly_balance_sheet
            quarterly_cash_flow = ticker.quarterly_cashflow
            annual_income = ticker.income_stmt
            annual_balance = ticker.balance_sheet
            annual_cash_flow = ticker.cashflow
            quarterly = build_reports(
                quarterly_income,
                quarterly_balance,
                "QUARTERLY",
                monetary_divisor,
            )
            annual = build_reports(
                annual_income,
                annual_balance,
                "ANNUAL",
                monetary_divisor,
            )
            balance_sheets = build_balance_sheets(
                quarterly_balance,
                "QUARTERLY",
                monetary_divisor,
            ) + build_balance_sheets(annual_balance, "ANNUAL", monetary_divisor)
            cash_flows = build_cash_flows(
                quarterly_cash_flow,
                "QUARTERLY",
                monetary_divisor,
            ) + build_cash_flows(annual_cash_flow, "ANNUAL", monetary_divisor)
            info = ticker.get_info()
            if not quarterly and not annual:
                raise ValueError("no financial statements returned")
            return quarterly + annual, balance_sheets, cash_flows, info
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
    balance_sheets: list[dict],
    cash_flows: list[dict],
    info: dict,
    monetary_divisor: float = CRORE,
    default_currency: str = "INR",
    source: str = "YAHOO_FINANCE",
) -> tuple[int, int, int]:
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
                    report["gross_profit"],
                    report["ebitda"],
                    report["interest_expense"],
                    report["income_tax_expense"],
                    report["diluted_average_shares"],
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
               revenue,net_profit,operating_profit,ebit,gross_profit,ebitda,
               interest_expense,income_tax_expense,diluted_average_shares,capital_employed,
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
              gross_profit=excluded.gross_profit,
              ebitda=excluded.ebitda,
              interest_expense=excluded.interest_expense,
              income_tax_expense=excluded.income_tax_expense,
              diluted_average_shares=excluded.diluted_average_shares,
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
        balance_rows = [
            (
                asset_id, row["period_end_date"], row["report_type"], currency,
                row["total_assets"], row["current_assets"], row["cash_and_equivalents"],
                row["inventory"], row["receivables"], row["total_liabilities"],
                row["current_liabilities"], row["accounts_payable"], row["total_debt"],
                row["short_term_debt"], row["long_term_debt"], row["shareholders_equity"],
                row["retained_earnings"], row["goodwill"], row["intangible_assets"],
                row["net_tangible_assets"], source,
            )
            for asset_id in state.asset_ids
            for row in balance_sheets
        ]
        if balance_rows:
            execute_values(
                cur,
                """
                insert into public.asset_balance_sheets
                  (asset_id,period_end_date,report_type,currency,total_assets,current_assets,
                   cash_and_equivalents,inventory,receivables,total_liabilities,current_liabilities,
                   accounts_payable,total_debt,short_term_debt,long_term_debt,shareholders_equity,
                   retained_earnings,goodwill,intangible_assets,net_tangible_assets,source)
                values %s
                on conflict (asset_id,period_end_date,report_type) do update set
                  currency=excluded.currency,total_assets=excluded.total_assets,
                  current_assets=excluded.current_assets,cash_and_equivalents=excluded.cash_and_equivalents,
                  inventory=excluded.inventory,receivables=excluded.receivables,
                  total_liabilities=excluded.total_liabilities,current_liabilities=excluded.current_liabilities,
                  accounts_payable=excluded.accounts_payable,total_debt=excluded.total_debt,
                  short_term_debt=excluded.short_term_debt,long_term_debt=excluded.long_term_debt,
                  shareholders_equity=excluded.shareholders_equity,retained_earnings=excluded.retained_earnings,
                  goodwill=excluded.goodwill,intangible_assets=excluded.intangible_assets,
                  net_tangible_assets=excluded.net_tangible_assets,source=excluded.source,updated_at=now()
                """,
                balance_rows,
                page_size=500,
            )
        cash_rows = [
            (
                asset_id, row["period_end_date"], row["report_type"], currency,
                row["operating_cash_flow"], row["capital_expenditure"], row["free_cash_flow"],
                row["dividends_paid"], row["share_repurchase"], row["share_issuance"],
                row["debt_issuance"], row["debt_repayment"], row["investing_cash_flow"],
                row["financing_cash_flow"], source,
            )
            for asset_id in state.asset_ids
            for row in cash_flows
        ]
        if cash_rows:
            execute_values(
                cur,
                """
                insert into public.asset_cash_flow_statements
                  (asset_id,period_end_date,report_type,currency,operating_cash_flow,
                   capital_expenditure,free_cash_flow,dividends_paid,share_repurchase,
                   share_issuance,debt_issuance,debt_repayment,investing_cash_flow,
                   financing_cash_flow,source)
                values %s
                on conflict (asset_id,period_end_date,report_type) do update set
                  currency=excluded.currency,operating_cash_flow=excluded.operating_cash_flow,
                  capital_expenditure=excluded.capital_expenditure,free_cash_flow=excluded.free_cash_flow,
                  dividends_paid=excluded.dividends_paid,share_repurchase=excluded.share_repurchase,
                  share_issuance=excluded.share_issuance,debt_issuance=excluded.debt_issuance,
                  debt_repayment=excluded.debt_repayment,investing_cash_flow=excluded.investing_cash_flow,
                  financing_cash_flow=excluded.financing_cash_flow,source=excluded.source,updated_at=now()
                """,
                cash_rows,
                page_size=500,
            )
        # Sector lives on the instrument, not the periodic report; update once.
        if sector:
            cur.execute(
                "update public.assets set sector=%s where id=any(%s::uuid[])",
                (sector, list(state.asset_ids)),
            )
    conn.commit()
    return len(rows), len(balance_rows), len(cash_rows)


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
        balance_rows_written = 0
        cash_flow_rows_written = 0
        failed = 0
        for index, state in enumerate(companies, 1):
            print(f"[{index}/{len(companies)}] {state.ticker} ({state.yahoo_symbol})")
            try:
                reports, balance_sheets, cash_flows, info = fetch_company(state, max(1, args.retries))
                counts = (0, 0, 0) if args.dry_run else upsert_reports(
                    conn, state, reports, balance_sheets, cash_flows, info
                )
                if not args.dry_run:
                    record_sync_state(conn, state.ticker, None)
                reports_written += counts[0]
                balance_rows_written += counts[1]
                cash_flow_rows_written += counts[2]
                covered += 1
                print(
                    f"   {'validated' if args.dry_run else 'upserted'} "
                    f"{len(reports)} reports, {len(balance_sheets)} balance sheets and "
                    f"{len(cash_flows)} cash flows across {len(state.asset_ids)} listing(s)"
                )
            except Exception as exc:
                conn.rollback()
                failed += 1
                if not args.dry_run:
                    record_sync_state(conn, state.ticker, str(exc)[:2000])
                print(f"   ERROR: {exc}")
            if index < len(companies) and args.sleep > 0:
                time.sleep(args.sleep)

        print(
            "Fundamentals sync complete: "
            f"companies={len(companies)} covered={covered} "
            f"reports_written={reports_written} balance_rows={balance_rows_written} "
            f"cash_flow_rows={cash_flow_rows_written} failed={failed}"
        )
        if failed:
            raise SystemExit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
