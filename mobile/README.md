# InvestoGenie Mobile

_Source reviewed 26 October 2026 through runtime revision `1c7aac3`._

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
- Stock Screener (server sort and search), Swing Candidates (strategy filter), Armed Strong Swing
  (buy-stop plan and gates, read-only) and Long-Term Candidates (investor filter).
- Server-ranked News & AI candidates with evidence links.
- Ledger purchase creation, edit/delete, partial/final sales and sale correction.
- Server-calculated capital employed, P&L, ROI and XIRR.
- Price profiles, native SVG candles and five-minute foreground refresh.
- Biometric session re-entry when available.
- Opt-in ledger state-change and ready-candidate notifications (Android; iOS push is off for now).

Adaptive Allocation does not have a mobile route in this revision. Armed Swing pending buy-stop
orders and fills are recorded on the web terminal. Mobile ledger entries
record trades; they do not directly submit broker orders.

## Local release builds

`validate:release` checks `EXPO_PUBLIC_API_URL` (from the environment or `mobile/.env`) is HTTPS.
Both build scripts run it first, then regenerate the native project with `expo prebuild --clean`;
the generated `ios/` and `android/` folders are not committed.

- Android: `npm run build:android:release` builds a release APK with Gradle
  (`android/app/build/outputs/apk/release/`). Sign it with your release keystore.
- iOS: `npm run build:ios:release` builds the Release configuration with Xcode. It needs full Xcode
  (not only the Command Line Tools) selected with `xcode-select`, CocoaPods, and an Apple signing team
  set in Xcode for a device build.

## Trade logging and security

A Strong Swing purchase sends only the candidate's server-held `planId`; the server validates it
(same market session, captured within 30 minutes, price at or above the entry and below the
target) and reads every level from the plan. Candidates without a plan cannot be logged.

The app locks with biometrics, or the device passcode when no biometrics are enrolled, on launch
and after 60 seconds in the background. Opening the app from a notification still requires the
unlock. Offline at launch keeps the saved session and offers a retry; only a rejected token signs
the device out.

Push alerts are Android-only for now. iOS push is off until direct APNs delivery (or an APNs key
for Expo's relay) is set up.

Ledger alerts are generic. Ready-candidate messages include ticker, readiness and engine for
Strong Swing, legacy Momentum Ignition and Momentum Ignition V2. Expo receives notification text
and push tokens, but no detailed prices, quantities, portfolio values or broker data.
Server scans still evaluate and persist candidate status observations when no Expo token is enabled;
token registration affects delivery only. During an open India session, Momentum readiness is
server-authoritative and requires verified fresh Breeze quote and live OHLCV evidence.
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
ledger and nested sale mutations, asset search, candles and push-token registration.

`GET /api/v1/mobile/screens` returns the tab list and `GET /api/v1/mobile/screens/{key}` returns a
server-built screen: cards whose values are already computed and formatted, plus option chips and
detail sections. Both apps render these with one generic view (`CardScreen` in `App.tsx`), so a new
read-only screen is added in `lib/mobileScreens.ts` on the server without an Android or iOS change.
Screens that mutate data (Strong Swing trade logging, the ledger) stay as dedicated views. The server
enforces authentication and owns projections/ranking. Verify API compatibility and installed
binary behavior on physical devices before distribution.
