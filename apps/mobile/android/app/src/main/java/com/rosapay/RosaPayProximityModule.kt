package com.rosapay

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The Bluetooth LE transport for RTP/1, the twin of [RosaPayNfcModule].
 *
 * NFC is the better experience where both phones are Android, and it stays the
 * default there. This exists because iOS gives no third-party app card
 * emulation, so an iPhone merchant cannot be tapped — and a transport that only
 * works between Androids is not a transport a customer can rely on. Bluetooth
 * is symmetric on every platform, so this module is both roles: a merchant
 * advertises the request it is already showing as a QR, and a customer finds
 * the merchant they are standing at.
 *
 * Nothing secret crosses the air. The payload is the public, merchant-signed
 * request; the customer's phone verifies that signature and the expiry, and a
 * device prompt still has to be answered before anything is spent.
 */
class RosaPayProximityModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private companion object {
    /** Carries the NFC AID in its first two groups, then "ROSAPA". */
    val SERVICE_UUID: UUID = UUID.fromString("F0526F73-6150-4179-9C01-524F53415041")
    val REQUEST_UUID: UUID = UUID.fromString("F0526F73-6150-4179-9C02-524F53415041")
    /** The standard Client Characteristic Configuration descriptor. */
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")

    const val READ_EVENT = "RosaPayProximityRequestRead"
    const val ERROR_EVENT = "RosaPayProximityError"

    /** RTP/1 bounds its QR URI at 4,096 characters; nothing larger is a request. */
    const val MAX_PAYLOAD_BYTES = 4_096
    /** One byte of sequence and one of total, so the frame count fits in a byte. */
    const val MAX_FRAMES = 255

    /**
     * How close a phone has to read before it is worth following at all, in
     * dBm. This is the outer edge of the conversation rather than the gate a
     * request passes: a merchant read this strongly is only added to the list
     * of phones whose readings are collected, and what offers a request is
     * [CLOSE_RSSI] or [APPROACH_DELTA], judged on those readings.
     *
     * Deliberately loose. Following a phone too readily costs a few samples;
     * following it too late means the approach that would have offered the
     * request went unwatched, because the resting level it is measured against
     * was never seen.
     */
    const val NEARBY_RSSI = -75

    /**
     * How strong a reading is close enough to offer a request on its own.
     *
     * The gesture this exists for is two phones brought together, and it is
     * meant to mean a few centimetres — the reach of a tap, not of a room. A
     * radio cannot promise that. BLE reports one number that falls off with
     * distance but also with a hand, a body, a pocket, and the two metal
     * chassis a pair of phones held face to face put between their own
     * antennas. Ten centimetres and half a metre overlap across handsets, so
     * no absolute number separates them cleanly, and a number tight enough to
     * be certain is the worst failure available here: nothing on screen, no
     * error, nothing to act on.
     *
     * So this sits where a phone is plausibly at the counter rather than
     * across it, and [APPROACH_DELTA] carries the rest.
     */
    const val CLOSE_RSSI = -65

    /**
     * How much stronger than its own resting level a phone must read before
     * that counts as having been brought over, in dB.
     *
     * The half of the gate that needs no calibration. Halving the distance
     * adds about 6 dB and quartering it about 12, so a rise of this size means
     * the phone moved much closer, wherever its absolute readings sit. A
     * merchant left on a table across the room holds a steady level and never
     * produces one; a phone lifted to the counter does.
     */
    const val APPROACH_DELTA = 12

    /**
     * How long a merchant may be heard steadily before it is offered anyway,
     * in milliseconds.
     *
     * The point of this transport is to match the customer standing at a
     * counter with the request that counter has open. Distance is how that
     * match is guessed at, not the thing being asked for, so a gate on
     * distance must never be the reason the match never happens.
     * [CLOSE_RSSI] and [APPROACH_DELTA] still decide how *fast* the request
     * appears; this only decides that it appears.
     */
    const val PATIENCE_MS = 6_000L

    /**
     * How much weaker than the strongest phone on the air a merchant may read
     * and still be the one offered, in dB. Two tills side by side are the case
     * this exists for: the customer is standing at exactly one of them.
     */
    const val CONTENDER_MARGIN = 6

    /**
     * How close "being held against it" is — the reading that stands in for a
     * tap, and the only one that lets the device prompt start by itself. It
     * still decides which request is offered and how quickly, never whether it
     * may be paid: the signing key is minted so the hardware refuses to sign
     * without the owner answering a biometric or passcode prompt.
     *
     * Same correction as [NEARBY_RSSI]: pressed-together phones shield each
     * other, so the free-air -45 was rarely reached by the one gesture this
     * exists for. Missing a real tap costs a press on Approve; reaching it
     * early costs a prompt the customer can dismiss.
     */
    const val TOUCHING_RSSI = -55

    /**
     * How many readings in a row have to agree before acting on them. A single
     * sample is noise — a hand moving, a body between the phones. Scanning
     * reports duplicates several times a second, so three in agreement is a
     * fraction of a second of steady contact rather than a spike.
     */
    const val REQUIRED_SAMPLES = 3

    const val PERMISSION_REQUEST = 7311
  }

  override fun getName(): String = "RosaPayProximity"

  private val manager: BluetoothManager?
    get() = ContextCompat.getSystemService(reactContext, BluetoothManager::class.java)

  private val adapter: BluetoothAdapter?
    get() = manager?.adapter

  // Merchant role.
  private var gattServer: BluetoothGattServer? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var payload: ByteArray? = null
  private val subscriberMtu = ConcurrentHashMap<String, Int>()

  /** How far one customer's copy of the request has got, and how it is cut. */
  private data class Transfer(var next: Int, val capacity: Int, val total: Int)

  /** One entry per customer being sent to, so the next frame waits its turn. */
  private val sending = ConcurrentHashMap<String, Transfer>()

  // Customer role.
  private var scanCallback: ScanCallback? = null
  private val reading = ConcurrentHashMap<String, BluetoothGatt>()
  private val frames = ConcurrentHashMap<String, MutableMap<Int, ByteArray>>()
  /** The last few signal readings per merchant, and what they said on connect. */
  private val samples = ConcurrentHashMap<String, MutableList<Int>>()
  /** The weakest reading each merchant has given, which an approach is measured against. */
  private val resting = ConcurrentHashMap<String, Int>()
  /** When each merchant was first heard in range, which patience is measured from. */
  private val firstSeen = ConcurrentHashMap<String, Long>()
  /** The strongest reading from any merchant just now, so the nearer till wins. */
  @Volatile private var best: Pair<Int, Long>? = null
  private val touching = ConcurrentHashMap<String, Boolean>()

  /** React Native requires these for `NativeEventEmitter`. */
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Double) = Unit

  // MARK: Status and permissions

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(statusMap())
  }

  private fun statusMap() = Arguments.createMap().apply {
    val adapter = adapter
    val supported = adapter != null &&
      reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
    putBoolean("supported", supported)
    putBoolean("enabled", supported && adapter?.isEnabled == true)
    putBoolean("authorized", permissionsGranted())
    // A phone that cannot advertise can still pay; it just cannot be the till.
    putBoolean("canBroadcast", supported && adapter?.bluetoothLeAdvertiser != null)
  }

  /**
   * Android 12 split Bluetooth into purpose-scoped runtime permissions. Below
   * that, scanning was gated on location instead, which is why the old pair is
   * still asked for on older phones.
   */
  private fun requiredPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_ADVERTISE,
        Manifest.permission.BLUETOOTH_CONNECT,
      )
    } else {
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

  private fun permissionsGranted(): Boolean = requiredPermissions().all {
    ContextCompat.checkSelfPermission(reactContext, it) == PackageManager.PERMISSION_GRANTED
  }

  /**
   * Whether this phone is old enough to tie BLE scanning to location.
   *
   * Before Android 12 a scan could be used to infer where someone is, so the
   * platform put it behind location — both the permission, which
   * [requiredPermissions] asks for, and the switch, which no app can ask for
   * and which silently empties the results when it is off. From Android 12 the
   * `neverForLocation` flag on BLUETOOTH_SCAN takes its place.
   */
  private fun locationServicesRequired(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.S

  private fun locationServicesEnabled(): Boolean {
    val locations = ContextCompat.getSystemService(reactContext, LocationManager::class.java)
    return locations != null && LocationManagerCompat.isLocationEnabled(locations)
  }

  @ReactMethod
  fun requestPermissions(promise: Promise) {
    if (permissionsGranted()) {
      promise.resolve(statusMap())
      return
    }
    val activity = reactContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      // Nothing to prompt from; report what is true rather than hanging.
      promise.resolve(statusMap())
      return
    }
    activity.requestPermissions(requiredPermissions(), PERMISSION_REQUEST, PermissionListener { requestCode, _, _ ->
      if (requestCode != PERMISSION_REQUEST) {
        false
      } else {
        // Answer from the system rather than from `grantResults`: what matters
        // is what is granted now, which is also true if the prompt was skipped.
        promise.resolve(statusMap())
        true
      }
    })
  }

  // MARK: Merchant — advertise the request

  @ReactMethod
  fun startBroadcast(payloadInput: String, promise: Promise) {
    val encoded = payloadInput.toByteArray(StandardCharsets.UTF_8)
    if (encoded.isEmpty()) {
      promise.reject("BLE_PAYLOAD_EMPTY", "This payment request is empty")
      return
    }
    if (encoded.size > MAX_PAYLOAD_BYTES) {
      promise.reject("BLE_PAYLOAD_TOO_LARGE", "This payment request is too large to share over Bluetooth")
      return
    }
    val adapter = adapter
    if (adapter == null || !reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      promise.reject("BLE_UNSUPPORTED", "This device cannot share a request over Bluetooth")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject("BLE_DISABLED", "Turn on Bluetooth to share this request")
      return
    }
    if (!permissionsGranted()) {
      promise.reject("BLE_UNAUTHORIZED", "Rosa Pay needs Bluetooth permission to share this request")
      return
    }
    val advertiser = adapter.bluetoothLeAdvertiser
    if (advertiser == null) {
      promise.reject("BLE_UNSUPPORTED", "This phone cannot advertise over Bluetooth")
      return
    }

    payload = encoded
    try {
      stopBroadcasting()
      val server = manager?.openGattServer(reactContext, serverCallback)
      if (server == null) {
        promise.reject("BLE_UNAVAILABLE", "Bluetooth could not be started on this device")
        return
      }
      gattServer = server

      // Notify rather than read: a request is well past the 512-byte ceiling on
      // a readable attribute, so it is pushed in MTU-sized frames once a
      // customer subscribes.
      val characteristic = BluetoothGattCharacteristic(
        REQUEST_UUID,
        BluetoothGattCharacteristic.PROPERTY_NOTIFY,
        BluetoothGattCharacteristic.PERMISSION_READ,
      )
      characteristic.addDescriptor(
        BluetoothGattDescriptor(
          CCCD_UUID,
          BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        ),
      )
      val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      service.addCharacteristic(characteristic)
      server.addService(service)

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .setConnectable(true)
        .build()
      // The service UUID alone: 16 bytes of a 31-byte advertisement, and the
      // request itself is far too large to advertise, so it travels over GATT.
      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .addServiceUuid(ParcelUuid(SERVICE_UUID))
        .build()
      val callback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
          emit(ERROR_EVENT, "Bluetooth refused to share this request")
        }
      }
      advertiseCallback = callback
      advertiser.startAdvertising(settings, data, callback)
      promise.resolve(null)
    } catch (error: SecurityException) {
      stopBroadcasting()
      promise.reject("BLE_UNAUTHORIZED", "Rosa Pay needs Bluetooth permission to share this request")
    } catch (error: IllegalStateException) {
      stopBroadcasting()
      promise.reject("BLE_UNAVAILABLE", error.message ?: "Bluetooth could not share this request")
    }
  }

  @ReactMethod
  fun stopBroadcast(promise: Promise) {
    stopBroadcasting()
    promise.resolve(null)
  }

  private fun stopBroadcasting() {
    payload = null
    subscriberMtu.clear()
    sending.clear()
    advertiseCallback?.let { callback ->
      runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(callback) }
    }
    advertiseCallback = null
    runCatching { gattServer?.close() }
    gattServer = null
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onMtuChanged(device: BluetoothDevice?, mtu: Int) {
      device?.address?.let { subscriberMtu[it] = mtu }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice?,
      requestId: Int,
      descriptor: BluetoothGattDescriptor?,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      if (responseNeeded) {
        runCatching {
          gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }
      }
      if (descriptor?.uuid != CCCD_UUID || device == null) return
      val subscribing = value != null &&
        value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
      if (subscribing) beginSend(device)
    }

    override fun onNotificationSent(device: BluetoothDevice?, status: Int) {
      val address = device?.address ?: return
      val progress = sending[address] ?: return
      if (status != BluetoothGatt.GATT_SUCCESS) {
        sending.remove(address)
        return
      }
      progress.next += 1
      send(device)
    }

    override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        device?.address?.let {
          subscriberMtu.remove(it)
          sending.remove(it)
        }
      }
    }
  }

  /** Pushes the request in frames the subscriber's MTU can carry. */
  /**
   * Starts sending the request to a customer who has just subscribed.
   *
   * The frame size is fixed here and kept for the whole transfer: the MTU can
   * change while frames are in flight, and recomputing it mid-send would cut
   * the payload at different offsets than the frames already delivered.
   */
  private fun beginSend(device: BluetoothDevice) {
    val body = payload ?: return
    // Three bytes of ATT overhead, then two of our own framing. Until the
    // customer negotiates a larger MTU this is the 23-byte default, which is
    // why the frame count is allowed to run to 255.
    val mtu = subscriberMtu[device.address] ?: 23
    val capacity = (mtu - 3 - 2).coerceAtLeast(1)
    val total = (body.size + capacity - 1) / capacity
    if (total <= 0 || total > MAX_FRAMES) return
    sending[device.address] = Transfer(0, capacity, total)
    send(device)
  }

  /**
   * Sends the next frame, and only the next one.
   *
   * Android carries one notification at a time: a second
   * `notifyCharacteristicChanged` before `onNotificationSent` has reported the
   * first is dropped, silently and without failing. The whole request used to
   * go out in one tight loop, so at the 23-byte default MTU nearly forty
   * frames were fired and the customer received the first and almost nothing
   * else — a merchant saying it had sent the request to a phone that could
   * never assemble one. Each frame now waits for the stack to confirm the one
   * before it.
   */
  private fun send(device: BluetoothDevice) {
    val server = gattServer ?: return
    val body = payload ?: return
    val progress = sending[device.address] ?: return
    val characteristic = server
      .getService(SERVICE_UUID)
      ?.getCharacteristic(REQUEST_UUID)
      ?: return

    if (progress.next >= progress.total) {
      sending.remove(device.address)
      return
    }

    val start = progress.next * progress.capacity
    val end = minOf(start + progress.capacity, body.size)
    val frame = ByteArray(2 + (end - start))
    frame[0] = progress.next.toByte()
    frame[1] = progress.total.toByte()
    body.copyInto(frame, 2, start, end)
    try {
      @Suppress("DEPRECATION")
      characteristic.value = frame
      @Suppress("DEPRECATION")
      val queued = server.notifyCharacteristicChanged(device, characteristic, false)
      // A refused frame brings no callback, so nothing would resume this send.
      // The customer abandons a read that stops and discovery starts over.
      if (!queued) sending.remove(device.address)
    } catch (error: SecurityException) {
      sending.remove(device.address)
      emit(ERROR_EVENT, "Rosa Pay lost Bluetooth permission while sharing this request")
    }
  }

  // MARK: Customer — find the merchant this phone is being held against

  @ReactMethod
  fun startScanning(promise: Promise) {
    val adapter = adapter
    if (adapter == null || !reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      promise.reject("BLE_UNSUPPORTED", "This device has no Bluetooth LE")
      return
    }
    if (!adapter.isEnabled) {
      promise.reject("BLE_DISABLED", "Turn on Bluetooth to pay by holding the phones together")
      return
    }
    if (!permissionsGranted()) {
      promise.reject("BLE_UNAUTHORIZED", "Rosa Pay needs Bluetooth permission to find a nearby merchant")
      return
    }
    // Android 11 and earlier gate BLE scanning on location being switched on,
    // not merely granted — and a scan started with it off returns nothing at
    // all, with no failure and no results. That is indistinguishable from a
    // merchant who is not advertising, so it has to be said out loud here
    // rather than discovered by holding two phones together for a minute.
    if (locationServicesRequired() && !locationServicesEnabled()) {
      promise.reject(
        "BLE_LOCATION_OFF",
        "Turn on Location as well as Bluetooth: this version of Android will not look for a nearby merchant without it",
      )
      return
    }
    val scanner = adapter.bluetoothLeScanner
    if (scanner == null) {
      promise.reject("BLE_UNAVAILABLE", "The Bluetooth scanner could not be started")
      return
    }
    if (scanCallback != null) {
      promise.resolve(null)
      return
    }

    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult?) {
        val device = result?.device ?: return
        observe(device, result.rssi)
      }

      override fun onScanFailed(errorCode: Int) {
        emit(ERROR_EVENT, "Bluetooth could not look for a nearby merchant")
      }
    }

    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    try {
      scanner.startScan(listOf(filter), settings, callback)
      scanCallback = callback
      promise.resolve(null)
    } catch (error: SecurityException) {
      promise.reject("BLE_UNAUTHORIZED", "Rosa Pay needs Bluetooth permission to find a nearby merchant")
    }
  }

  @ReactMethod
  fun stopScanning(promise: Promise) {
    stopScanningNow()
    promise.resolve(null)
  }

  private fun stopScanningNow() {
    scanCallback?.let { callback ->
      runCatching { adapter?.bluetoothLeScanner?.stopScan(callback) }
    }
    scanCallback = null
    reading.values.forEach { gatt -> runCatching { gatt.close() } }
    reading.clear()
    frames.clear()
    samples.clear()
    resting.clear()
    firstSeen.clear()
    best = null
    touching.clear()
  }

  /**
   * Turns a stream of signal readings into the one thing a tap gives for free:
   * a claim that these two phones are deliberately together.
   */
  private fun observe(device: BluetoothDevice, rssi: Int) {
    val address = device.address ?: return
    if (reading.containsKey(address)) return

    // Recorded from every reading, including the ones too weak to follow: the
    // weakest this phone has given is what "it was brought closer" is measured
    // against, and the weakest readings are the ones that establish it.
    val floor = minOf(resting[address] ?: rssi, rssi)
    resting[address] = floor

    // Out of range resets the run, patience included: a merchant has to be
    // approached, not merely glimpsed once across a room.
    if (rssi < NEARBY_RSSI) {
      samples.remove(address)
      firstSeen.remove(address)
      return
    }

    val now = System.currentTimeMillis()
    val peak = best
    if (peak == null || now - peak.second > 1_000L || rssi >= peak.first) {
      best = rssi to now
    }
    val waiting = firstSeen.getOrPut(address) { now }

    val window = samples.getOrPut(address) { mutableListOf() }
    synchronized(window) {
      window.add(rssi)
      while (window.size > REQUIRED_SAMPLES) window.removeAt(0)
      if (window.size < REQUIRED_SAMPLES) return
      // Two ways to be close, and either one offers the request straight away:
      // reading close outright, or reading far closer than it has all
      // encounter, which is what being held against this phone looks like to a
      // radio nobody calibrated for these two handsets.
      val close = window.all { it >= CLOSE_RSSI }
      val approached = window.all { it - floor >= APPROACH_DELTA }
      // And a third way, which is the whole point: a counter heard steadily
      // for a few seconds is the counter this customer is standing at.
      val patient = now - waiting >= PATIENCE_MS
      if (!close && !approached && !patient) return
      // Whichever till is nearer is the one the customer is at.
      val closest = best
      if (closest != null && now - closest.second <= 1_000L && rssi < closest.first - CONTENDER_MARGIN) return
      // Every reading agreeing is what makes this deliberate rather than a
      // spike, and all of them at touching strength is what lets it stand in
      // for a tap.
      touching[address] = window.all { it >= TOUCHING_RSSI }
    }
    connect(device)
  }

  private fun connect(device: BluetoothDevice) {
    // One read per merchant at a time; a scan reports the same phone many times
    // a second while the two are held together.
    if (reading.containsKey(device.address)) return
    try {
      val gatt = device.connectGatt(reactContext, false, clientCallback, BluetoothDevice.TRANSPORT_LE)
      if (gatt == null) return
      reading[device.address] = gatt
      frames[device.address] = mutableMapOf()
    } catch (error: SecurityException) {
      emit(ERROR_EVENT, "Rosa Pay needs Bluetooth permission to read a nearby merchant")
    }
  }

  private fun release(gatt: BluetoothGatt) {
    val address = gatt.device?.address
    if (address != null) {
      reading.remove(address)
      frames.remove(address)
      samples.remove(address)
      resting.remove(address)
      firstSeen.remove(address)
      touching.remove(address)
    }
    runCatching { gatt.close() }
  }

  private val clientCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        // The default 23-byte MTU would need 205 frames for a full-size
        // request. Ask for room first, and discover services once told.
        BluetoothProfile.STATE_CONNECTED -> runCatching { gatt.requestMtu(512) }
        BluetoothProfile.STATE_DISCONNECTED -> release(gatt)
        else -> Unit
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      // A refused MTU is survivable — it only means more, smaller frames.
      runCatching { gatt.discoverServices() }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val characteristic = gatt.getService(SERVICE_UUID)?.getCharacteristic(REQUEST_UUID)
      if (status != BluetoothGatt.GATT_SUCCESS || characteristic == null) {
        release(gatt)
        return
      }
      try {
        gatt.setCharacteristicNotification(characteristic, true)
        val descriptor = characteristic.getDescriptor(CCCD_UUID)
        if (descriptor == null) {
          release(gatt)
          return
        }
        @Suppress("DEPRECATION")
        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        @Suppress("DEPRECATION")
        gatt.writeDescriptor(descriptor)
      } catch (error: SecurityException) {
        release(gatt)
      }
    }

    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      onFrame(gatt, characteristic.value)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      onFrame(gatt, value)
    }
  }

  private fun onFrame(gatt: BluetoothGatt, frame: ByteArray?) {
    if (frame == null || frame.size <= 2) return
    val address = gatt.device?.address ?: return
    val index = frame[0].toInt() and 0xFF
    val total = frame[1].toInt() and 0xFF
    if (total == 0 || total > MAX_FRAMES || index >= total) {
      release(gatt)
      return
    }

    val collected = frames[address] ?: return
    collected[index] = frame.copyOfRange(2, frame.size)
    if (collected.size != total) return

    val body = ByteArray(collected.values.sumOf { it.size })
    var offset = 0
    for (position in 0 until total) {
      val part = collected[position] ?: return
      part.copyInto(body, offset)
      offset += part.size
    }
    val wasTouching = touching.remove(address) ?: false
    // Release before emitting: the screen this wakes may tear the scanner down,
    // and a half-read second merchant would otherwise stay connected.
    release(gatt)

    if (body.size > MAX_PAYLOAD_BYTES) {
      emit(ERROR_EVENT, "That phone did not share a readable payment request")
      return
    }
    val value = String(body, StandardCharsets.UTF_8)
    if (value.isEmpty()) {
      emit(ERROR_EVENT, "That phone did not share a payment request")
      return
    }
    emitRequest(value, wasTouching)
  }

  /** A reload must not leave this phone advertising a request nobody owns. */
  override fun invalidate() {
    stopBroadcasting()
    stopScanningNow()
    super.invalidate()
  }

  private fun emit(event: String, value: String) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, value)
  }

  /** A request, and whether the phones were touching when it was read. */
  private fun emitRequest(value: String, touching: Boolean) {
    val body = Arguments.createMap().apply {
      putString("payload", value)
      putBoolean("touching", touching)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(READ_EVENT, body)
  }
}
