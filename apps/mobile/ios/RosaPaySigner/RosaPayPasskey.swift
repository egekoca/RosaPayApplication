import AuthenticationServices
import Foundation
import React
import UIKit

/// Creates and uses a passkey, so a wallet is not lost with the phone that made it.
///
/// The Secure Enclave key next door is bound to this handset by design: it
/// cannot be copied anywhere, which is what makes it safe and also what makes an
/// account die with the device. A passkey is the same P-256 cryptography with
/// one difference that matters here - iCloud Keychain replicates the credential
/// to the owner's other devices, so the account survives.
///
/// Everything the platform returns is passed straight through as base64. The
/// public key is not parsed here: registration returns a CBOR attestation
/// object, and reading it in Swift would mean writing that parser twice, once
/// more in Kotlin. It is read in TypeScript instead, where it is tested against
/// a real Apple attestation.
@objc(RosaPayPasskey)
final class RosaPayPasskey: NSObject {
  /// The domain the credential is scoped to. It must match an `webcredentials:`
  /// entry in the app's Associated Domains entitlement and be served by that
  /// domain's `apple-app-site-association` file, or the system refuses before
  /// the user sees anything.
  private static let defaultRelyingParty = "lumenade-pay.vercel.app"

  private var activeDelegate: PasskeyDelegate?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc(isSupported:rejecter:)
  func isSupported(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    if #available(iOS 16.0, *) {
      resolve(true)
    } else {
      resolve(false)
    }
  }

  /// Registers a new passkey and returns what the platform produced, unread.
  @objc(createCredential:resolver:rejecter:)
  func createCredential(
    request: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.0, *) else {
      reject("UNSUPPORTED", "Passkeys need iOS 16 or later", nil)
      return
    }
    guard let challenge = Self.decode(request["challenge"]) else {
      reject("INVALID_REQUEST", "A base64url challenge is required", nil)
      return
    }
    guard let userId = Self.decode(request["userId"]) else {
      reject("INVALID_REQUEST", "A base64url user id is required", nil)
      return
    }
    let name = (request["name"] as? String) ?? "Lumenade Pay"
    let relyingParty = (request["relyingParty"] as? String) ?? Self.defaultRelyingParty

    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: relyingParty
    )
    let registration = provider.createCredentialRegistrationRequest(
      challenge: challenge,
      name: name,
      userID: userId
    )
    // The wallet contract refuses an assertion whose user-verified bit is clear,
    // so asking for anything less would only fail later, on-chain.
    registration.userVerificationPreference = .required

    perform(requests: [registration], resolve: resolve, reject: reject)
  }

  /// Asks the passkey to sign a challenge, and returns the three pieces the
  /// contract needs to check that it signed *this* transaction.
  @objc(assert:resolver:rejecter:)
  func assert(
    request: NSDictionary,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard #available(iOS 16.0, *) else {
      reject("UNSUPPORTED", "Passkeys need iOS 16 or later", nil)
      return
    }
    guard let challenge = Self.decode(request["challenge"]) else {
      reject("INVALID_REQUEST", "A base64url challenge is required", nil)
      return
    }
    let relyingParty = (request["relyingParty"] as? String) ?? Self.defaultRelyingParty

    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: relyingParty
    )
    let assertion = provider.createCredentialAssertionRequest(challenge: challenge)
    assertion.userVerificationPreference = .required
    // Scoping to the wallet's own credential stops the system offering an
    // unrelated passkey for this domain, which would sign something the wallet
    // would then refuse.
    if let credentialId = Self.decode(request["credentialId"]) {
      assertion.allowedCredentials = [
        ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: credentialId)
      ]
    }

    perform(requests: [assertion], resolve: resolve, reject: reject)
  }

  private func perform(
    requests: [ASAuthorizationRequest],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let controller = ASAuthorizationController(authorizationRequests: requests)
      // The delegate is held here because `ASAuthorizationController` does not
      // retain it, and a released delegate means a prompt that never answers.
      let delegate = PasskeyDelegate(
        onFinish: { [weak self] result in
          self?.activeDelegate = nil
          switch result {
          case .success(let payload): resolve(payload)
          case .failure(let error): reject(error.code, error.message, error.underlying)
          }
        }
      )
      self.activeDelegate = delegate
      controller.delegate = delegate
      controller.presentationContextProvider = delegate
      controller.performRequests()
    }
  }

  /// Accepts base64url, which is what WebAuthn uses everywhere, and plain
  /// base64, so a caller that already had bytes is not forced to re-encode.
  private static func decode(_ value: Any?) -> Data? {
    guard let text = value as? String, !text.isEmpty else { return nil }
    var normalized = text.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while normalized.count % 4 != 0 { normalized.append("=") }
    return Data(base64Encoded: normalized)
  }
}

private struct PasskeyFailure {
  let code: String
  let message: String
  let underlying: Error?
}

private final class PasskeyDelegate: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private let onFinish: (Result<[String: Any], PasskeyFailure>) -> Void

  init(onFinish: @escaping (Result<[String: Any], PasskeyFailure>) -> Void) {
    self.onFinish = onFinish
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    if #available(iOS 16.0, *) {
      if let registration = authorization.credential
        as? ASAuthorizationPlatformPublicKeyCredentialRegistration
      {
        guard let attestation = registration.rawAttestationObject else {
          onFinish(
            .failure(
              PasskeyFailure(
                code: "UNAVAILABLE",
                message: "The authenticator returned no attestation, so the public key cannot be read",
                underlying: nil
              )))
          return
        }
        onFinish(
          .success([
            "kind": "registration",
            "credentialId": registration.credentialID.base64URLEncodedString(),
            "attestationObject": attestation.base64URLEncodedString(),
            "clientDataJSON": registration.rawClientDataJSON.base64URLEncodedString(),
          ]))
        return
      }
      if let assertion = authorization.credential
        as? ASAuthorizationPlatformPublicKeyCredentialAssertion
      {
        onFinish(
          .success([
            "kind": "assertion",
            "credentialId": assertion.credentialID.base64URLEncodedString(),
            "authenticatorData": assertion.rawAuthenticatorData.base64URLEncodedString(),
            "clientDataJSON": assertion.rawClientDataJSON.base64URLEncodedString(),
            "signature": assertion.signature.base64URLEncodedString(),
            "userId": assertion.userID.base64URLEncodedString(),
          ]))
        return
      }
    }
    onFinish(
      .failure(
        PasskeyFailure(
          code: "UNAVAILABLE",
          message: "The system returned a credential this app does not use",
          underlying: nil
        )))
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    // A cancelled prompt is an ordinary outcome and must not read as a failure
    // the customer needs to do something about.
    let code: String
    if let authorizationError = error as? ASAuthorizationError {
      switch authorizationError.code {
      case .canceled: code = "USER_CANCELLED"
      case .notHandled, .failed: code = "PASSKEY_FAILED"
      case .invalidResponse: code = "PASSKEY_FAILED"
      case .notInteractive: code = "PASSKEY_FAILED"
      default: code = "PASSKEY_FAILED"
      }
    } else {
      code = "PASSKEY_FAILED"
    }
    onFinish(.failure(PasskeyFailure(code: code, message: error.localizedDescription, underlying: error)))
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window =
      scenes.first(where: { $0.activationState == .foregroundActive })?.keyWindow
      ?? scenes.first?.keyWindow
    return window ?? ASPresentationAnchor()
  }
}

extension Data {
  /// WebAuthn speaks base64url without padding, and so does the wallet.
  fileprivate func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
