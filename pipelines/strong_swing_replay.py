#!/usr/bin/env python3
"""Replay the Strong Swing engine over recorded history and grade every signal.

Forward testing enrols roughly one Strong Swing signal a week, so the sample that
would say whether the strategy works is months away. The engine is a pure function
of completed bars, and `daily_ohlcv` holds a decade of them, so the same code the
screen runs can be replayed over history to produce that sample now.

What this is honest about:

* No lookahead. For a signal on day D the engine sees only bars dated on or before
  D, the benchmark only up to D, and `currentPrice` is D's close. The outcome is
  read from D+1 onward, entering at the next session's open.
* Three gates cannot be judged from history. `live_quote`, `live_spread` and
  `live_circuit` need a broker quote that was never recorded, so the replay runs
  them the way production does outside the open session: not required. The
  `results_blackout` gate needs a company-results calendar, which only exists from
  late 2025; `--results strict` evaluates it where the calendar covers the date and
  `--results ignored` (the default) skips it. Each run records which it did.
* The two session gates added in v6 are inert here by construction: history has no
  open session, only completed bars.

So this measures the completed-bar edge, which is most of the engine, and says so
rather than implying it measured all of it.
"""
from __future__ import annotations

import argparse
import bisect
import os
from dataclasses import dataclass
from statistics import median

import psycopg2
from psycopg2.extras import execute_values

from strategy_math.common import Bar, structural_breakout
from strategy_math.strong_swing import MODEL_VERSION, assess

METHODOLOGY_VERSION = "strong_swing_replay_next_open_v1"
# The window production feeds the engine (lib/strongSwing.ts). Replaying a different
# window would measure a different strategy.
WINDOW = 260
# The 200-session trend gate is blocking, so a shorter window can never be ready.
# Skipping those days costs nothing and removes most of the work.
MIN_BARS = 200
DEFAULT_HORIZON = 20
BENCHMARK_TICKERS = {"IN": ("NIFTYBEES", "NIFTY"), "US": ("SPY",)}
# What production passes outside an open India session, and what a replay of
# completed bars can honestly claim: the calendar is clear for this date.
RESULTS_CLEAR = {"verified": True, "sessionsToNext": None, "nextDate": None,
                 "detail": "Results blackout not evaluated by the replay."}
DECISION_LABEL = {
    "none": "signal bar's close; enter next open; session gates inert",
    "open": "next open, judged and taken at that price; session gates inert",
    "blind": "next session's close; enter the open after; session withheld (control arm)",
    "session": "next session's close; enter the open after; v6 session gates active",
}


def breakout_candidate(window: list[Bar]) -> bool:
    """The engine's own structure test, run before building the full input.

    `structure` is a blocking technical gate, so a day where neither of the last two
    completed bars broke out can never reach EXECUTION_READY. Testing that first turns
    a decade-wide scan from days into minutes. It must stay an exact mirror of
    `is_breakout` in strong_swing.assess; `test_strong_swing_replay` cross-checks it
    against the engine rather than trusting the resemblance.
    """
    return structural_breakout(window) or structural_breakout(window[:-1])


def benchmark_slice(dates: list[str], bars: list[dict], day: str, size: int = WINDOW) -> list[dict]:
    """Benchmark bars up to and including `day`, never past it.

    The whole point of a replay is that the benchmark is the one that existed at the
    time; slicing by date here is what keeps `relative_strength`, `market_regime` and
    `market_shock` free of lookahead.
    """
    end = bisect.bisect_right(dates, day)
    return bars[max(0, end - size):end]


def sessions_until(day: str, target: str, sessions: list[str]) -> int:
    """Trading sessions after `day` up to and including `target`.

    The engine counts the results blackout in sessions, not calendar days, so a date
    three days out is inside the window mid-week and outside it over a long weekend.
    """
    start = bisect.bisect_right(sessions, day)
    end = bisect.bisect_right(sessions, target)
    return max(0, end - start)


def results_check(event_dates: list[str], day: str, sessions: list[str]) -> dict | None:
    """Rebuild the results evidence as it stood on `day`, or None if it cannot be.

    A calendar that holds no results date before `day` and none on or after it did not
    cover that date, and claiming otherwise would hand the replay a verified gate the
    production app never had. Returning None makes the gate fail, exactly as a missing
    calendar does on the live screen.
    """
    if not event_dates:
        return None
    upcoming = next((value for value in event_dates if value >= day), None)
    covered_before = event_dates[0] < day
    if upcoming is None or not covered_before:
        return None
    lag = sessions_until(day, upcoming, sessions)
    return {"verified": True, "sessionsToNext": lag, "nextDate": upcoming,
            "detail": f"Next results {upcoming}, {lag} session(s) out."}


@dataclass(frozen=True)
class Outcome:
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    exit_reason: str
    return_pct: float
    max_favorable_pct: float
    max_adverse_pct: float
    sessions_held: int


def grade(stop: float, target: float, forward: list[Bar], horizon: int) -> Outcome | None:
    """Enter at the next session's open; exit on the plan's own stop or target.

    Entering at the open rather than at the plan's entry price is the executable
    reading: the signal is known after the close, so the next open is the first price
    anyone could have paid. The plan's entry is stored alongside, so the gap between
    the two is measurable instead of assumed away.
    """
    path = forward[:horizon]
    if not path or path[0].open <= 0:
        return None
    entry_price = path[0].open
    pct = lambda value: (value / entry_price - 1.0) * 100.0
    best, worst = path[0].high, path[0].low

    def finish(bar: Bar, index: int, price: float, reason: str) -> Outcome:
        return Outcome(path[0].date, entry_price, bar.date, price, reason, pct(price),
                       pct(best), pct(worst), index + 1)

    for index, bar in enumerate(path):
        best, worst = max(best, bar.high), min(worst, bar.low)
        # A bar that spans both levels is scored as the stop. A daily bar does not say
        # which was touched first, and assuming the target is how a backtest flatters
        # itself. A gap through either level fills at the open, not at the level.
        if bar.low <= stop:
            return finish(bar, index, min(stop, bar.open), "STOP")
        if bar.high >= target:
            return finish(bar, index, max(target, bar.open), "TARGET")
    last = path[-1]
    return finish(last, len(path) - 1, last.close, "HORIZON")


def summarize(outcomes: list[Outcome]) -> dict:
    if not outcomes:
        return {"graded": 0}
    returns = [item.return_pct for item in outcomes]
    wins = [value for value in returns if value > 0]
    losses = [value for value in returns if value <= 0]
    counted = lambda reason: sum(item.exit_reason == reason for item in outcomes)
    return {
        "graded": len(outcomes),
        "win_rate_pct": len(wins) / len(outcomes) * 100,
        "average_return_pct": sum(returns) / len(returns),
        "median_return_pct": median(returns),
        "average_win_pct": sum(wins) / len(wins) if wins else 0.0,
        "average_loss_pct": sum(losses) / len(losses) if losses else 0.0,
        # The number that decides whether the strategy is worth trading: the average
        # outcome per signal, wins and losses together.
        "expectancy_pct": sum(returns) / len(returns),
        "target_hits": counted("TARGET"),
        "stop_hits": counted("STOP"),
        "horizon_exits": counted("HORIZON"),
        "average_sessions_held": sum(item.sessions_held for item in outcomes) / len(outcomes),
        "average_max_favorable_pct": sum(item.max_favorable_pct for item in outcomes) / len(outcomes),
        "average_max_adverse_pct": sum(item.max_adverse_pct for item in outcomes) / len(outcomes),
    }


# The two gates that ask only where the price is: the band against the live quote, and the
# band against the session's open. A day blocked by nothing else is one price away from being
# taken, which is what makes it a near miss rather than a different setup.
ENTRY_GATES = ("entry_zone", "entry_open")


def near_miss(verdict: dict) -> bool:
    """Ready on everything except where the price happened to be.

    Before v8 these were the days the live screen could still offer, because it re-read the
    entry band against the quote all session while this replay read it once. v8 refuses them,
    having measured them at -0.15% per trade against +0.40% for days that opened in the band,
    so the set is now what the gate excludes -- kept because re-measuring that gap is the only
    way the rule can be revisited.

    Requiring the entry gates to be the *only* blocking failures is what keeps the set honest:
    a day also failing the volatility ceiling or the results blackout was never one quote away
    from being taken.
    """
    failed = {gate["key"] for gate in verdict["gates"] if gate["blocking"] and not gate["passed"]}
    return bool(failed) and failed <= set(ENTRY_GATES)


def decision_view(bars: list[Bar], index: int, mode: str) -> tuple[float, dict | None, int] | None:
    """What the engine is shown about the moment of decision, and when the trade starts.

    `none` is the plain replay: judge on the close of the signal bar and enter at the next
    open. It cannot exercise the v6 session gates at all, because nothing beyond the signal
    bar is in view.

    Production never decides at that moment. It decides *during* the session after the
    signal bar, which is the session those gates read. `blind` and `session` both move the
    decision to that session's close and the entry to the open after it; they differ only
    in whether the session is handed to the engine. That single difference is what makes
    the pair a controlled comparison rather than two unrelated backtests.
    """
    if mode == "none":
        return bars[index].close, None, index + 1
    if mode == "open":
        # The decision the v7 entry band was measured on: judge at the next open and take
        # that same price. The session carries only its open, which is both the decision
        # price and all the v8 entry_open gate needs; its high and low are deliberately
        # withheld, so the advisory session gates stay out of view as they always were here.
        if index + 1 >= len(bars):
            return None
        live = bars[index + 1]
        return live.open, {"date": live.date, "open": live.open}, index + 1
    if index + 2 >= len(bars):
        return None
    live = bars[index + 1]
    session = (None if mode == "blind"
               else {"date": live.date, "open": live.open, "high": live.high, "low": live.low})
    return live.close, session, index + 2


def scan_asset(asset: dict, bars: list[Bar], bars_json: list[dict], benchmark: dict,
               event_dates: list[str], options: argparse.Namespace) -> list[dict]:
    """Every EXECUTION_READY day this asset produced inside the replay window."""
    signals: list[dict] = []
    open_until = ""
    for index in range(MIN_BARS - 1, len(bars)):
        day = bars[index].date
        if day < options.start or day > options.end:
            continue
        # One position at a time per stock. A breakout stays ready for several sessions,
        # so counting each of those days as its own signal would fill the sample with
        # the same trade and overstate the evidence.
        if options.overlap == "first" and day <= open_until:
            continue
        start = max(0, index + 1 - WINDOW)
        window = bars[start:index + 1]
        if len(window) < MIN_BARS or not breakout_candidate(window):
            continue
        view = decision_view(bars, index, options.session)
        if view is None:
            continue
        current_price, session, entry_index = view
        results = (results_check(event_dates, day, benchmark["sessions"])
                   if options.results == "strict" else RESULTS_CLEAR)
        verdict = assess({
            "market": options.market,
            "verdict": "REPLAY",
            "currentPrice": current_price,
            "stopAtrMult": options.stop_atr, "targetRR": options.target_rr,
            "trailAtrMult": options.trail_atr,
            "bars": bars_json[start:index + 1],
            "benchmarkBars": benchmark_slice(benchmark["sessions"], benchmark["bars"], day),
            "requireLiveExecutionData": False,
            "results": results,
            "session": session,
        })
        ready = verdict["status"] == "EXECUTION_READY"
        missed = options.collect != "ready" and not ready and near_miss(verdict)
        if not ready and not missed:
            continue
        if ready and options.collect == "near-miss":
            continue
        # A near miss has no entry price: the open was outside the band, so whether it was
        # ever buyable is a question only the intraday path answers. It is recorded with its
        # plan and left ungraded rather than graded at a price nobody could have paid.
        outcome = None if missed else grade(verdict["strongStop"], verdict["strongTarget"],
                                            bars[entry_index:], options.horizon)
        if outcome and options.overlap == "first":
            open_until = outcome.exit_date
        signals.append({"asset": asset, "signal_date": day, "verdict": verdict,
                        "outcome": outcome, "near_miss": missed,
                        "entry_date": bars[entry_index].date if entry_index < len(bars) else None})
    return signals


def load_benchmark(cur, market: str, preferred: str | None = None) -> dict:
    """The index series the replay compares every stock against, and the exchange
    calendar taken from it.

    The deepest series wins rather than the first listed: the benchmark is the hard
    limit on how far back a replay can reach, because a stock-day with no benchmark
    behind it fails `benchmark_data` and can never be judged.
    """
    candidates = (preferred,) if preferred else BENCHMARK_TICKERS[market]
    for ticker in sorted(candidates, key=lambda value: -_benchmark_depth(cur, value, market)):
        cur.execute(
            """select o.date::text,o.open,o.high,o.low,o.close,o.volume
                 from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
                where a.ticker=%s and a.country=%s order by o.date""",
            (ticker, market),
        )
        rows = cur.fetchall()
        if len(rows) >= WINDOW:
            cur.execute("select id::text from public.assets where ticker=%s and country=%s limit 1",
                        (ticker, market))
            return {
                "ticker": ticker, "asset_id": cur.fetchone()[0],
                "sessions": [row[0] for row in rows],
                "bars": [{"date": row[0], "open": float(row[1]), "high": float(row[2]),
                          "low": float(row[3]), "close": float(row[4]),
                          "volume": float(row[5] or 0)} for row in rows],
            }
    raise SystemExit(f"No benchmark with {WINDOW}+ bars for {market}: tried {candidates}")


def _benchmark_depth(cur, ticker: str, market: str) -> int:
    cur.execute(
        """select count(o.*) from public.daily_ohlcv o join public.assets a on a.id=o.asset_id
            where a.ticker=%s and a.country=%s""",
        (ticker, market),
    )
    return int(cur.fetchone()[0])


def load_universe(cur, market: str, limit: int | None) -> list[dict]:
    cur.execute(
        """select a.id::text,a.ticker,count(o.*) bars
             from public.assets a join public.daily_ohlcv o on o.asset_id=a.id
            where a.country=%s and a.asset_class='STOCK' and a.is_active
            group by a.id,a.ticker having count(o.*) >= %s
            order by a.ticker""",
        (market, MIN_BARS),
    )
    rows = cur.fetchall()
    rows = rows[:limit] if limit else rows
    return [{"id": row[0], "ticker": row[1]} for row in rows]


def load_results_calendar(cur, market: str) -> dict[str, list[str]]:
    cur.execute(
        """select e.asset_id::text,e.event_date::text
             from public.corporate_events e join public.assets a on a.id=e.asset_id
            where e.event_type='RESULTS' and a.country=%s order by e.asset_id,e.event_date""",
        (market,),
    )
    calendar: dict[str, list[str]] = {}
    for asset_id, event_date in cur.fetchall():
        calendar.setdefault(asset_id, []).append(event_date)
    return calendar


def store(conn, options: argparse.Namespace, benchmark: dict, signals: list[dict],
          scanned: int, sessions: int) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """insert into public.strong_swing_replay_runs(
                 market,model_version,methodology_version,results_mode,live_execution_evaluated,
                 benchmark_asset_id,from_date,to_date,horizon_sessions,
                 assets_scanned,sessions_scanned,signals)
               values(%s,%s,%s,%s,false,%s,%s,%s,%s,%s,%s,%s) returning id::text""",
            (options.market, MODEL_VERSION, METHODOLOGY_VERSION,
             "strict" if options.results == "strict" else "ignored",
             benchmark["asset_id"], options.start, options.end, options.horizon,
             # Near misses are recorded beside the trades but are not trades: counting them
             # here would overstate by threefold what the run actually took.
             scanned, sessions, sum(1 for item in signals if not item["near_miss"])),
        )
        run_id = cur.fetchone()[0]
        execute_values(
            cur,
            """insert into public.strong_swing_replay_signals(
                 run_id,asset_id,ticker,signal_date,strength_score,plan_entry,plan_stop,
                 plan_target,atr,expected_days,entry_date,entry_price,exit_date,exit_price,
                 exit_reason,return_pct,max_favorable_pct,max_adverse_pct,sessions_held,near_miss)
               values %s on conflict do nothing""",
            [(run_id, item["asset"]["id"], item["asset"]["ticker"], item["signal_date"],
              item["verdict"]["strengthScore"], item["verdict"]["strongEntry"],
              item["verdict"]["strongStop"], item["verdict"]["strongTarget"],
              item["verdict"]["atr"], item["verdict"]["strongExpectedDays"],
              *( (o.entry_date, o.entry_price, o.exit_date, o.exit_price, o.exit_reason,
                  o.return_pct, o.max_favorable_pct, o.max_adverse_pct, o.sessions_held)
                 if (o := item["outcome"]) else (item["entry_date"], None, None, None, "OPEN",
                                                 None, None, None, None)),
              item["near_miss"])
             for item in signals],
        )
    conn.commit()
    return run_id


def report(options: argparse.Namespace, benchmark: dict, signals: list[dict],
           scanned: int, sessions: int, run_id: str | None) -> None:
    taken = [item for item in signals if not item["near_miss"]]
    missed = [item for item in signals if item["near_miss"]]
    graded = [item["outcome"] for item in taken if item["outcome"]]
    stats = summarize(graded)
    slippage = [(item["outcome"].entry_price / item["verdict"]["strongEntry"] - 1) * 100
                for item in taken if item["outcome"] and item["verdict"]["strongEntry"] > 0]
    print(f"\nStrong Swing replay — {options.market} {options.start} to {options.end}")
    print(f"  model             {MODEL_VERSION}")
    print(f"  methodology       {METHODOLOGY_VERSION}")
    print(f"  benchmark         {benchmark['ticker']}")
    print(f"  results gate      {'evaluated where the calendar covers the date' if options.results == 'strict' else 'not evaluated'}")
    print("  live gates        not evaluated (no recorded broker quote)")
    print(f"  overlap           {'one open position per stock' if options.overlap == 'first' else 'every ready day'}")
    print(f"  decision          {DECISION_LABEL[options.session]}")
    print(f"  scanned           {scanned} assets, {sessions} asset-sessions")
    print(f"  signals           {len(taken)} ({len(graded)} graded, horizon {options.horizon} sessions)")
    if missed:
        print(f"  near misses       {len(missed)} days blocked only by the entry band, ungraded")
    if not graded:
        print("  no graded signals — nothing to conclude")
        return
    print(f"\n  win rate          {stats['win_rate_pct']:.1f}%  ({stats['graded']} trades)")
    print(f"  expectancy        {stats['expectancy_pct']:+.2f}% per signal")
    print(f"  median            {stats['median_return_pct']:+.2f}%")
    print(f"  average win       {stats['average_win_pct']:+.2f}%   over {stats['target_hits']} target hits")
    print(f"  average loss      {stats['average_loss_pct']:+.2f}%   over {stats['stop_hits']} stop hits")
    print(f"  horizon exits     {stats['horizon_exits']}")
    print(f"  held              {stats['average_sessions_held']:.1f} sessions on average")
    print(f"  excursion         +{stats['average_max_favorable_pct']:.2f}% best / {stats['average_max_adverse_pct']:.2f}% worst")
    if slippage:
        print(f"  fill vs plan      {sum(slippage)/len(slippage):+.2f}% at the next open")
    if run_id:
        print(f"\n  stored as run {run_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market", default="IN", choices=sorted(BENCHMARK_TICKERS))
    parser.add_argument("--from", dest="start", default="2017-01-01")
    parser.add_argument("--to", dest="end", default="2099-12-31")
    parser.add_argument("--horizon", type=int, default=DEFAULT_HORIZON)
    parser.add_argument("--results", default="ignored", choices=("ignored", "strict"))
    parser.add_argument("--overlap", default="first", choices=("first", "all"))
    parser.add_argument("--collect", default="ready", choices=("ready", "near-miss", "both"),
                        help="'near-miss' also records days ready on every blocking gate but "
                             "entry_zone — the ones a live intraday quote could still reach.")
    parser.add_argument("--session", default="none", choices=("none", "open", "blind", "session"),
                        help="none: judge on the signal bar's close. blind/session: judge on the "
                             "next session's close and enter the open after it; 'session' also "
                             "hands that session to the v6 gates. Use the pair to measure them.")
    parser.add_argument("--limit", type=int, default=None, help="scan only the first N tickers")
    parser.add_argument("--stop-atr", type=float, default=1.5)
    parser.add_argument("--target-rr", type=float, default=2.0)
    parser.add_argument("--trail-atr", type=float, default=1.5)
    parser.add_argument("--benchmark", default=None, help="force a benchmark ticker")
    parser.add_argument("--store", action="store_true", help="write the run to the database")
    options = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            benchmark = load_benchmark(cur, options.market, options.benchmark)
            universe = load_universe(cur, options.market, options.limit)
            calendar = load_results_calendar(cur, options.market) if options.results == "strict" else {}
        print(f"Replaying {len(universe)} {options.market} stocks against {benchmark['ticker']}"
              f" ({len(benchmark['sessions'])} sessions)...", flush=True)
        signals: list[dict] = []
        sessions_scanned = 0
        for position, asset in enumerate(universe, start=1):
            with conn.cursor() as cur:
                cur.execute(
                    """select date::text,open,high,low,close,volume,open_interest
                         from public.daily_ohlcv where asset_id=%s and date <= %s::date
                        order by date""",
                    (asset["id"], options.end),
                )
                rows = cur.fetchall()
            if len(rows) < MIN_BARS:
                continue
            bars_json = [{"date": row[0], "open": float(row[1]), "high": float(row[2]),
                          "low": float(row[3]), "close": float(row[4]),
                          "volume": float(row[5] or 0),
                          "openInterest": None if row[6] is None else float(row[6])}
                         for row in rows]
            bars = [Bar.from_json(item) for item in bars_json]
            sessions_scanned += sum(options.start <= bar.date <= options.end for bar in bars)
            signals.extend(scan_asset(asset, bars, bars_json, benchmark,
                                      calendar.get(asset["id"], []), options))
            if position % 500 == 0:
                print(f"  {position}/{len(universe)} scanned, {len(signals)} signals", flush=True)
        run_id = store(conn, options, benchmark, signals, len(universe), sessions_scanned) if options.store else None
    report(options, benchmark, signals, len(universe), sessions_scanned, run_id)


if __name__ == "__main__":
    main()
