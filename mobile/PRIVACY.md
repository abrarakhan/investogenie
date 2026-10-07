# InvestoGenie Mobile Privacy

InvestoGenie Mobile is a private companion to the owner's InvestoGenie deployment.

- Authentication credentials are sent only to the configured InvestoGenie HTTPS server.
- The device session token is stored in the operating system's secure storage. The server stores
  only its SHA-256 hash.
- Trade, portfolio and news details remain in InvestoGenie. Ready-candidate notifications include
  the stock ticker, readiness state and engine name so the owner can identify the setup.
- Expo push delivery receives the device push token and the notification text. Detailed prices,
  quantities, portfolio values and broker data are not included in push payloads.
- Biometric verification is handled by Android or iOS. Biometric data is never available to or
  stored by InvestoGenie.
- The app does not place broker orders. Trade entries and sales are user-recorded ledger events.
- External news links open only when selected by the user.

Access can be revoked by signing out, which revokes the active mobile session and disables its push
token. Server-side records follow the retention and backup policy of the owner's deployment.
