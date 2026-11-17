# Reading InvestoGenie

InvestoGenie is a personal market terminal for Indian (NSE/BSE) and US equities. It ingests market,
fundamental and news data, runs server-authoritative trading strategies over it, and records what was
actually bought and sold. One deployed instance, one primary user.

## If you have the files but not the repository

Read these two, in this order. They are written to stand alone and together describe the system:

1. **[CAPABILITIES.md](CAPABILITIES.md)** — what the system does. Every workspace, every strategy
   engine, the ledger, funds, notifications, mobile, and how the strategies are measured.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it is built and why. Calculation ownership, immutable
   plans, the measurement subsystem, scheduling, deployment and runtime constraints.

That is sufficient. Everything else is supporting detail:

- `docs/swing-strategies.md` — exact thresholds and the reasoning behind each strategy revision, if
  you need a rule rather than a description of it.
- `docs/modules/*.md` — one guide per module. Each opens with a plain description, then boundaries
  and file paths that only mean something with the checkout in hand.
- `STATUS.md` — what is deployed right now, recently changed, and known to be unfinished. Dated, and
  the first thing to go stale.

## If you have the repository

Follow **[AGENTS.md](AGENTS.md)** instead. It is the working contract: what to read for a given task,
which code is protected, how to validate, and the git, database and deployment constraints. Start
from `docs/MODULE_INDEX.md` rather than exploring.

## Two things worth knowing before you read anything

**Trading mathematics is Python-authoritative.** `pipelines/strategy_math/` owns every status, score,
gate and trade level. TypeScript gathers inputs and renders results; it must not recompute them, and
neither may the mobile client. Where you see a TypeScript formula module, it is migration debt, not an
authority.

**Claims here are meant to be checkable.** The documents distinguish what is implemented from what is
designed, and what was measured from what was reasoned. Strategy thresholds are backed by a historical
replay that drives the production engine itself over a decade of data; where a number is stated, the
pipeline that produced it is named so it can be re-run. If a statement cannot be verified against the
code or the database, treat it as stale rather than true — the source and the schema outrank every
document here.
