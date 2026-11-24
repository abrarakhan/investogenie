#!/usr/bin/env python3
"""Incrementally synchronize authoritative US statements from SEC EDGAR.

SEC Company Facts is the primary source for reported 10-Q/10-K values. Yahoo
remains a supplemental source for sector, market cap and price-derived ratios.
Monetary values are normalized to USD millions before persistence.
"""

from __future__ import annotations

import argparse
import os
import time
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import psycopg2
import requests

from stock_fundamentals_sync import CompanyState, pct_change, upsert_reports

DEFAULT_DATABASE_URL = "postgresql://localhost:5432/investogenie"
PROVIDER = "SEC_EDGAR"
USD_MILLION = 1_000_000
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SEC_USER_AGENT = os.getenv(
    "SEC_EDGAR_USER_AGENT",
    "InvestoGenie Research contact@investogenie.app",
)
SEC_HEADERS = {"User-Agent": SEC_USER_AGENT, "Accept-Encoding": "gzip, deflate"}
FORMS = {"10-Q", "10-Q/A", "10-K", "10-K/A"}

INCOME_TAGS = {
    "revenue": ("RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"),
    "net_profit": ("NetIncomeLoss", "ProfitLoss"),
    "operating_profit": ("OperatingIncomeLoss",),
    "ebit": ("OperatingIncomeLoss",),
    "gross_profit": ("GrossProfit",),
    "ebitda": ("EarningsBeforeInterestTaxesDepreciationAndAmortization",),
    "interest_expense": ("InterestExpenseNonOperating", "InterestExpense"),
    "income_tax_expense": ("IncomeTaxExpenseBenefit",),
    "diluted_average_shares": ("WeightedAverageNumberOfDilutedSharesOutstanding",),
    "eps": ("EarningsPerShareDiluted", "EarningsPerShareBasic"),
}
BALANCE_TAGS = {
    "total_assets": ("Assets",),
    "current_assets": ("AssetsCurrent",),
    "cash_and_equivalents": ("CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"),
    "inventory": ("InventoryNet",),
    "receivables": ("AccountsReceivableNetCurrent",),
    "total_liabilities": ("Liabilities",),
    "current_liabilities": ("LiabilitiesCurrent",),
    "accounts_payable": ("AccountsPayableCurrent",),
    "total_debt": ("LongTermDebtAndFinanceLeaseObligations", "LongTermDebt"),
    "short_term_debt": ("ShortTermBorrowings", "ShortTermDebtCurrent"),
    "long_term_debt": ("LongTermDebtNoncurrent",),
    "shareholders_equity": ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "retained_earnings": ("RetainedEarningsAccumulatedDeficit",),
    "goodwill": ("Goodwill",),
    "intangible_assets": ("FiniteLivedIntangibleAssetsNet", "IndefiniteLivedIntangibleAssetsExcludingGoodwill"),
}
CASH_TAGS = {
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
    "capital_expenditure": ("PaymentsToAcquirePropertyPlantAndEquipment",),
    "dividends_paid": ("PaymentsOfDividends", "PaymentsOfDividendsCommonStock"),
    "share_repurchase": ("PaymentsForRepurchaseOfCommonStock",),
    "share_issuance": ("ProceedsFromStockOptionsExercised", "ProceedsFromIssuanceOfCommonStock"),
    "debt_issuance": ("ProceedsFromIssuanceOfLongTermDebt",),
    "debt_repayment": ("RepaymentsOfLongTermDebt",),
    "investing_cash_flow": ("NetCashProvidedByUsedInInvestingActivities",),
    "financing_cash_flow": ("NetCashProvidedByUsedInFinancingActivities",),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--symbols", help="Comma-separated US tickers")
    parser.add_argument("--limit", type=int, help="Maximum companies; omit for all")
    parser.add_argument("--stale-days", type=int, default=7)
    parser.add_argument("--sleep", type=float, default=0.12, help="Delay per SEC request; keep >=0.11")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def requested_symbols(raw: str | None) -> set[str] | None:
    return {part.strip().upper() for part in raw.split(",") if part.strip()} if raw else None


ERROR_TRANSIENT = "TRANSIENT_PROVIDER"
ERROR_NOT_AVAILABLE = "NOT_AVAILABLE"
ERROR_UNSUPPORTED = "UNSUPPORTED_FILING"
ERROR_DATA_VALIDATION = "DATA_VALIDATION"
ERROR_INTERNAL = "INTERNAL_ERROR"

TRANSIENT_BACKOFF_HOURS = (1, 3, 6, 24)


class SyncFailure(Exception):
    def __init__(self, error_code: str, message: str, retry_after_seconds: int | None = None):
        super().__init__(message)
        self.error_code = error_code
        self.retry_after_seconds = retry_after_seconds


def parse_retry_after(header: str | None, now: datetime | None = None) -> int | None:
    if not header:
        return None
    raw = header.strip()
    if not raw:
        return None
    if raw.isdigit():
        return int(raw)
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        ref = now or datetime.now(timezone.utc)
        return max(0, int((dt - ref).total_seconds()))
    except (TypeError, ValueError):
        return None


def compute_next_retry(
    error_code: str,
    failure_count: int,
    retry_after_seconds: int | None = None,
    now: datetime | None = None,
) -> datetime:
    ref = now or datetime.now(timezone.utc)
    count = max(1, failure_count)
    if error_code == ERROR_TRANSIENT:
        if retry_after_seconds is not None:
            clamped = max(300, min(6 * 3600, retry_after_seconds))
            return ref + timedelta(seconds=clamped)
        hours = TRANSIENT_BACKOFF_HOURS[min(count - 1, len(TRANSIENT_BACKOFF_HOURS) - 1)]
        return ref + timedelta(hours=hours)
    if error_code in (ERROR_NOT_AVAILABLE, ERROR_UNSUPPORTED):
        return ref + timedelta(days=30)
    # DATA_VALIDATION / INTERNAL_ERROR: retry next scheduled run for failures 1-2, then cap at 24h.
    if count <= 2:
        return ref
    return ref + timedelta(hours=24)


def classify_exception(exc: Exception) -> SyncFailure:
    if isinstance(exc, SyncFailure):
        return exc
    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return SyncFailure(ERROR_TRANSIENT, str(exc))
    if isinstance(exc, requests.HTTPError):
        resp = exc.response
        status = resp.status_code if resp is not None else None
        if status == 404:
            return SyncFailure(ERROR_NOT_AVAILABLE, f"SEC dataset not found (HTTP 404): {exc}")
        if status == 429:
            retry_after = parse_retry_after(resp.headers.get("Retry-After") if resp is not None else None)
            return SyncFailure(ERROR_TRANSIENT, f"SEC rate limited (HTTP 429): {exc}", retry_after_seconds=retry_after)
        if status is not None and status >= 500:
            return SyncFailure(ERROR_TRANSIENT, f"SEC server error (HTTP {status}): {exc}")
        return SyncFailure(ERROR_DATA_VALIDATION, f"Unexpected SEC HTTP {status}: {exc}")
    if isinstance(exc, (ValueError, KeyError, TypeError)):
        return SyncFailure(ERROR_DATA_VALIDATION, str(exc))
    return SyncFailure(ERROR_INTERNAL, f"{type(exc).__name__}: {exc}")


def fetch_json(url: str, retries: int) -> dict[str, Any]:
    last_failure: SyncFailure | None = None
    attempts = max(1, retries)
    for attempt in range(attempts):
        try:
            response = requests.get(url, headers=SEC_HEADERS, timeout=60)
            if response.status_code == 404:
                raise SyncFailure(ERROR_NOT_AVAILABLE, f"SEC company facts not found (HTTP 404) for {url}")
            if response.status_code == 429:
                retry_after = parse_retry_after(response.headers.get("Retry-After"))
                failure = SyncFailure(ERROR_TRANSIENT, f"SEC throttled (HTTP 429) for {url}", retry_after_seconds=retry_after)
                if retry_after is not None and retry_after > 10:
                    raise failure
                last_failure = failure
                if attempt + 1 < attempts:
                    time.sleep(retry_after if retry_after is not None and retry_after > 0 else 2 ** attempt)
                    continue
                raise failure
            if response.status_code >= 500:
                last_failure = SyncFailure(ERROR_TRANSIENT, f"SEC server error (HTTP {response.status_code}) for {url}")
                if attempt + 1 < attempts:
                    time.sleep(2 ** attempt)
                    continue
                raise last_failure
            response.raise_for_status()
            return response.json()
        except SyncFailure:
            raise
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_failure = SyncFailure(ERROR_TRANSIENT, f"SEC network failure: {exc}")
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
                continue
            raise last_failure
        except Exception as exc:
            raise classify_exception(exc) from exc
    raise last_failure or SyncFailure(ERROR_TRANSIENT, f"SEC request failed after {attempts} attempts")


def fetch_ticker_map(retries: int) -> dict[str, tuple[int, str]]:
    payload = fetch_json(SEC_TICKERS_URL, retries)
    return {
        str(row["ticker"]).upper(): (int(row["cik_str"]), str(row.get("title") or row["ticker"]))
        for row in payload.values()
    }


def load_companies(conn, ticker_map: dict[str, tuple[int, str]], requested: set[str] | None,
                   limit: int | None, stale_days: int, force: bool) -> list[tuple[CompanyState, int, int]]:
    tickers = sorted(set(ticker_map) & requested) if requested else sorted(ticker_map)
    if not tickers:
        return []
    params: list[Any] = [tickers]
    freshness = ""
    if not force:
        params.append(datetime.now(timezone.utc) - timedelta(days=max(0, stale_days)))
        freshness = """and (s.last_success_at is null or s.last_success_at < %s)
          and (s.last_error is null or s.next_retry_at is null or s.next_retry_at <= now())"""
    limit_sql = ""
    if limit is not None:
        params.append(max(1, limit))
        limit_sql = "limit %s"
    with conn.cursor() as cur:
        cur.execute(
            f"""
            select a.ticker,array_agg(a.id::text order by a.exchange),s.last_success_at,coalesce(s.failure_count,0)
              from public.assets a
              left join public.fundamentals_sync_state s
                on s.country='US' and s.ticker=a.ticker and s.provider='{PROVIDER}'
             where a.country='US' and a.asset_class='STOCK' and coalesce(a.is_active,true)
               and a.exchange in ('NASDAQ','NYSE','AMEX','NYSEARCA','NYSEAMERICAN')
               and a.ticker=any(%s) {freshness}
             group by a.ticker,s.last_success_at,s.last_attempt_at,s.failure_count
             order by s.last_attempt_at nulls first,a.ticker
             {limit_sql}
            """,
            params,
        )
        return [
            (CompanyState(row[0], row[0], tuple(row[1]), row[2], False), ticker_map[row[0]][0], int(row[3] or 0))
            for row in cur.fetchall()
        ]


def _unit_rows(facts: dict[str, Any], tag: str, units: tuple[str, ...]) -> list[dict[str, Any]]:
    concept = facts.get("us-gaap", {}).get(tag, {})
    available = concept.get("units", {})
    for unit in units:
        if unit in available:
            return [row for row in available[unit] if row.get("form") in FORMS]
    return []


def _duration_days(row: dict[str, Any]) -> int | None:
    try:
        return (date.fromisoformat(row["end"]) - date.fromisoformat(row["start"])).days
    except (KeyError, TypeError, ValueError):
        return None


def _report_type(row: dict[str, Any], instant: bool) -> str | None:
    form = str(row.get("form", ""))
    if form.startswith("10-K"):
        days = _duration_days(row)
        return "ANNUAL" if instant or (days is not None and 250 <= days <= 450) else None
    if form.startswith("10-Q"):
        days = _duration_days(row)
        return "QUARTERLY" if instant or (days is not None and 60 <= days <= 120) else None
    return None


def _best_values(facts: dict[str, Any], aliases: dict[str, tuple[str, ...]], instant: bool) -> dict[tuple[date, str], dict[str, Any]]:
    reports: dict[tuple[date, str], dict[str, Any]] = {}
    for field, tags in aliases.items():
        units = ("USD/shares",) if field == "eps" else (("shares",) if field == "diluted_average_shares" else ("USD",))
        # Select aliases per reporting period. Taxonomy transitions are common:
        # choosing the first concept with any company history can otherwise hide
        # all newer periods that use a different valid concept.
        chosen: dict[tuple[date, str], tuple[int, date, float, dict[str, Any]]] = {}
        for priority, tag in enumerate(tags):
            for row in _unit_rows(facts, tag, units):
                report_type = _report_type(row, instant)
                try:
                    end = date.fromisoformat(row["end"])
                    value = float(row["val"])
                    filed = date.fromisoformat(row["filed"])
                except (KeyError, TypeError, ValueError):
                    continue
                if report_type is None:
                    continue
                key = (end, report_type)
                previous = chosen.get(key)
                if previous is None or priority < previous[0] or (priority == previous[0] and filed >= previous[1]):
                    chosen[key] = (priority, filed, value, row)
        for key, (_, filed, value, row) in chosen.items():
            report = reports.setdefault(key, {"_filed": {}, "fy": row.get("fy"), "fp": row.get("fp")})
            report[field] = value
            report["_filed"][field] = filed
            report["fy"] = row.get("fy") or report.get("fy")
            report["fp"] = row.get("fp") or report.get("fp")
    return reports


def build_company_statements(payload: dict[str, Any]) -> tuple[list[dict], list[dict], list[dict]]:
    facts = payload.get("facts", {})
    income = _best_values(facts, INCOME_TAGS, instant=False)
    balance = _best_values(facts, BALANCE_TAGS, instant=True)
    cash = _best_values(facts, CASH_TAGS, instant=False)
    keys = sorted(set(income) | set(balance))
    reports: list[dict] = []
    balances: list[dict] = []
    cash_flows: list[dict] = []
    for end, report_type in keys:
        inc = income.get((end, report_type), {})
        bal = balance.get((end, report_type), {})
        total_assets = bal.get("total_assets")
        current_liabilities = bal.get("current_liabilities")
        capital_employed = total_assets - current_liabilities if total_assets is not None and current_liabilities is not None else None
        ebit = inc.get("ebit")
        fiscal = f"{inc.get('fp') or bal.get('fp') or ('FY' if report_type == 'ANNUAL' else 'Q')} {inc.get('fy') or bal.get('fy') or end.year}"
        reports.append({
            "period_end_date": end, "report_type": report_type, "fiscal_period": fiscal,
            **{field: (inc.get(field) / USD_MILLION if field not in {"eps", "diluted_average_shares"} and inc.get(field) is not None else inc.get(field)) for field in INCOME_TAGS},
            "capital_employed": capital_employed / USD_MILLION if capital_employed is not None else None,
            "roce": round(ebit / capital_employed * 100, 4) if ebit is not None and capital_employed not in (None, 0) else None,
        })
        balance_row = {"period_end_date": end, "report_type": report_type}
        for field in BALANCE_TAGS:
            balance_row[field] = bal.get(field) / USD_MILLION if bal.get(field) is not None else None
        if balance_row["total_debt"] is None:
            debt = [bal.get("short_term_debt"), bal.get("long_term_debt")]
            balance_row["total_debt"] = sum(value for value in debt if value is not None) / USD_MILLION if any(value is not None for value in debt) else None
        equity = bal.get("shareholders_equity")
        intangibles = (bal.get("goodwill") or 0) + (bal.get("intangible_assets") or 0)
        balance_row["net_tangible_assets"] = (equity - intangibles) / USD_MILLION if equity is not None else None
        balances.append(balance_row)
    reports.sort(key=lambda row: (row["report_type"], row["period_end_date"]))
    for report in reports:
        comparable = [
            row for row in reports
            if row["report_type"] == report["report_type"]
            and 320 <= (report["period_end_date"] - row["period_end_date"]).days <= 410
        ]
        prior = min(
            comparable,
            key=lambda row: abs((report["period_end_date"] - row["period_end_date"]).days - 365),
            default=None,
        )
        report["profit_variance_yoy"] = pct_change(report.get("net_profit"), prior.get("net_profit") if prior else None)
        report["sales_variance_yoy"] = pct_change(report.get("revenue"), prior.get("revenue") if prior else None)
    for (end, report_type), values in cash.items():
        row = {"period_end_date": end, "report_type": report_type}
        for field in CASH_TAGS:
            value = values.get(field)
            if field in {"capital_expenditure", "dividends_paid", "share_repurchase", "debt_repayment"} and value is not None:
                value = -abs(value)
            row[field] = value / USD_MILLION if value is not None else None
        ocf, capex = row.get("operating_cash_flow"), row.get("capital_expenditure")
        row["free_cash_flow"] = ocf + capex if ocf is not None and capex is not None else None
        cash_flows.append(row)
    return reports, balances, cash_flows


def record_state(
    conn,
    ticker: str,
    error: str | None,
    error_code: str | None = None,
    next_retry_at: datetime | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """insert into public.fundamentals_sync_state
                 (country,ticker,provider,last_attempt_at,last_success_at,last_error,error_code,next_retry_at,failure_count)
               values ('US',%s,%s,now(),case when %s is null then now() end,%s,%s,%s,case when %s is null then 0 else 1 end)
               on conflict(country,ticker,provider) do update set
                 last_attempt_at=excluded.last_attempt_at,
                 last_success_at=case when excluded.last_error is null then now() else fundamentals_sync_state.last_success_at end,
                 last_error=excluded.last_error,
                 error_code=case when excluded.last_error is null then null else excluded.error_code end,
                 next_retry_at=case when excluded.last_error is null then null else excluded.next_retry_at end,
                 failure_count=case when excluded.last_error is null then 0 else fundamentals_sync_state.failure_count + 1 end""",
            (ticker, PROVIDER, error, error, error_code, next_retry_at, error),
        )
    conn.commit()


def remove_overlapping_fallback_rows(conn, state: CompanyState, reports: list[dict]) -> int:
    """Remove Yahoo's calendar-quarter duplicate when SEC reports the fiscal date.

    Providers commonly label the same quarter a few days apart (AAPL: 26 Sep
    in the 10-K versus 30 Sep at Yahoo). Keeping both makes the fallback row win
    latest-period queries. The narrow ±10-day match cannot remove a different
    fiscal quarter.
    """
    dates = [row["period_end_date"] for row in reports]
    types = [row["report_type"] for row in reports]
    if not dates:
        return 0
    removed = 0
    with conn.cursor() as cur:
        for table in ("asset_financial_reports", "asset_balance_sheets", "asset_cash_flow_statements"):
            cur.execute(
                f"""with authoritative(period_end_date,report_type) as (
                       select * from unnest(%s::date[],%s::text[])
                     )
                     delete from public.{table} fallback
                      using authoritative sec
                      where fallback.asset_id=any(%s::uuid[])
                        and fallback.source is distinct from %s
                        and fallback.report_type=sec.report_type
                        and abs(fallback.period_end_date-sec.period_end_date) <= 10""",
                (dates, types, list(state.asset_ids), PROVIDER),
            )
            removed += cur.rowcount
    conn.commit()
    return removed


def main() -> None:
    args = parse_args()
    if args.sleep < 0.11:
        raise SystemExit("--sleep must be at least 0.11 seconds to respect SEC request limits")
    ticker_map = fetch_ticker_map(args.retries)
    conn = psycopg2.connect(args.database_url)
    try:
        companies = load_companies(conn, ticker_map, requested_symbols(args.symbols), args.limit, args.stale_days, args.force)
        print(f"Synchronizing SEC EDGAR fundamentals for {len(companies)} US companies.")
        succeeded = failed = reports_written = 0
        for index, (state, cik, prior_failures) in enumerate(companies, 1):
            try:
                payload = fetch_json(SEC_COMPANY_FACTS_URL.format(cik=cik), args.retries)
                reports, balances, cash_flows = build_company_statements(payload)
                if not reports:
                    raise SyncFailure(ERROR_UNSUPPORTED, "no usable 10-Q/10-K US-GAAP facts")
                if not args.dry_run:
                    counts = upsert_reports(conn, state, reports, balances, cash_flows, {}, monetary_divisor=USD_MILLION, default_currency="USD", source=PROVIDER)
                    removed = remove_overlapping_fallback_rows(conn, state, reports)
                    record_state(conn, state.ticker, None)
                    reports_written += counts[0]
                else:
                    removed = 0
                succeeded += 1
                print(f"[{index}/{len(companies)}] {state.ticker}: {len(reports)} reports, {removed} fallback duplicates removed")
            except Exception as exc:
                conn.rollback()
                failed += 1
                failure = classify_exception(exc)
                retry_at = compute_next_retry(failure.error_code, prior_failures + 1, failure.retry_after_seconds)
                if not args.dry_run:
                    record_state(conn, state.ticker, str(failure)[:1000], failure.error_code, retry_at)
                print(f"[{index}/{len(companies)}] {state.ticker}: ERROR [{failure.error_code}] {failure} (next retry {retry_at.isoformat()})")
            if index < len(companies):
                time.sleep(args.sleep)
        print(f"SEC EDGAR fundamentals sync complete: companies={len(companies)} succeeded={succeeded} failed={failed} reports_written={reports_written}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
