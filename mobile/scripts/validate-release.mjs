import { readFile } from "node:fs/promises";

// Release builds are local (Expo Prebuild + Gradle/Xcode), so the server address comes from the
// environment or mobile/.env, which Expo CLI loads at build time — not from an EAS cloud profile.
const app = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
const dotenv = await readFile(new URL("../.env", import.meta.url), "utf8").catch(() => "");
const fromFile = dotenv.match(/^\s*EXPO_PUBLIC_API_URL\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "");
const url = process.env.EXPO_PUBLIC_API_URL ?? fromFile;
const failures = [];

if (!url || !/^https:\/\//.test(url)) {
  failures.push("EXPO_PUBLIC_API_URL must be an HTTPS URL (set it in mobile/.env; see .env.example)");
}
if (!app.expo?.android?.package) failures.push("android.package is required");
if (!app.expo?.ios?.bundleIdentifier) failures.push("ios.bundleIdentifier is required");
if (!app.expo?.plugins?.includes("expo-notifications")) failures.push("expo-notifications plugin is required");

if (failures.length) {
  console.error(`Release validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Release configuration verified for ${app.expo.android.package} and ${app.expo.ios.bundleIdentifier} against ${url}.`);
