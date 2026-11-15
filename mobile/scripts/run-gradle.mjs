import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const task = process.argv[2];
if (!task) {
  console.error("Usage: node scripts/run-gradle.mjs <gradle-task>");
  process.exit(2);
}

const sdk = process.env.ANDROID_HOME
  ?? process.env.ANDROID_SDK_ROOT
  ?? join(homedir(), "Library", "Android", "sdk");

if (!existsSync(sdk)) {
  console.error(`Android SDK was not found at ${sdk}. Set ANDROID_HOME or ANDROID_SDK_ROOT.`);
  process.exit(1);
}

const result = spawnSync("./gradlew", [task], {
  cwd: new URL("../android/", import.meta.url),
  env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
