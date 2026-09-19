package com.rosapay

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Date
import java.util.concurrent.Executor
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Signs with a secp256r1 key held in the Android Keystore. The private key is
 * generated inside the keystore, is never exported, and every signature requires
 * a fresh user-presence check bound to that key.
 */
class RosaPaySignerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private companion object {
    const val KEY_ALIAS = "com.rosapay.device-signer"
    const val KEYSTORE = "AndroidKeyStore"
    /**
     * The contract verifies a signature over the authorization payload itself,
     * so the key must sign those exact bytes. SHA256withECDSA would hash them a
     * second time and produce a signature nothing can verify.
     */
    const val SIGNATURE_ALGORITHM = "NONEwithECDSA"
  }

  override fun getName(): String = "RosaPaySigner"

  private fun keystore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private fun timestamp(): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(Date())
  }

  private fun identityOf(publicKeyEncoded: ByteArray): WritableMap = Arguments.createMap().apply {
    putString("signerId", KEY_ALIAS)
    putString("publicKey", Base64.encodeToString(publicKeyEncoded, Base64.NO_WRAP))
    putString("kind", "device-key")
  }

  @ReactMethod
  fun getIdentity(promise: Promise) {
    try {
      val entry = keystore().getCertificate(KEY_ALIAS)
      if (entry == null) {
        promise.resolve(null)
        return
      }
      promise.resolve(identityOf(entry.publicKey.encoded))
    } catch (error: Throwable) {
      promise.reject("UNAVAILABLE", error.message ?: "The keystore could not be read", error)
    }
  }

  @ReactMethod
  fun createIdentity(displayName: String, promise: Promise) {
    try {
      val available = BiometricManager.from(reactContext)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
      if (available != BiometricManager.BIOMETRIC_SUCCESS) {
        promise.reject("UNAVAILABLE", "This device has no usable screen lock, so a payment key cannot be protected")
        return
      }

      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
      val builder = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // Authenticate for each signature rather than for a time window.
        builder.setUserAuthenticationParameters(
          0,
          KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
        )
      }
      generator.initialize(builder.build())
      val keyPair = generator.generateKeyPair()
      promise.resolve(identityOf(keyPair.public.encoded))
    } catch (error: Throwable) {
      promise.reject("UNAVAILABLE", error.message ?: "The payment key could not be created", error)
    }
  }

  @ReactMethod
  fun deleteIdentity(promise: Promise) {
    try {
      val store = keystore()
      if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("UNAVAILABLE", error.message ?: "The payment key could not be deleted", error)
    }
  }

  /**
   * Signs the exact digest the caller passes. Everything about the payment is
   * decided before this point; the module only proves user presence and signs.
   */
  @ReactMethod
  fun signDigest(request: ReadableMap, promise: Promise) {
    val digestBase64 = request.getString("digest")
    val reason = request.getString("reason") ?: "Authorize payment"
    if (digestBase64.isNullOrBlank()) {
      promise.reject("INVALID_REQUEST", "A digest is required")
      return
    }

    val digest = try {
      Base64.decode(digestBase64, Base64.DEFAULT)
    } catch (error: Throwable) {
      promise.reject("INVALID_REQUEST", "The digest is not valid base64", error)
      return
    }
    if (digest.size != 32) {
      promise.reject("INVALID_REQUEST", "A 32-byte digest is required")
      return
    }

    val activity = reactContext.currentActivity as? FragmentActivity
    if (activity == null) {
      promise.reject("PROCESS_INTERRUPTED", "The app is not in the foreground")
      return
    }

    val signature = try {
      val privateKey = keystore().getKey(KEY_ALIAS, null)
        ?: return promise.reject("UNAVAILABLE", "No payment key exists on this device")
      Signature.getInstance(SIGNATURE_ALGORITHM).apply { initSign(privateKey as java.security.PrivateKey) }
    } catch (error: KeyPermanentlyInvalidatedException) {
      promise.reject("KEY_INVALIDATED", "The payment key was invalidated by a screen-lock change", error)
      return
    } catch (error: Throwable) {
      promise.reject("UNAVAILABLE", error.message ?: "The payment key could not be used", error)
      return
    }

    val executor = Executor { command -> activity.runOnUiThread(command) }
    activity.runOnUiThread {
      val prompt = BiometricPrompt(
        activity,
        executor,
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            try {
              val signer = result.cryptoObject?.signature
                ?: return promise.reject("BIOMETRIC_FAILED", "The signature was not bound to the authentication")
              signer.update(digest)
              val der = signer.sign()
              promise.resolve(
                Arguments.createMap().apply {
                  putString("signerId", KEY_ALIAS)
                  putString("signature", Base64.encodeToString(der, Base64.NO_WRAP))
                  putString("signedAt", timestamp())
                },
              )
            } catch (error: Throwable) {
              promise.reject("BIOMETRIC_FAILED", error.message ?: "The payment could not be signed", error)
            }
          }

          override fun onAuthenticationError(code: Int, message: CharSequence) {
            val mapped = when (code) {
              BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_CANCELED ->
                "USER_CANCELLED"
              BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "LOCKED_OUT"
              else -> "BIOMETRIC_FAILED"
            }
            promise.reject(mapped, message.toString())
          }

          override fun onAuthenticationFailed() {
            // A single mismatch is not fatal; the prompt stays open for a retry.
          }
        },
      )

      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Rosa Pay")
        .setSubtitle(reason)
        .setAllowedAuthenticators(
          BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
        )
        .build()
      prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
    }
  }

  @ReactMethod
  fun authorizePayment(request: ReadableMap, promise: Promise) {
    val intentHash = request.getString("intentHash")
    if (intentHash.isNullOrBlank()) {
      promise.reject("INVALID_REQUEST", "An intent hash is required")
      return
    }
    val digest = Arguments.createMap().apply {
      putString("digest", Base64.encodeToString(hexToBytes(intentHash), Base64.NO_WRAP))
      putString("reason", "Approve this payment")
    }
    signDigest(digest, promise)
  }

  @ReactMethod
  fun signTransaction(@Suppress("UNUSED_PARAMETER") request: ReadableMap, promise: Promise) {
    // The relayer is the transaction source, so the device never signs envelopes.
    promise.reject("UNAVAILABLE", "This device signs authorization entries, not transactions")
  }

  @ReactMethod
  fun signAuthEntry(@Suppress("UNUSED_PARAMETER") request: ReadableMap, promise: Promise) {
    promise.reject("UNAVAILABLE", "Authorization entries are assembled in JavaScript and signed through signDigest")
  }

  private fun hexToBytes(value: String): ByteArray {
    val normalized = if (value.length % 2 == 0) value else "0$value"
    return ByteArray(normalized.length / 2) { index ->
      normalized.substring(index * 2, index * 2 + 2).toInt(16).toByte()
    }
  }
}
