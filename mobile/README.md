# InvestoGenie Mobile

_Source reviewed 25 October 2026 at main revision `42eea8f`._

Android/iOS companion using server-ranked Strong Swing, News & AI Swing and Trade Ledger results.
The client does not reproduce financial analytics.

## Setup

Apply the server's ordered schema, including mobile sessions (0044), push (0045), ledger returns
(0046) and candidate alerts (0050), plus later migrations used by the current server.

```bash
cd mobile
cp .env.example .env
npm ci
npm start
```

Set `EXPO_PUBLIC_API_URL` to the intended HTTPS deployment. Use an appropriate emulator or native
development build; push and biometric capabilities require supported native environments, and
push registration requires a physical device.

Tokens are random 256-bit values kept in SecureStore; PostgreSQL stores SHA-256 hashes. Sessions
expire after 30 days. Sign-out revokes the device session and disables its push registration.

## Implemented surfaces

- Login, India/US selection and Strong Swing gate detail.
- Server-ranked News & AI candidates with evidence links.
- Ledger purchase creation, edit/delete, partial/final sales and sale correction.
- Server-calculated capital employed, P&L, ROI and XIRR.
- Price profiles, native SVG candles and five-minute foreground refresh.
- Biometric session re-entry when available.
- Opt-in ledger state-change and ready-candidate notifications.

Adaptive Allocation and Armed Swing do not have dedicated mobile API/workspace routes in this
revision. Web pending buy-stop recording is likewise a separate workflow. Mobile ledger entries
record trades; they do not directly submit broker orders.

Ledger alerts are generic. Ready-candidate messages include ticker, readiness and engine for
Strong Swing, legacy Momentum Ignition and Momentum Ignition V2. Expo receives notification text
and push tokens, but no detailed prices, quantities, portfolio values or broker data.
See [privacy](PRIVACY.md).

## Local builds and configuration

The documented distribution path is local Expo Prebuild followed by Gradle/Android Studio or
Xcode signing. Set the API environment explicitly before bundling:

```bash
npm run typecheck
npm run validate:release
# Set EXPO_PUBLIC_API_URL for this build in your shell or local environment first.
npx expo prebuild
```

Then build/sign using the generated native project and platform tools. Prebuild changes native
files; review generated configuration and test the resulting binary against the intended server.

Two existing package scripts (`build:android:preview`, `build:production`) still invoke EAS Build.
Use them only when cloud building is intentionally chosen. `eas.json` remains committed, and
`validate:release` checks HTTPS URLs in its preview/production profiles, bundle identifiers and
the notification plugin. It does not validate the environment embedded by a separate local build.

The app has an EAS project ID for Expo push registration. Local building does not remove Expo
push-relay dependence. No Expo Updates package is declared.

`app.json` declares version 0.1.1, Android versionCode 2 and iOS buildNumber 2;
`package.json` remains 0.1.0. These are source metadata, not evidence of a built or installed app.

## Server API

Versioned endpoints under `/api/v1/mobile/` provide auth login/logout, me, Strong Swing, News & AI,
ledger and nested sale mutations, asset search, candles and push-token registration. The server
enforces authentication and owns projections/ranking. Verify API compatibility and installed
binary behavior on physical devices before distribution.
