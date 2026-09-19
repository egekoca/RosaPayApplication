import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "RosaPay",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

@objc(RosaPaySigner)
final class RosaPaySigner: NSObject, RCTBridgeModule {
  @objc static func moduleName() -> String! { "RosaPaySigner" }
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func unavailable(_ reject: RCTPromiseRejectBlock) {
    reject("UNAVAILABLE", "Native passkey signer is not installed", nil)
  }

  @objc(getIdentity:rejecter:)
  func getIdentity(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { unavailable(reject) }

  @objc(createIdentity:resolver:rejecter:)
  func createIdentity(_ displayName: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { unavailable(reject) }

  @objc(authorizePayment:resolver:rejecter:)
  func authorizePayment(_ request: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { unavailable(reject) }

  @objc(signTransaction:resolver:rejecter:)
  func signTransaction(_ request: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { unavailable(reject) }

  @objc(signAuthEntry:resolver:rejecter:)
  func signAuthEntry(_ request: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { unavailable(reject) }
}
