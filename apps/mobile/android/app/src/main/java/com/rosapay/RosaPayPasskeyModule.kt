package com.rosapay

import android.util.Base64
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Creates and uses a passkey, so a wallet is not lost with the phone that made it.
 *
 * The Keystore key in [RosaPaySignerModule] is bound to this handset by design:
 * it cannot be copied anywhere, which is what makes it safe and also what makes
 * an account die with the device. A passkey is the same P-256 cryptography with
 * one difference that matters here - Google Password Manager replicates the
 * credential to the owner's other devices, so the account survives.
 *
 * Credential Manager speaks WebAuthn JSON in both directions. This module builds
 * the request JSON and hands the response back untouched; the public key hiding
 * inside the CBOR attestation object is read in TypeScript, where it is tested
 * against a real attestation rather than parsed twice in two languages.
 */
class RosaPayPasskeyModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private companion object {
    /**
     * The domain the credential is scoped to. It must be served by that domain's
     * `/.well-known/assetlinks.json`, naming this package and its signing
     * certificate, or the system refuses before the user sees anything.
     */
    const val DEFAULT_RELYING_PARTY = "rosa-pay-app.vercel.app"
    const val ES256 = -7L
    const val PUBLIC_KEY_CREDENTIAL = "public-key"
  }

  private val scope = CoroutineScope(Dispatchers.Main)

  override fun getName(): String = "RosaPayPasskey"

  private fun manager(): CredentialManager = CredentialManager.create(reactContext)

  /** WebAuthn speaks base64url without padding, everywhere. */
  private fun encode(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  @ReactMethod
  fun isSupported(promise: Promise) {
    // Credential Manager backports to API 21, but a passkey needs a provider
    // that can actually store one. Asking the manager is the only honest test,
    // and it is done at the point of use; here it reports the library being
    // present at all.
    promise.resolve(true)
  }

  @ReactMethod
  fun createCredential(request: ReadableMap, promise: Promise) {
    val challenge = request.getString("challenge")
    val userId = request.getString("userId")
    if (challenge.isNullOrEmpty() || userId.isNullOrEmpty()) {
      promise.reject("INVALID_REQUEST", "A base64url challenge and user id are required")
      return
    }
    val relyingParty = request.getString("relyingParty") ?: DEFAULT_RELYING_PARTY
    val name = request.getString("name") ?: "Rosa Pay"

    val creationOptions = JSONObject().apply {
      put("challenge", challenge)
      put("rp", JSONObject().apply {
        put("id", relyingParty)
        put("name", "Rosa Pay")
      })
      put("user", JSONObject().apply {
        put("id", userId)
        put("name", name)
        put("displayName", name)
      })
      // ES256 only: the wallet contract verifies secp256r1 and nothing else, so
      // offering RS256 would produce a credential it could never check.
      put("pubKeyCredParams", JSONArray().put(JSONObject().apply {
        put("type", PUBLIC_KEY_CREDENTIAL)
        put("alg", ES256)
      }))
      put("authenticatorSelection", JSONObject().apply {
        put("authenticatorAttachment", "platform")
        // Discoverable, so a fresh install can find the credential without
        // already knowing its id - which is the whole point on a new phone.
        put("residentKey", "required")
        put("requireResidentKey", true)
        // The contract refuses an assertion whose user-verified bit is clear.
        put("userVerification", "required")
      })
      put("timeout", 120_000)
      put("attestation", "none")
    }

    scope.launch {
      try {
        val activity = reactContext.currentActivity
        if (activity == null) {
          promise.reject("UNAVAILABLE", "The app has no foreground activity to show the prompt in")
          return@launch
        }
        val response = manager().createCredential(
          activity,
          CreatePublicKeyCredentialRequest(creationOptions.toString()),
        )
        val registration = response as? CreatePublicKeyCredentialResponse
        if (registration == null) {
          promise.reject("UNAVAILABLE", "The system returned a credential this app does not use")
          return@launch
        }
        promise.resolve(readRegistration(JSONObject(registration.registrationResponseJson)))
      } catch (error: CreateCredentialCancellationException) {
        promise.reject("USER_CANCELLED", error.message ?: "The passkey was not created")
      } catch (error: CreateCredentialException) {
        promise.reject("PASSKEY_FAILED", error.message ?: "The passkey could not be created")
      } catch (error: Throwable) {
        promise.reject("PASSKEY_FAILED", error.message ?: "The passkey could not be created")
      }
    }
  }

  @ReactMethod
  fun assert(request: ReadableMap, promise: Promise) {
    val challenge = request.getString("challenge")
    if (challenge.isNullOrEmpty()) {
      promise.reject("INVALID_REQUEST", "A base64url challenge is required")
      return
    }
    val relyingParty = request.getString("relyingParty") ?: DEFAULT_RELYING_PARTY
    val credentialId = request.getString("credentialId")

    val requestOptions = JSONObject().apply {
      put("challenge", challenge)
      put("rpId", relyingParty)
      put("userVerification", "required")
      put("timeout", 120_000)
      // Scoping to the wallet's own credential stops the system offering an
      // unrelated passkey for this domain, which would sign something the
      // wallet would then refuse.
      if (!credentialId.isNullOrEmpty()) {
        put("allowCredentials", JSONArray().put(JSONObject().apply {
          put("type", PUBLIC_KEY_CREDENTIAL)
          put("id", credentialId)
        }))
      }
    }

    scope.launch {
      try {
        val activity = reactContext.currentActivity
        if (activity == null) {
          promise.reject("UNAVAILABLE", "The app has no foreground activity to show the prompt in")
          return@launch
        }
        val response = manager().getCredential(
          activity,
          GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestOptions.toString()))),
        )
        val credential = response.credential as? PublicKeyCredential
        if (credential == null) {
          promise.reject("UNAVAILABLE", "The system returned a credential this app does not use")
          return@launch
        }
        promise.resolve(readAssertion(JSONObject(credential.authenticationResponseJson)))
      } catch (error: GetCredentialCancellationException) {
        promise.reject("USER_CANCELLED", error.message ?: "The payment was not authorized")
      } catch (error: NoCredentialException) {
        promise.reject("NO_CREDENTIAL", error.message ?: "This device holds no passkey for this wallet")
      } catch (error: GetCredentialException) {
        promise.reject("PASSKEY_FAILED", error.message ?: "The passkey could not authorize this")
      } catch (error: Throwable) {
        promise.reject("PASSKEY_FAILED", error.message ?: "The passkey could not authorize this")
      }
    }
  }

  /**
   * Credential Manager returns the WebAuthn response as JSON with every byte
   * string already base64url-encoded, which is the form the rest of this app
   * wants. Reshaping rather than forwarding the whole document keeps the two
   * platforms returning the same thing.
   */
  private fun readRegistration(json: JSONObject) = Arguments.createMap().apply {
    val response = json.getJSONObject("response")
    putString("kind", "registration")
    putString("credentialId", json.getString("id"))
    putString("attestationObject", response.getString("attestationObject"))
    putString("clientDataJSON", response.getString("clientDataJSON"))
  }

  private fun readAssertion(json: JSONObject) = Arguments.createMap().apply {
    val response = json.getJSONObject("response")
    putString("kind", "assertion")
    putString("credentialId", json.getString("id"))
    putString("authenticatorData", response.getString("authenticatorData"))
    putString("clientDataJSON", response.getString("clientDataJSON"))
    putString("signature", response.getString("signature"))
    putString("userId", response.optString("userHandle", ""))
  }
}
