# News & AI module

News & AI overlays real-world events onto candidates that the technical engines already produced. It
queries news providers independently, merges what succeeds, deduplicates to a canonical story, and
assesses whether evidence is specific to a stock or merely sector- or market-wide.

The hard boundary: news may raise caution or risk, and may never create a technical setup. Broad or
uncorroborated stories are treated as cautionary rather than actionable. Coverage is prioritised -
open ledger trades first, then Strong Swing, then broader Swing - because provider quotas are finite
and an open position matters more than a watchlist entry.

## Boundaries and invariants

- Owns provider ingestion, evidence deduplication, classification, candidate overlays and trade-risk monitoring.
- Web entry: `app/terminal/[market]/news-swing/page.tsx`.
- Server: `lib/newsSwing.ts`, `lib/news/`; Python owns the numerical overlay through the strategy bridge.
- News may alter caution/risk context but must never create a technical setup.
- User provider credentials remain encrypted and scoped; shared refresh controls are admin-only.
- Mobile target: evidence links, provenance and risk history with cached summaries.
- Focused checks: news classifier/sync/overlay tests and provider authorization tests.
