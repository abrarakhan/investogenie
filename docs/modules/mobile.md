# Mobile client module

- Owns native navigation, authentication, cache, presentation, charts, mutations, push and biometrics.
- Client shell: `mobile/App.tsx`; lazy features: `mobile/src/features/`; shared presentation and formatting: `mobile/src/ui.tsx` and `mobile/src/format.ts`; server APIs: `/api/v1/mobile/`; screen serializer: `lib/mobileScreens.ts`.
- Mobile must not calculate eligibility, ranking, levels, P&L, ROI or XIRR.
- Read-only features should use the generic server-driven screen contract; mutation-heavy features use dedicated views.
- Generic card screens use private ETags and 20-card cursor pages; unchanged polling returns `304` and long lists load incrementally.
- `mobile/src/features/registry.ts` is the single navigation manifest and safely admits new server-driven card screens without a native release.
- Market Overview, Momentum V2 and Trend Continuation use the generic card contract, so parity adds no native screen code.
- News, Ledger and the generic card renderer are isolated behind lazy feature boundaries. The installed React Native binary still contains one Hermes bundle; this defers module evaluation and narrows change scope rather than downloading code on demand.
- Remaining work: delta responses, optimistic idempotent mutation presentation and signed physical-device validation.
- Release checks: mobile typecheck, HTTPS validation, Android/iOS local builds and physical-device tests.
