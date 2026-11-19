# Trade Ledger module

- Owns purchases, sales, pending orders, immutable-plan linkage, P&L, ROI, XIRR, GTT and follow-up guidance.
- Web entry: `app/terminal/[market]/trade-ledger/page.tsx`; mobile APIs under `/api/v1/mobile/trade-ledger`.
- Server: `lib/swingTradeLedger.ts`, `lib/swingTradeLedgerPython.ts`, mutation actions/routes.
- Python authority: `pipelines/strategy_math/ledger.py` using `Decimal`.
- Tables include ledger trades/sales, pending orders/fills and mobile idempotency.
- Every mobile mutation requires a stable idempotency UUID.
- Focused checks: ledger Python/parity tests, mutation ownership/idempotency tests.
