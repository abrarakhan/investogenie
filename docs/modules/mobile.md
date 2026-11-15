# Mobile client module

- Owns native navigation, authentication, cache, presentation, charts, mutations, push and biometrics.
- Client root: `mobile/App.tsx`; server APIs: `/api/v1/mobile/`; screen serializer: `lib/mobileScreens.ts`.
- Mobile must not calculate eligibility, ranking, levels, P&L, ROI or XIRR.
- Read-only features should use the generic server-driven screen contract; mutation-heavy features use dedicated views.
- Generic card screens use private ETags and 20-card cursor pages; unchanged polling returns `304` and long lists load incrementally.
- `mobile/src/features/registry.ts` is the single navigation manifest and safely admits new server-driven card screens without a native release.
- Planned work: split dedicated screens for lazy loading, delta responses, optimistic idempotent mutations and version synchronization.
- Release checks: mobile typecheck, HTTPS validation, Android/iOS local builds and physical-device tests.
