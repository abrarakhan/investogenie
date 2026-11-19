# Portfolio and funds module

- Owns holdings, CAS imports, mutual-fund identity/mapping, AMC snapshots, look-through and overlap.
- Web entries: portfolio routes and `app/terminal/in/cas/page.tsx`.
- Server: `lib/portfolio*`, `lib/cas/`, `lib/funds/`, fund actions and imports.
- User ownership and ISIN/folio identity are mandatory boundaries.
- Current overlap calculations are TypeScript and can be migrated independently from trading strategies.
- Mobile target: holdings/allocation first, then CAS review, mapping and overlap.
- Focused checks: CAS parser/import, mapping, fund identity and overlap tests.
