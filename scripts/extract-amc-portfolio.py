#!/usr/bin/env python3
"""Extract stock-level weights from AMC monthly portfolio disclosures.

The script accepts CSV/TSV/TXT/XLS/XLSX/PDF files and emits JSON:
{"rows": [{"stock_name": str, "isin": str|null, "ticker": str|null, "weight_percentage": float}]}

It intentionally uses broad header aliases because Indian AMC disclosure files vary
substantially across fund houses and across months.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


def norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def clean(value: Any) -> str:
    text = str(value or "").replace("\xa0", " ").strip()
    return re.sub(r"\s+", " ", text)


def to_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "-"}:
        return None
    text = text.replace("₹", "").replace("rs.", "").replace("rs", "")
    text = text.replace(",", "").replace("%", "").strip()
    text = re.sub(r"^\((.*)\)$", r"-\1", text)
    try:
        return float(text)
    except ValueError:
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        return float(match.group(0)) if match else None


NAME_KEYS = {
    "name", "security", "security_name", "company", "company_name", "issuer", "issuer_name",
    "instrument", "instrument_name", "holding", "holdings", "stock", "stock_name", "equity",
    "equity_name", "name_of_the_instrument", "name_of_instrument", "scrip", "scrip_name",
}
ISIN_KEYS = {"isin", "isin_code", "isin_no", "isin_number"}
TICKER_KEYS = {"symbol", "nse_symbol", "ticker", "bse_code", "scrip_code", "nse_code"}
WEIGHT_KEYS = {
    "weight", "weights", "weight_percentage", "percentage", "percent", "holding_percent",
    "holding_percentage", "net_assets", "net_asset", "of_net_assets", "percent_to_nav",
    "percentage_to_nav", "to_nav", "nav", "assets", "portfolio_percent", "portfolio_percentage",
    "percentage_of_net_assets", "in_aum", "aum", "pct", "market_value_percent",
}

EXCLUDE_NAME_RE = re.compile(
    r"\b(total|sub\s*total|grand\s*total|cash|treps|reverse\s+repo|repo|net\s+current|"
    r"margin|collateral|t[- ]?bill|treasury|g[- ]?sec|government\s+security|goi|"
    r"certificate\s+of\s+deposit|commercial\s+paper|cblo|derivative|futures?|options?)\b",
    re.I,
)


def is_probable_header(cells: list[str]) -> bool:
    keys = [norm(c) for c in cells]
    has_name = any(k in NAME_KEYS or any(part in k for part in ["security", "instrument", "company", "issuer"]) for k in keys)
    has_weight = any(k in WEIGHT_KEYS or ("weight" in k) or ("net_asset" in k) or ("portfolio" in k and "percent" in k) for k in keys)
    return has_name and has_weight


def find_col(headers: list[str], keys: set[str], fuzzy: list[str]) -> int | None:
    normalized = [norm(h) for h in headers]
    for idx, h in enumerate(normalized):
        if h in keys:
            return idx
    for idx, h in enumerate(normalized):
        if any(token in h for token in fuzzy):
            return idx
    return None


def row_cells(row: Any) -> list[str]:
    return [clean(v) for v in list(row)]


def parse_frame(frame: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    values = frame.fillna("").astype(str).values.tolist()
    header_idx = None
    for idx, raw in enumerate(values[:80]):
        cells = row_cells(raw)
        if is_probable_header(cells):
            header_idx = idx
            break
    if header_idx is None:
        return rows

    headers = row_cells(values[header_idx])
    name_col = find_col(headers, NAME_KEYS, ["security", "instrument", "company", "issuer", "stock", "scrip"])
    isin_col = find_col(headers, ISIN_KEYS, ["isin"])
    ticker_col = find_col(headers, TICKER_KEYS, ["symbol", "ticker", "scrip_code", "nse"])
    weight_col = find_col(headers, WEIGHT_KEYS, ["weight", "net_asset", "percent", "percentage", "portfolio"])
    if name_col is None or weight_col is None:
        return rows

    for raw in values[header_idx + 1 :]:
        cells = row_cells(raw)
        if len(cells) <= max(name_col, weight_col):
            continue
        stock_name = clean(cells[name_col])
        if not stock_name or len(stock_name) < 3 or EXCLUDE_NAME_RE.search(stock_name):
            continue
        weight = to_number(cells[weight_col])
        if weight is None or weight <= 0 or weight > 100:
            continue
        isin = None
        if isin_col is not None and len(cells) > isin_col:
            found = re.search(r"\bIN[A-Z0-9]{10}\b", cells[isin_col], re.I)
            isin = found.group(0).upper() if found else None
        ticker = None
        if ticker_col is not None and len(cells) > ticker_col:
            candidate = re.sub(r"[^A-Z0-9&.-]", "", cells[ticker_col].upper())
            if candidate and not re.fullmatch(r"\d+(?:\.\d+)?", candidate):
                ticker = candidate[:32]
        rows.append({
            "stock_name": stock_name,
            "isin": isin,
            "ticker": ticker,
            "weight_percentage": round(weight, 6),
        })
    return rows


def read_tabular(path: Path) -> list[dict[str, Any]]:
    import pandas as pd

    suffix = path.suffix.lower()
    frames = []
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=str)
        frames.extend(sheets.values())
    else:
        for kwargs in [
            {"sep": None, "engine": "python"},
            {"sep": ","},
            {"sep": "\t"},
        ]:
            try:
                frames.append(pd.read_csv(path, header=None, dtype=str, keep_default_na=False, **kwargs))
                break
            except Exception:
                continue
    out: list[dict[str, Any]] = []
    for frame in frames:
        out.extend(parse_frame(frame))
    return out


def read_pdf_text(path: Path, password: str = "") -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    if reader.is_encrypted:
        if not password:
            raise RuntimeError("password required")
        if not reader.decrypt(password):
            raise RuntimeError("password did not unlock pdf")
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_text(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    lines = [clean(line) for line in text.splitlines() if clean(line)]
    for line in lines:
        if EXCLUDE_NAME_RE.search(line):
            continue
        isin_match = re.search(r"\bIN[A-Z0-9]{10}\b", line, re.I)
        numbers = re.findall(r"-?\d+(?:,\d{2,3})*(?:\.\d+)?%?|-?\d+(?:\.\d+)?%?", line)
        if len(numbers) < 1:
            continue
        weight_token = None
        for token in reversed(numbers):
            n = to_number(token)
            if n is not None and 0 < n <= 100:
                weight_token = token
                break
        if not weight_token:
            continue
        weight = to_number(weight_token)
        before_weight = line[: line.rfind(weight_token)].strip()
        if isin_match:
            name_part = before_weight.replace(isin_match.group(0), " ")
        else:
            name_part = re.sub(r"\s+[-+]?\d[\d,.]*\s+.*$", "", before_weight)
        stock_name = clean(name_part)
        stock_name = re.sub(r"^(equity|listed|unlisted|name of instrument|security name)\s*[:\-]?\s*", "", stock_name, flags=re.I)
        if len(stock_name) < 3:
            continue
        out.append({
            "stock_name": stock_name[:180],
            "isin": isin_match.group(0).upper() if isin_match else None,
            "ticker": None,
            "weight_percentage": round(weight or 0, 6),
        })
    return out


def dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row.get("isin") or row.get("ticker") or norm(row.get("stock_name"))
        if not key:
            continue
        existing = merged.get(key)
        if existing:
            existing["weight_percentage"] = round(existing["weight_percentage"] + row["weight_percentage"], 6)
            if not existing.get("isin") and row.get("isin"):
                existing["isin"] = row["isin"]
            if not existing.get("ticker") and row.get("ticker"):
                existing["ticker"] = row["ticker"]
        else:
            merged[key] = row
    return sorted(merged.values(), key=lambda r: r["weight_percentage"], reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--password", default="")
    args = parser.parse_args()
    path = Path(args.file)
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            rows = parse_text(read_pdf_text(path, args.password))
        elif suffix in {".txt", ".text"}:
            rows = parse_text(path.read_text(errors="ignore"))
        else:
            rows = read_tabular(path)
            if not rows:
                rows = parse_text(path.read_text(errors="ignore"))
        rows = dedupe(rows)
        print(json.dumps({"rows": rows}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
