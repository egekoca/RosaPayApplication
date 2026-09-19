import Foundation
import LocalAuthentication
import React
import Security

/// Signs with a secp256r1 key held in the Secure Enclave. The private key is
/// generated inside the enclave, is never exported, and each signature requires
/// a fresh user-presence check bound to that key.
@objc(RosaPaySigner)
final class RosaPaySigner: NSObject {
  private let keyTag = "com.rosapay.device-signer".data(using: .utf8)!
  private let signerId = "com.rosapay.device-signer"

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func loadPrivateKey() -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
    // swiftlint:disable:next force_cast
    return (item as! SecKey)
  }

  private func publicKeyPoint(for privateKey: SecKey) throws -> Data {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw SignerError.unavailable("The public key could not be read")
    }
    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw SignerError.unavailable("The public key could not be exported")
    }
    return data
  }

  private func identity(for privateKey: SecKey) throws -> [String: Any] {
    [
      "signerId": signerId,
      "publicKey": try publicKeyPoint(for: privateKey).base64EncodedString(),
      "kind": "device-key",
    ]
  }

  @objc(getIdentity:rejecter:)
  func getIdentity(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    guard let privateKey = loadPrivateKey() else {
      resolve(nil)
      return
    }
    do {
      resolve(try identity(for: privateKey))
    } catch {
      reject("UNAVAILABLE", error.localizedDescription, error)
    }
  }

  @objc(createIdentity:resolver:rejecter:)
  func createIdentity(displayName: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    var context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
      reject("UNAVAILABLE", "This device has no usable screen lock, so a payment key cannot be protected", authError)
      return
    }

    var accessError: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      [.privateKeyUsage, .userPresence],
      &accessError
    ) else {
      reject("UNAVAILABLE", "The key protection policy could not be created", accessError?.takeRetainedValue())
      return
    }

    // Replace any previous key so a reinstall never signs with a stale identity.
    SecItemDelete([
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
    ] as CFDictionary)

    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrAccessControl as String: access,
      ],
    ]
    // The Simulator has no Secure Enclave; the key stays in the keychain there.
    #if !targetEnvironment(simulator)
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    #endif

    var createError: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &createError) else {
      reject("UNAVAILABLE", "The payment key could not be created", createError?.takeRetainedValue())
      return
    }
    do {
      resolve(try identity(for: privateKey))
    } catch {
      reject("UNAVAILABLE", error.localizedDescription, error)
    }
    context = LAContext()
  }

  @objc(deleteIdentity:rejecter:)
  func deleteIdentity(resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    let status = SecItemDelete([
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ] as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      reject("UNAVAILABLE", "The payment key could not be deleted", NSError(domain: NSOSStatusErrorDomain, code: Int(status)))
      return
    }
    resolve(nil)
  }

  /// Signs the exact digest the caller passes; the payment is already decided.
  @objc(signDigest:resolver:rejecter:)
  func signDigest(request: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let digestBase64 = request["digest"] as? String,
          let digest = Data(base64Encoded: digestBase64), digest.count == 32 else {
      reject("INVALID_REQUEST", "A 32-byte digest is required", nil)
      return
    }
    guard let privateKey = loadPrivateKey() else {
      reject("UNAVAILABLE", "No payment key exists on this device", nil)
      return
    }

    let context = LAContext()
    context.localizedReason = (request["reason"] as? String) ?? "Approve this payment"
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: context.localizedReason) { success, error in
      guard success else {
        let code = (error as? LAError)?.code
        let mapped: String
        switch code {
        case .userCancel, .appCancel, .systemCancel: mapped = "USER_CANCELLED"
        case .biometryLockout: mapped = "LOCKED_OUT"
        default: mapped = "BIOMETRIC_FAILED"
        }
        reject(mapped, error?.localizedDescription ?? "The payment was not authorized", error)
        return
      }

      var signError: Unmanaged<CFError>?
      guard let signature = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureDigestX962SHA256,
        digest as CFData,
        &signError
      ) as Data? else {
        reject("BIOMETRIC_FAILED", "The payment could not be signed", signError?.takeRetainedValue())
        return
      }

      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      resolve([
        "signerId": self.signerId,
        "signature": signature.base64EncodedString(),
        "signedAt": formatter.string(from: Date()),
      ])
    }
  }

  @objc(authorizePayment:resolver:rejecter:)
  func authorizePayment(request: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let intentHash = request["intentHash"] as? String, let digest = Data(hex: intentHash) else {
      reject("INVALID_REQUEST", "An intent hash is required", nil)
      return
    }
    signDigest(
      request: ["digest": digest.base64EncodedString(), "reason": "Approve this payment"] as NSDictionary,
      resolve: resolve,
      reject: reject
    )
  }

  @objc(signTransaction:resolver:rejecter:)
  func signTransaction(request: NSDictionary, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // The relayer is the transaction source, so the device never signs envelopes.
    reject("UNAVAILABLE", "This device signs authorization entries, not transactions", nil)
  }

  @objc(signAuthEntry:resolver:rejecter:)
  func signAuthEntry(request: NSDictionary, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    reject("UNAVAILABLE", "Authorization entries are assembled in JavaScript and signed through signDigest", nil)
  }
}

private enum SignerError: Error, LocalizedError {
  case unavailable(String)

  var errorDescription: String? {
    switch self {
    case let .unavailable(message): return message
    }
  }
}

private extension Data {
  init?(hex: String) {
    let characters = Array(hex)
    guard characters.count % 2 == 0 else { return nil }
    var bytes = [UInt8]()
    bytes.reserveCapacity(characters.count / 2)
    for index in stride(from: 0, to: characters.count, by: 2) {
      guard let byte = UInt8(String(characters[index ... index + 1]), radix: 16) else { return nil }
      bytes.append(byte)
    }
    self.init(bytes)
  }
}
