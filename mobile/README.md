# InvestoGenie Mobile - Phase 1

Read-only Expo application for Android and iOS. It uses the same server-side Strong Swing and
Trade Ledger calculations as the web terminal; the device only renders API results.

## Run

1. Apply database migration `0044_mobile_sessions.sql` to the InvestoGenie database.
2. Copy `.env.example` to `.env` and point `EXPO_PUBLIC_API_URL` at the HTTPS deployment.
3. Run `npm install` inside `mobile/`.
4. Run `npm start`, then open the project with Expo Go or an emulator.

Tokens are random 256-bit credentials stored with Expo SecureStore. The server stores only their
SHA-256 hashes, sessions expire after 30 days, and sign-out revokes the active device session.

Phase 1 includes login, India/US selection, ranked Strong Swing candidates, candidate gate detail,
and a read-only Trade Ledger with aggregate P&L and server-generated trade risk.

Phase 2 adds authenticated trade creation from an Execution Ready Strong Swing plan, edit/delete,
partial and final sale recording, sale editing, a 50-session price profile, and five-minute refresh
while the app is open. Every projection is still calculated and frozen by the existing server engine.
