# InvestoGenie Mobile Privacy

_Source behavior reviewed 26 October 2026 through runtime revision `1c7aac3`._

InvestoGenie Mobile connects to the owner's configured InvestoGenie server.

- Login credentials are sent to the configured API origin. Use HTTPS for deployed builds.
- The raw session token is stored in OS-backed SecureStore. The server stores its SHA-256 hash,
  expiry and device/session metadata.
- Trade, portfolio and detailed candidate data are fetched from authenticated server APIs.
- Ledger notifications contain generic state-change text.
- Ready-candidate notifications include the stock ticker, readiness state and engine name.
  Expo push delivery receives that text and the device push token. Detailed prices, quantities,
  portfolio values and broker data are excluded from these payloads.
- Server candidate evaluation and status-observation storage occur for an account even when it has
  no enabled Expo token. Token enrollment controls push delivery, not server-side monitoring.
- Biometric checks use platform authentication; the app does not receive or store biometric
  templates. Device fallback may be used where supported.
- Mobile purchase/sale actions record ledger events. They do not directly submit broker orders.
  Separately enabled server-side Breeze automation has its own controls.
- External news links open when selected and are subject to the destination's data practices.

Sign-out revokes the active mobile session and disables its registered push token. Existing
server-side records follow the deployment owner's retention and backup policy; sign-out does not
erase ledger history.

Local native builds avoid uploading source through EAS Build when that path is used, but push
delivery still uses Expo. EAS Build scripts remain available in the repository and must be chosen
deliberately. See [mobile setup](README.md) for configuration limits.
