# Portfolio and funds module

This module covers what the user already owns, as distinct from what the strategies suggest. It
imports Consolidated Account Statements, preserves ISIN and folio identity, and bridges fund
identifiers through AMFI data to published AMC portfolio snapshots. That bridge is what makes
look-through possible: seeing the underlying stocks inside the funds, and the overlap between funds
that appear different but hold the same companies.

Gmail discovery can process the latest CAS and matching AMC disclosures automatically when the user
enables it; ambiguous matches stay queued for review rather than being guessed. Attachment bytes and
email bodies are not retained as document storage.

## Boundaries and invariants

- Owns holdings, CAS imports, mutual-fund identity/mapping, AMC snapshots, look-through and overlap.
- Web entries: portfolio routes and `app/terminal/in/cas/page.tsx`.
- Server: `lib/portfolio*`, `lib/cas/`, `lib/funds/`, fund actions and imports.
- User ownership and ISIN/folio identity are mandatory boundaries.
- Current overlap calculations are TypeScript and can be migrated independently from trading strategies.
- Mobile target: holdings/allocation first, then CAS review, mapping and overlap.
- Focused checks: CAS parser/import, mapping, fund identity and overlap tests.
