"""Versioned two-level equity classification (broad sector + narrow industry) and theme news matcher.

Each company is assigned at most one primary broad_sector and one primary industry_group,
with optional thematic tags for display. Funds/ETFs are excluded and NSE/NASDAQ/NYSE listings
take precedence over secondary exchanges so each company is counted once per group.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

TAXONOMY_VERSION = "v1"


@dataclass(frozen=True)
class IndustrySpec:
    key: str
    label: str
    parent_sector: str
    market: str  # "IN", "US", or "BOTH"
    tickers: frozenset[str]
    name_patterns: tuple[str, ...]
    news_keywords: tuple[str, ...]


INDIA_INDUSTRIES: tuple[IndustrySpec, ...] = (
    IndustrySpec(
        key="sugar_ethanol",
        label="Sugar & Ethanol",
        parent_sector="Consumer Defensive",
        market="IN",
        tickers=frozenset({
            "DHAMPURSUG", "UTTAMSUGAR", "RENUKA", "BAJAJHIND", "DWARKESH",
            "AVADHSUGAR", "BALRAMCHIN", "TRIVENI", "DALMIASUG", "EIDPARRY",
            "MAGADSUGAR", "BANNARISUG", "MAWANASUG", "KCP", "KCPSUGIND",
            "SAKHTISUG", "RANASUG", "UGARSUGAR", "VISHWARAJ", "KOTARISUG",
            "RAJSHREESUG", "DHAMPURBIO",
        }),
        name_patterns=(r"\bSUGAR\b", r"\bCHINI\b", r"\bETHANOL\b", r"\bDISTILLER"),
        news_keywords=("sugar", "isma", "sugarcane", "ethanol", "frp", "cane crushing"),
    ),
    IndustrySpec(
        key="paper_packaging",
        label="Paper & Packaging",
        parent_sector="Basic Materials",
        market="IN",
        tickers=frozenset({
            "WSTCSTPAPR", "JKPAPER", "TNPL", "ANDHRAPAP", "SESHAPAPER",
            "SATIA", "KUANTUM", "ORIENTPPR", "EMAMIPAP", "RUCHIRA",
            "STARPAPER", "NRAIL", "PUDUMJEE", "SHREYANIND",
        }),
        name_patterns=(r"\bPAPER\b", r"\bPULP\b", r"\bNEWSPRINT\b", r"\bPACKAGING\b"),
        news_keywords=("paper", "pulp", "packaging", "newsprint"),
    ),
    IndustrySpec(
        key="defence_aerospace",
        label="Defence & Aerospace",
        parent_sector="Industrials",
        market="IN",
        tickers=frozenset({
            "HAL", "BEL", "MAZDOCK", "COCHINSHIP", "GRSE", "BDL", "DATAPATTNS",
            "PARAS", "MTARTECH", "SOLARINDS", "BEML", "MIDHANI", "ASTRAMICRO",
            "IDEAFORGE", "ZEN", "ZENTEC", "DCXINDIA", "UNIMECH",
        }),
        name_patterns=(r"\bDEFENCE\b", r"\bDEFENSE\b", r"\bAEROSPACE\b", r"\bSHIPYARD", r"\bSHIPBUILD"),
        news_keywords=("defence", "defense", "drdo", "hal", "missile", "warship", "aerospace"),
    ),
    IndustrySpec(
        key="railways_wagons",
        label="Railways & Wagons",
        parent_sector="Industrials",
        market="IN",
        tickers=frozenset({
            "RVNL", "IRFC", "IRCON", "RAILTEL", "TITAGARH", "TEXRAIL", "JWL",
            "RITES", "CONCOR", "IRCTC", "KERNEX", "BHEL", "BEML", "ORIENTALTL",
        }),
        name_patterns=(r"\bRAIL\b", r"\bRAILWAY", r"\bWAGON\b", r"\bLOCOMOT"),
        news_keywords=("railway", "railways", "wagon", "vande bharat", "kavach"),
    ),
    IndustrySpec(
        key="psu_banks",
        label="PSU Banks",
        parent_sector="Financial Services",
        market="IN",
        tickers=frozenset({
            "SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "INDIANB",
            "BANKINDIA", "MAHABANK", "CENTRALBK", "IOB", "UCOBANK", "PSB",
        }),
        name_patterns=(),
        news_keywords=("psu bank", "public sector bank", "rbi", "credit growth", "repo rate"),
    ),
    IndustrySpec(
        key="private_banks",
        label="Private Banks",
        parent_sector="Financial Services",
        market="IN",
        tickers=frozenset({
            "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK",
            "FEDERALBNK", "IDFCFIRSTB", "BANDHANBNK", "AUBANK", "RBLBANK",
            "KARURVYSYA", "CUB", "SOUTHBANK", "DCBBANK", "TMB", "CSBBANK",
            "KTKBANK", "YESBANK",
        }),
        name_patterns=(r"\bBANK\b",),
        news_keywords=("bank", "rbi", "repo rate", "nim", "credit growth", "deposits"),
    ),
    IndustrySpec(
        key="nbfc_finance",
        label="NBFC & Financial Services",
        parent_sector="Financial Services",
        market="IN",
        tickers=frozenset({
            "BAJFINANCE", "BAJAJFINSV", "JIOFIN", "CHOLAFIN", "SHRIRAMFIN",
            "MUTHOOTFIN", "MANAPPURAM", "M&MFIN", "LTF", "LICHSGFIN", "PNBHOUSING",
            "ABCAPITAL", "POONAWALLA", "SUNDARMFIN", "CREDITACC", "IIFL", "PFC", "RECLTD",
            "HUDCO", "IREDA",
        }),
        name_patterns=(r"\bFINANCE\b", r"\bFINSERV\b", r"\bCAPITAL\b", r"\bHOUSING FIN", r"\bMICROFIN"),
        news_keywords=("nbfc", "microfinance", "housing finance", "rbi", "lending"),
    ),
    IndustrySpec(
        key="metals_steel",
        label="Metals & Steel",
        parent_sector="Basic Materials",
        market="IN",
        tickers=frozenset({
            "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "JINDALSTEL", "SAIL",
            "NMDC", "NATIONALUM", "HINDZINC", "HINDCOPPER", "APLAPOLLO", "JSL",
            "RATNAMANI", "WELCORP", "SHYAMMETL", "LLOYDSME", "GPIL", "MOIL",
        }),
        name_patterns=(r"\bSTEEL\b", r"\bALUMIN", r"\bMETAL", r"\bCOPPER\b", r"\bZINC\b", r"\bMINING\b", r"\bFERRO\b"),
        news_keywords=("steel", "aluminium", "copper", "iron ore", "anti-dumping", "safeguard duty", "metals"),
    ),
    IndustrySpec(
        key="pharma_api",
        label="Pharma & API",
        parent_sector="Healthcare",
        market="IN",
        tickers=frozenset({
            "SUNPHARMA", "CIPLA", "DRREDDY", "DIVISLAB", "LUPIN", "AUROPHARMA",
            "TORNTPHARM", "ZYDUSLIFE", "ALKEM", "BIOCON", "GLENMARK", "LAURUSLABS",
            "GRANULES", "NATCOPHARM", "IPCALAB", "AJANTPHARM", "WOCKPHARMA",
            "NEULANDLAB", "SUVENPHAR", "APLLTD", "GLAND", "JBCHEPHARM", "RUBICON",
        }),
        name_patterns=(r"\bPHARMA", r"\bLABS\b", r"\bLABORATOR", r"\bBIOSCIEN", r"\bDRUGS\b"),
        news_keywords=("pharma", "usfda", "fda", "anda", "api", "drug approval", "formulation"),
    ),
    IndustrySpec(
        key="fertilisers_agrochem",
        label="Fertilisers & Agrochem",
        parent_sector="Basic Materials",
        market="IN",
        tickers=frozenset({
            "COROMANDEL", "CHAMBLFERT", "FACT", "GNFC", "GSFC", "RCF", "NFL",
            "DEEPAKFERT", "PARADEEP", "MADRASFERT", "PIIND", "UPL", "SUMICHEM",
            "BAYERCROP", "RALLIS", "DHANUKA", "SHARDACROP", "INSECTICID",
        }),
        name_patterns=(r"\bFERTILIS", r"\bFERTILIZ", r"\bAGROCHEM", r"\bPESTICID", r"\bCROP\b"),
        news_keywords=("fertiliser", "fertilizer", "urea", "dap", "subsidy", "monsoon", "agrochem"),
    ),
    IndustrySpec(
        key="real_estate",
        label="Real Estate",
        parent_sector="Real Estate",
        market="IN",
        tickers=frozenset({
            "DLF", "LODHA", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD",
            "BRIGADE", "SOBHA", "SUNTECK", "MAHLIFE", "SIGNATURE", "ANANTRAJ",
            "NBCC", "HUBTOWN", "KOLTEPATIL",
        }),
        name_patterns=(r"\bREALTY\b", r"\bREAL ESTATE\b", r"\bPROPERTIES\b", r"\bDEVELOPER", r"\bESTATES\b"),
        news_keywords=("real estate", "housing demand", "pre-sales", "property", "reit"),
    ),
    IndustrySpec(
        key="power_renewables",
        label="Power & Renewables",
        parent_sector="Utilities",
        market="IN",
        tickers=frozenset({
            "NTPC", "POWERGRID", "TATAPOWER", "ADANIPOWER", "ADANIGREEN", "JSWENERGY",
            "NHPC", "SJVN", "TORNTPOWER", "CESC", "SUZLON", "INOXWIND", "WAAREEENER",
            "PREMIERENE", "KPIGREEN", "BORORENEW", "NLCINDIA", "IEX",
        }),
        name_patterns=(r"\bPOWER\b", r"\bSOLAR\b", r"\bRENEWABLE", r"\bWIND\b", r"\bENERGY\b", r"\bELECTRIC"),
        news_keywords=("power", "solar", "renewable", "wind energy", "tariff", "grid", "discom"),
    ),
    IndustrySpec(
        key="oil_gas_omc",
        label="Oil, Gas & OMCs",
        parent_sector="Energy",
        market="IN",
        tickers=frozenset({
            "RELIANCE", "ONGC", "IOC", "BPCL", "HINDPETRO", "GAIL", "OIL",
            "PETRONET", "IGL", "MGL", "GUJGASLTD", "ATGL", "MRPL", "CHENNPETRO",
            "GSPL", "CASTROLIND",
        }),
        name_patterns=(r"\bPETRO", r"\bOIL\b", r"\bGAS\b", r"\bREFINER"),
        news_keywords=("crude oil", "omc", "petrol", "diesel", "refining", "natural gas", "opec"),
    ),
    IndustrySpec(
        key="shipping_ports",
        label="Shipping & Ports",
        parent_sector="Industrials",
        market="IN",
        tickers=frozenset({
            "ADANIPORTS", "GESHIP", "SCI", "JSWINFRA", "GPPL", "DREDGECORP",
            "SEAMEC", "SHREYAS", "ALLCARGO", "TCI", "TCIEXP", "DELHIVERY", "BLUEDART",
        }),
        name_patterns=(r"\bSHIPPING\b", r"\bPORT\b", r"\bPORTS\b", r"\bMARITIME\b", r"\bLOGISTIC"),
        news_keywords=("shipping", "freight", "baltic dry", "port", "red sea", "container"),
    ),
    IndustrySpec(
        key="textiles_apparel",
        label="Textiles & Apparel",
        parent_sector="Consumer Cyclical",
        market="IN",
        tickers=frozenset({
            "PAGEIND", "TRIDENT", "KPRMILL", "WELSPUNLIV", "ARVIND", "VARDHMAN",
            "VTL", "GOKEX", "RAYMOND", "SPAL", "LUXIND", "RUPA", "KITEX",
            "GARFIBRES", "HIMATSEIDE", "NitinSpin", "NITINSPIN", "ALOKINDS",
        }),
        name_patterns=(r"\bTEXTILE", r"\bSPINNING\b", r"\bCOTTON\b", r"\bGARMENT", r"\bAPPAREL\b", r"\bMILLS\b"),
        news_keywords=("textile", "cotton", "garment", "apparel", "export order", "bangladesh"),
    ),
    IndustrySpec(
        key="cement",
        label="Cement",
        parent_sector="Basic Materials",
        market="IN",
        tickers=frozenset({
            "ULTRACEMCO", "AMBUJACEM", "SHREECEM", "ACC", "DALBHARAT", "JKCEMENT",
            "RAMCOCEM", "JKLAKSHMI", "BIRLACORPN", "NUVOCO", "INDIACEM", "STARCEMENT",
            "HEIDELBERG", "ORIENTCEM", "PRSMJOHNSN",
        }),
        name_patterns=(r"\bCEMENT",),
        news_keywords=("cement", "clinker", "infra push", "cement prices"),
    ),
    IndustrySpec(
        key="auto_ev",
        label="Auto & EV",
        parent_sector="Consumer Cyclical",
        market="IN",
        tickers=frozenset({
            "MARUTI", "M&M", "TATAMOTORS", "BAJAJ-AUTO", "EICHERMOT", "HEROMOTOCO",
            "TVSMOTOR", "ASHOKLEY", "ESCORTS", "BHARATFORG", "MOTHERSON", "SONACOMS",
            "BOSCHLTD", "EXIDEIND", "ARE&M", "APOLLOTYRE", "MRF", "BALKRISIND", "OLECTRA",
        }),
        name_patterns=(r"\bAUTO\b", r"\bMOTORS\b", r"\bTYRE", r"\bAUTOMOTIVE\b"),
        news_keywords=("auto sales", "ev", "electric vehicle", "tractor", "two-wheeler", "passenger vehicle"),
    ),
    IndustrySpec(
        key="specialty_chemicals",
        label="Specialty Chemicals",
        parent_sector="Basic Materials",
        market="IN",
        tickers=frozenset({
            "SRF", "PIDILITIND", "DEEPAKNTR", "NAVINFLUOR", "FLUOROCHEM", "AARTIIND",
            "ATUL", "CLEAN", "FINEORG", "TATACHEM", "VINATIORGA", "ALKYLAMINE",
            "BALAMINES", "ROSSARI", "ANURAS", "NEOGEN", "GALAXYSURF", "NOCIL",
        }),
        name_patterns=(r"\bCHEMICAL", r"\bFLUORO", r"\bAMINES\b", r"\bORGANICS\b"),
        news_keywords=("chemical", "specialty chemical", "fluorochemical", "soda ash", "china dumping"),
    ),
    IndustrySpec(
        key="it_services",
        label="IT Services & Digital",
        parent_sector="Technology",
        market="IN",
        tickers=frozenset({
            "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "PERSISTENT",
            "COFORGE", "MPHASIS", "LTTS", "KPITTECH", "TATAELXSI", "OFSS",
            "CYIENT", "BSOFT", "ZENSARTECH", "SONATSOFTW", "HAPPSTMNDS", "NEWGEN",
        }),
        name_patterns=(r"\bSOFTWARE\b", r"\bINFOTECH\b", r"\bTECHNOLOG", r"\bSYSTEMS\b"),
        news_keywords=("it sector", "software", "deal wins", "us fed", "ai spending", "tcs", "infosys"),
    ),
    IndustrySpec(
        key="capital_goods_infra",
        label="Capital Goods & Infra",
        parent_sector="Industrials",
        market="IN",
        tickers=frozenset({
            "LT", "SIEMENS", "ABB", "CGPOWER", "CUMMINSIND", "THERMAX", "BHEL",
            "BEL", "ACE", "KEI", "POLYCAB", "APARINDS", "TRITURBINE", "ELGIEQUIP",
            "SCHAEFFLER", "TIMKEN", "SKFINDIA", "KEC", "KALPATPOWR", "KPIL", "NCC",
            "PNCINFRA", "KNRCON", "HGInfra", "HGINFRA", "IRB",
        }),
        name_patterns=(r"\bINFRA", r"\bCONSTRUCT", r"\bENGINEER", r"\bEQUIPMENT\b", r"\bTURBINE\b", r"\bCABLE"),
        news_keywords=("capex", "infrastructure", "order book", "transformers", "transmission"),
    ),
)

US_INDUSTRIES: tuple[IndustrySpec, ...] = (
    IndustrySpec(
        key="semiconductors_ai",
        label="Semiconductors & AI",
        parent_sector="Technology",
        market="US",
        tickers=frozenset({"NVDA", "AMD", "AVGO", "TSM", "INTC", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC", "MRVL", "ARM", "ON", "SMCI"}),
        name_patterns=(r"\bSEMICONDUCTOR", r"\bMICRO\b", r"\bCHIP\b"),
        news_keywords=("semiconductor", "chip", "ai", "gpu", "foundry", "nvidia"),
    ),
    IndustrySpec(
        key="software_cloud",
        label="Software & Cloud",
        parent_sector="Technology",
        market="US",
        tickers=frozenset({"MSFT", "ORCL", "CRM", "ADBE", "NOW", "INTU", "PANW", "CRWD", "SNOW", "DDOG", "PLTR", "NET", "ZS", "WDAY"}),
        name_patterns=(r"\bSOFTWARE\b", r"\bCLOUD\b", r"\bCYBER"),
        news_keywords=("cloud", "saas", "cybersecurity", "software"),
    ),
    IndustrySpec(
        key="biotech_pharma",
        label="Biotech & Pharma",
        parent_sector="Healthcare",
        market="US",
        tickers=frozenset({"LLY", "JNJ", "ABBV", "MRK", "PFE", "AMGN", "GILD", "VRTX", "REGN", "BIIB", "MRNA", "BMY"}),
        name_patterns=(r"\bPHARMA", r"\bBIOTECH", r"\bTHERAPEUT"),
        news_keywords=("fda", "clinical trial", "biotech", "pharma", "glp-1"),
    ),
    IndustrySpec(
        key="oil_energy",
        label="Oil & Energy",
        parent_sector="Energy",
        market="US",
        tickers=frozenset({"XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "HAL", "BKR", "DVN"}),
        name_patterns=(r"\bPETROLEUM\b", r"\bENERGY\b", r"\bOIL\b", r"\bGAS\b"),
        news_keywords=("crude", "opec", "oil", "refining", "natural gas"),
    ),
    IndustrySpec(
        key="banks_financials",
        label="Banks & Financials",
        parent_sector="Financial Services",
        market="US",
        tickers=frozenset({"JPM", "BAC", "WFC", "C", "GS", "MS", "SCHW", "BLK", "USB", "PNC", "TFC", "COF"}),
        name_patterns=(r"\bBANK\b", r"\bBANCORP\b", r"\bFINANCIAL\b"),
        news_keywords=("fed", "interest rate", "bank earnings", "net interest"),
    ),
    IndustrySpec(
        key="aerospace_defence",
        label="Aerospace & Defence",
        parent_sector="Industrials",
        market="US",
        tickers=frozenset({"LMT", "RTX", "NOC", "GD", "BA", "LHX", "HII", "TDG", "GE"}),
        name_patterns=(r"\bAEROSPACE\b", r"\bDEFENSE\b"),
        news_keywords=("defense", "pentagon", "aerospace", "missile"),
    ),
    IndustrySpec(
        key="metals_miners",
        label="Metals & Miners",
        parent_sector="Basic Materials",
        market="US",
        tickers=frozenset({"FCX", "NEM", "NUE", "STLD", "CLF", "AA", "ALB", "MP", "SCCO", "GOLD"}),
        name_patterns=(r"\bMINING\b", r"\bGOLD\b", r"\bCOPPER\b", r"\bSTEEL\b", r"\bLITHIUM\b"),
        news_keywords=("gold", "copper", "steel", "lithium", "mining"),
    ),
    IndustrySpec(
        key="homebuilders",
        label="Homebuilders & Real Estate",
        parent_sector="Consumer Cyclical",
        market="US",
        tickers=frozenset({"DHI", "LEN", "PHM", "NVR", "TOL", "KBH", "BLD", "HD", "LOW"}),
        name_patterns=(r"\bHOMES\b", r"\bHOMEBUILD", r"\bHOUSING\b"),
        news_keywords=("housing starts", "mortgage rate", "homebuilder"),
    ),
)

ALL_INDUSTRIES: dict[str, tuple[IndustrySpec, ...]] = {
    "IN": INDIA_INDUSTRIES,
    "US": US_INDUSTRIES,
}

INDUSTRY_BY_KEY: dict[str, IndustrySpec] = {
    spec.key: spec
    for specs in ALL_INDUSTRIES.values()
    for spec in specs
}

_COMPILED_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    spec.key: tuple(re.compile(pat, re.IGNORECASE) for pat in spec.name_patterns)
    for specs in ALL_INDUSTRIES.values()
    for spec in specs
}


def is_etf_like(ticker: str | None, name: str | None, is_etf_flag: bool = False) -> bool:
    if is_etf_flag:
        return True
    tk = (ticker or "").strip().upper()
    nm = (name or "").strip().upper()
    if not tk:
        return True
    if tk.endswith(("BEES", "ETF", "IETF")) or "NIFTY" in tk or "BANKNIF" in tk or "SENSEX" in tk:
        return True
    if " ETF" in nm or nm.endswith("ETF") or "EXCHANGE TRADED" in nm or "INDEX FUND" in nm:
        return True
    return False


def exchange_rank(exchange: str | None) -> int:
    ex = (exchange or "").strip().upper()
    if ex in ("NSE", "NASDAQ", "NYSE"):
        return 2
    if ex == "BSE":
        return 1
    return 0


def slugify_sector(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_") or "unclassified"


def classify_asset(
    market: str,
    ticker: str,
    name: str | None,
    raw_sector: str | None,
) -> dict[str, Any]:
    """Assign 1 primary broad_sector and at most 1 primary industry_group (+ optional tags)."""
    tk = (ticker or "").strip().upper()
    nm = (name or "").strip()
    specs = ALL_INDUSTRIES.get(market, ())

    matched_spec: IndustrySpec | None = None
    source = "unclassified"
    tags: list[str] = []

    # 1. Exact ticker mapping (highest confidence)
    for spec in specs:
        if tk in spec.tickers:
            if matched_spec is None:
                matched_spec = spec
                source = "versioned_ticker_map"
            else:
                tags.append(spec.label)

    # 2. Deterministic company-name pattern fallback
    if matched_spec is None and nm:
        for spec in specs:
            pats = _COMPILED_PATTERNS.get(spec.key, ())
            if any(p.search(nm) for p in pats):
                matched_spec = spec
                source = "name_keyword_rule"
                break

    clean_sector = (raw_sector or "").strip()
    if clean_sector:
        broad_sector = clean_sector
        if matched_spec is None:
            source = "assets_sector"
    elif matched_spec is not None:
        broad_sector = matched_spec.parent_sector
    else:
        broad_sector = "Unclassified"

    return {
        "broadSector": broad_sector,
        "broadSectorKey": slugify_sector(broad_sector),
        "industryGroup": matched_spec.label if matched_spec else None,
        "industryKey": matched_spec.key if matched_spec else None,
        "tags": tags,
        "source": source,
        "classified": broad_sector != "Unclassified",
    }


def match_related_news(
    articles: list[dict[str, Any]],
    group_level: str,
    group_key: str,
    group_label: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Attach optional related headlines from existing news_articles feed (observation-only)."""
    if not articles:
        return []
    spec = INDUSTRY_BY_KEY.get(group_key) if group_level == "INDUSTRY" else None
    keywords: tuple[str, ...]
    if spec and spec.news_keywords:
        keywords = spec.news_keywords
    else:
        words = [w.lower() for w in re.split(r"[^a-zA-Z0-9]+", group_label) if len(w) >= 4]
        keywords = tuple(words)
    if not keywords:
        return []

    matched: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for art in articles:
        title = str(art.get("title") or "").strip()
        if not title:
            continue
        low = f"{title} {art.get('summary') or ''}".lower()
        if any(kw in low for kw in keywords):
            norm = title.lower()
            if norm in seen_titles:
                continue
            seen_titles.add(norm)
            matched.append({
                "title": title,
                "source": str(art.get("source") or "News"),
                "publishedAt": art.get("publishedAt"),
                "url": art.get("url"),
            })
            if len(matched) >= limit:
                break
    return matched
