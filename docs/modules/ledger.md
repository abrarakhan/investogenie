# Trade Ledger module

The Trade Ledger is the record of what was actually bought and sold, and the only place money is
counted. It holds purchases, partial and final sales, sale corrections, and pending buy-stop orders
that have not filled.

Two ideas shape it. First, protection is direction-aware: a long position's stop may only move up and
a short's only down, so a stop can never be loosened by a later edit. Second, capital accounting
distinguishes turnover from new money - sale proceeds are recycled into subsequent purchases before
the system infers that fresh external capital was added - and ROI and XIRR are computed on that
capital model rather than on gross flows. Named strategies carry completed-close exit lines and
planned first-target scale-outs.

A pending order is an application record, not a broker instruction: it carries no position, capital or
P&L until a fill is recorded. Each confirmed partial fill becomes its own purchased trade in the same
database transaction, and cancelling a remainder preserves the fills that already happened.

## Boundaries and invariants

- Owns purchases, sales, pending orders, immutable-plan linkage, P&L, ROI, XIRR, GTT and follow-up guidance.
- Web entry: `app/terminal/[market]/trade-ledger/page.tsx`; mobile APIs under `/api/v1/mobile/trade-ledger`.
- Server: `lib/swingTradeLedger.ts`, `lib/swingTradeLedgerPython.ts`, mutation actions/routes.
- Python authority: `pipelines/strategy_math/ledger.py` using `Decimal`.
- Tables include ledger trades/sales, pending orders/fills and mobile idempotency.
- Every mobile mutation requires a stable idempotency UUID.
- Focused checks: ledger Python/parity tests, mutation ownership/idempotency tests.
