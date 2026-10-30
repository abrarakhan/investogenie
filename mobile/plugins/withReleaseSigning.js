/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins load as CommonJS. */
// Sign Android release builds with the upload key instead of the template's debug key. The key
// and its passwords never enter the repository: Gradle reads them from ~/.gradle/gradle.properties
// (INVESTOGENIE_UPLOAD_STORE_FILE, _STORE_PASSWORD, _KEY_ALIAS, _KEY_PASSWORD). Applied on every
// `expo prebuild`, so the regenerated android/ project keeps release signing.
const { withAppBuildGradle } = require("expo/config-plugins");

const DEBUG_CONFIG = /(signingConfigs \{\n\s*debug \{[^}]*\})/;
const RELEASE_USES_DEBUG = /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/;
const RELEASE_CONFIG = `
        release {
            if (findProperty('INVESTOGENIE_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('INVESTOGENIE_UPLOAD_STORE_FILE'))
                storePassword findProperty('INVESTOGENIE_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('INVESTOGENIE_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('INVESTOGENIE_UPLOAD_KEY_PASSWORD')
            }
        }`;

function useReleaseSigning(contents) {
  if (contents.includes("INVESTOGENIE_UPLOAD_STORE_FILE")) return contents; // already applied
  if (!DEBUG_CONFIG.test(contents) || !RELEASE_USES_DEBUG.test(contents)) {
    // Fail the prebuild instead of silently shipping a debug-signed release.
    throw new Error("withReleaseSigning: the generated app/build.gradle changed shape; update plugins/withReleaseSigning.js");
  }
  return contents
    .replace(DEBUG_CONFIG, `$1${RELEASE_CONFIG}`)
    .replace(RELEASE_USES_DEBUG, "$1signingConfig signingConfigs.release");
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = useReleaseSigning(mod.modResults.contents);
    return mod;
  });
};
module.exports.useReleaseSigning = useReleaseSigning;
