import { readFile } from "node:fs/promises";

const app = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
const eas = JSON.parse(await readFile(new URL("../eas.json", import.meta.url), "utf8"));
const failures = [];

for (const profile of ["preview", "production"]) {
  const url = eas.build?.[profile]?.env?.EXPO_PUBLIC_API_URL;
  if (!url || !/^https:\/\//.test(url)) failures.push(`${profile} must define an HTTPS EXPO_PUBLIC_API_URL`);
}
if (!app.expo?.android?.package) failures.push("android.package is required");
if (!app.expo?.ios?.bundleIdentifier) failures.push("ios.bundleIdentifier is required");
if (!app.expo?.plugins?.includes("expo-notifications")) failures.push("expo-notifications plugin is required");

if (failures.length) {
  console.error(`Release validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Release configuration verified for ${app.expo.android.package} and ${app.expo.ios.bundleIdentifier}.`);
