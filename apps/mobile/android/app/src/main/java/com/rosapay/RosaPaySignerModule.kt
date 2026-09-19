package com.rosapay

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class RosaPaySignerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "RosaPaySigner"

  private fun unavailable(promise: Promise) {
    promise.reject("UNAVAILABLE", "Native passkey signer is not installed")
  }

  @ReactMethod
  fun getIdentity(promise: Promise) = unavailable(promise)

  @ReactMethod
  fun createIdentity(@Suppress("UNUSED_PARAMETER") displayName: String, promise: Promise) = unavailable(promise)

  @ReactMethod
  fun authorizePayment(@Suppress("UNUSED_PARAMETER") request: ReadableMap, promise: Promise) = unavailable(promise)

  @ReactMethod
  fun signTransaction(@Suppress("UNUSED_PARAMETER") request: ReadableMap, promise: Promise) = unavailable(promise)

  @ReactMethod
  fun signAuthEntry(@Suppress("UNUSED_PARAMETER") request: ReadableMap, promise: Promise) = unavailable(promise)
}
