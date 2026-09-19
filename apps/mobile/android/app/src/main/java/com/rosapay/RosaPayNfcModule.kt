package com.rosapay

import android.app.Activity
import android.content.ComponentName
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.cardemulation.CardEmulation
import android.nfc.tech.IsoDep
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.charset.StandardCharsets

/**
 * The NFC transport for RTP/1. A merchant broadcasts the signed request it is
 * already showing as a QR code, and a customer reads it by tapping.
 *
 * NFC never carries anything a QR code would not: the customer still verifies
 * the merchant signature and the expiry before the device prompts to authorize
 * anything. A hostile tap can prompt for review, but cannot spend without the
 * device owner's authentication.
 */
class RosaPayNfcModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private companion object {
    val AID = byteArrayOf(0xF0.toByte(), 0x52, 0x6F, 0x73, 0x61, 0x50, 0x61, 0x79, 0x01)
    const val READ_EVENT = "RosaPayNfcRequestRead"
    const val ERROR_EVENT = "RosaPayNfcError"
    /** Matches `RosaPayApduService.CHUNK_SIZE`; a payload larger than this is not a request. */
    const val MAX_CHUNKS = RosaPayApduService.MAX_CHUNKS
    const val MAX_PAYLOAD_BYTES = RosaPayApduService.CHUNK_SIZE * MAX_CHUNKS
  }

  private var reading = false

  override fun getName(): String = "RosaPayNfc"

  private fun adapter(): NfcAdapter? = NfcAdapter.getDefaultAdapter(reactContext)

  @ReactMethod
  fun getStatus(promise: Promise) {
    val adapter = adapter()
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("supported", adapter != null)
        putBoolean("enabled", adapter?.isEnabled == true)
        putBoolean("canBroadcast", hostCardEmulationAvailable())
        // Android's reader mode polls without any UI, so the scan screen can arm
        // it on open. iOS cannot — see RosaPayNfc.swift.
        putBoolean("needsUserAction", false)
      },
    )
  }

  /** Offers `payload` to any customer who taps, until `stopBroadcast` is called. */
  @ReactMethod
  fun startBroadcast(payload: String, promise: Promise) {
    if (!hostCardEmulationAvailable()) {
      promise.reject("NFC_UNSUPPORTED", "This device cannot share a request over NFC")
      return
    }
    if (adapter()?.isEnabled != true) {
      promise.reject("NFC_DISABLED", "Turn on NFC to share this request by tapping")
      return
    }
    if (payload.toByteArray(StandardCharsets.UTF_8).size > MAX_PAYLOAD_BYTES) {
      promise.reject("NFC_PAYLOAD_TOO_LARGE", "This payment request is too large to share over NFC")
      return
    }
    if (payload.isEmpty()) {
      promise.reject("NFC_PAYLOAD_EMPTY", "This payment request is empty")
      return
    }
    RosaPayApduService.broadcast(payload)
    // Ask to win the tap outright, which matters only where another wallet has
    // claimed this AID. Rosa Pay's AID is proprietary, so ordinary AID routing
    // already reaches RosaPayApduService and a phone that refuses the request
    // (an OEM that reports the activity as not resumed, a device with no
    // preferred-service support) still emulates the card correctly. Treating
    // that refusal as fatal would take tapping away from a phone it works on.
    preferForegroundService()
    promise.resolve(null)
  }

  @ReactMethod
  fun stopBroadcast(promise: Promise) {
    RosaPayApduService.clear()
    releaseForegroundService()
    promise.resolve(null)
  }

  /** Listens for a merchant's tap and emits the request it published. */
  @ReactMethod
  fun startReading(promise: Promise) {
    val adapter = adapter()
    if (adapter == null) {
      promise.reject("NFC_UNSUPPORTED", "This device has no NFC reader")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject("NFC_DISABLED", "Turn on NFC to pay by tapping")
      return
    }
    val activity: Activity? = reactContext.currentActivity
    if (activity == null) {
      promise.reject("NFC_NO_ACTIVITY", "The app is not in the foreground")
      return
    }

    if (reading) {
      promise.resolve(null)
      return
    }
    activity.runOnUiThread {
      try {
        if (reading) {
          promise.resolve(null)
          return@runOnUiThread
        }
        adapter.enableReaderMode(
          activity,
          { tag -> readRequest(tag) },
          NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
          null,
        )
        reading = true
        promise.resolve(null)
      } catch (error: RuntimeException) {
        reading = false
        promise.reject("NFC_UNAVAILABLE", error.message ?: "The NFC reader could not be started")
      }
    }
  }

  @ReactMethod
  fun stopReading(promise: Promise) {
    val activity: Activity? = reactContext.currentActivity
    reading = false
    if (activity == null) {
      promise.resolve(null)
      return
    }
    activity.runOnUiThread {
      runCatching { adapter()?.disableReaderMode(activity) }
      promise.resolve(null)
    }
  }

  /** React Native requires these for `NativeEventEmitter`; the work is in reader mode. */
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Double) = Unit

  private fun readRequest(tag: Tag) {
    val isoDep = IsoDep.get(tag)
    if (isoDep == null) {
      emit(ERROR_EVENT, "That device did not offer a payment request")
      return
    }

    try {
      isoDep.connect()
      isoDep.timeout = 5_000

      val selected = isoDep.transceive(selectApdu())
      if (!endsWithOk(selected) || selected.size < 3) {
        emit(ERROR_EVENT, "That device is not sharing a Rosa Pay request")
        return
      }

      val chunks = selected[0].toInt() and 0xFF
      if (chunks == 0 || chunks > MAX_CHUNKS) {
        emit(ERROR_EVENT, "That request is too large to be a payment request")
        return
      }

      val payload = ByteArrayOutputStream(chunks * RosaPayApduService.CHUNK_SIZE)
      for (index in 0 until chunks) {
        val response = isoDep.transceive(readApdu(index))
        if (!endsWithOk(response)) {
          emit(ERROR_EVENT, "The tap ended before the request was complete")
          return
        }
        val dataLength = response.size - 2
        if (dataLength <= 0 || dataLength > RosaPayApduService.CHUNK_SIZE) {
          emit(ERROR_EVENT, "The tap returned an invalid payment request chunk")
          return
        }
        payload.write(response, 0, dataLength)
      }
      val value = String(payload.toByteArray(), Charsets.UTF_8)
      if (value.isEmpty()) {
        emit(ERROR_EVENT, "That device did not share a payment request")
        return
      }
      emit(READ_EVENT, value)
    } catch (error: IOException) {
      // Phones move apart mid-read constantly; this is a retry, not a failure.
      emit(ERROR_EVENT, "Hold the phones together until the request is read")
    } catch (error: SecurityException) {
      emit(ERROR_EVENT, "The tap was interrupted")
    } finally {
      runCatching { isoDep?.close() }
    }
  }

  private fun selectApdu(): ByteArray =
    byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, AID.size.toByte()) + AID + byteArrayOf(0x00)

  private fun readApdu(index: Int): ByteArray =
    byteArrayOf(0x00, 0xB0.toByte(), index.toByte(), 0x00)

  private fun endsWithOk(response: ByteArray): Boolean =
    response.size >= 2 &&
      response[response.size - 2] == 0x90.toByte() &&
      response[response.size - 1] == 0x00.toByte()

  private fun hostCardEmulationAvailable(): Boolean =
    reactContext.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)

  private fun cardEmulation(): CardEmulation? =
    adapter()?.let { runCatching { CardEmulation.getInstance(it) }.getOrNull() }

  private fun serviceComponent(): ComponentName =
    ComponentName(reactContext, RosaPayApduService::class.java)

  private fun preferForegroundService(): Boolean {
    val activity: Activity = reactContext.currentActivity ?: return false
    return runCatching { cardEmulation()?.setPreferredService(activity, serviceComponent()) == true }.getOrDefault(false)
  }

  private fun releaseForegroundService() {
    val activity: Activity = reactContext.currentActivity ?: return
    runCatching { cardEmulation()?.unsetPreferredService(activity) }
  }

  private fun emit(event: String, value: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, value)
  }
}
