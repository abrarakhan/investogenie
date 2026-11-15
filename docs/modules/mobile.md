# Mobile client module

- Owns native navigation, authentication, cache, presentation, charts, mutations, push and biometrics.
- Client root: `mobile/App.tsx`; server APIs: `/api/v1/mobile/`; screen serializer: `lib/mobileScreens.ts`.
- Mobile must not calculate eligibility, ranking, levels, P&L, ROI or XIRR.
- Read-only features should use the generic server-driven screen contract; mutation-heavy features use dedicated views.
- Planned work: feature registry, lazy screens, ETags/deltas, pagination, optimistic idempotent mutations and version synchronization.
- Release checks: mobile typecheck, HTTPS validation, Android/iOS local builds and physical-device tests.
