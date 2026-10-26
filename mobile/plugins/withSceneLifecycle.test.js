const test = require("node:test");
const assert = require("node:assert/strict");
const { adoptSceneDelegate } = require("./withSceneLifecycle");

const TEMPLATE = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;

test("hands window creation to the scene delegate", () => {
  const out = adoptSceneDelegate(TEMPLATE);
  assert.match(out, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider \{/);
  assert.doesNotMatch(out, /UIWindow\(frame:/);
  assert.doesNotMatch(out, /startReactNative/);
  assert.match(out, /return super\.application/);
});

test("is idempotent", () => {
  const once = adoptSceneDelegate(TEMPLATE);
  assert.equal(adoptSceneDelegate(once), once);
});

test("fails loudly when the template changes shape", () => {
  assert.throws(() => adoptSceneDelegate("class AppDelegate: SomethingElse {}"), /changed shape/);
});
