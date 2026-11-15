# News & AI module

- Owns provider ingestion, evidence deduplication, classification, candidate overlays and trade-risk monitoring.
- Web entry: `app/terminal/[market]/news-swing/page.tsx`.
- Server: `lib/newsSwing.ts`, `lib/news/`; Python owns the numerical overlay through the strategy bridge.
- News may alter caution/risk context but must never create a technical setup.
- User provider credentials remain encrypted and scoped; shared refresh controls are admin-only.
- Mobile target: evidence links, provenance and risk history with cached summaries.
- Focused checks: news classifier/sync/overlay tests and provider authorization tests.
