/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins load as CommonJS. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { useReleaseSigning } = require("./withReleaseSigning");

const TEMPLATE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }`;

test("release builds use the upload key from Gradle properties", () => {
  const result = useReleaseSigning(TEMPLATE);
  assert.match(result, /release \{\n\s*if \(findProperty\('INVESTOGENIE_UPLOAD_STORE_FILE'\)\)/);
  assert.match(result, /\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*signingConfig signingConfigs\.release/);
  assert.match(result, /debug \{\n\s*signingConfig signingConfigs\.debug/);
});

test("applying twice changes nothing", () => {
  const once = useReleaseSigning(TEMPLATE);
  assert.equal(useReleaseSigning(once), once);
});

test("an unexpected template fails the prebuild", () => {
  assert.throws(() => useReleaseSigning("android { }"), /changed shape/);
});
