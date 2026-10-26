/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins load as CommonJS. */
// Adopt the UIKit scene-based life cycle, which the iOS 27 SDK requires at launch: an app built
// with it and no scene manifest fails with "UIScene life cycle is required for apps built with
// this SDK". Expo SDK 57 ships `ExpoAppSceneDelegate` (Objective-C name EXExpoAppSceneDelegate)
// but its prebuild template still creates the window in the app delegate. This plugin, applied
// on every `expo prebuild`, registers the scene delegate and hands window creation to it.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;
const CLASS_LINE = "class AppDelegate: ExpoAppDelegate {";
const PROVIDER_LINE = "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

function adoptSceneDelegate(contents) {
  if (contents.includes(PROVIDER_LINE)) return contents; // already applied
  if (!contents.includes(CLASS_LINE) || !WINDOW_BLOCK.test(contents)) {
    // Fail the prebuild instead of producing an app that crashes at launch.
    throw new Error("withSceneLifecycle: the generated AppDelegate.swift changed shape; update plugins/withSceneLifecycle.js");
  }
  return contents
    .replace(CLASS_LINE, PROVIDER_LINE)
    .replace(WINDOW_BLOCK, "\n    // The window is created by EXExpoAppSceneDelegate (UIScene life cycle).\n");
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: "Default Configuration",
          UISceneDelegateClassName: "EXExpoAppSceneDelegate",
        }],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("withSceneLifecycle: expected a Swift AppDelegate");
    }
    mod.modResults.contents = adoptSceneDelegate(mod.modResults.contents);
    return mod;
  });
};

module.exports.adoptSceneDelegate = adoptSceneDelegate;
