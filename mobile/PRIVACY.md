# InvestoGenie Mobile Privacy

InvestoGenie Mobile is a private companion to the owner's InvestoGenie deployment.

- Authentication credentials are sent only to the configured InvestoGenie HTTPS server.
- The device session token is stored in the operating system's secure storage. The server stores
  only its SHA-256 hash.
- Trade, portfolio, market and news data remain in InvestoGenie and are not included in third-party
  push payloads.
- Expo push delivery receives only a device push token and a generic notification saying that an
  authenticated ledger review is required.
- Biometric verification is handled by Android or iOS. Biometric data is never available to or
  stored by InvestoGenie.
- The app does not place broker orders. Trade entries and sales are user-recorded ledger events.
- External news links open only when selected by the user.

Access can be revoked by signing out, which revokes the active mobile session and disables its push
token. Server-side records follow the retention and backup policy of the owner's deployment.
