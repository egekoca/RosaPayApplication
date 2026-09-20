import CoreBluetooth
import Foundation
import React

/**
 The Bluetooth LE transport for RTP/1, and the only reason two iPhones can do
 what an Android pair does over NFC.

 Core NFC is reader-only for third-party apps, so an iPhone merchant publishes
 nothing an iPhone customer could tap. Core Bluetooth has no such asymmetry:
 this file is both halves. The merchant runs a GATT peripheral advertising the
 exact signed request its QR already shows; the customer runs a central that
 picks it up while the app is merely open.

 Nothing secret crosses the air. The payload is the public, merchant-signed
 request, and the customer's phone verifies that signature and the expiry, then
 asks for Face ID, exactly as it does for a scan. Radio proximity only decides
 which request to offer.
 */
@objc(RosaPayProximity)
class RosaPayProximity: RCTEventEmitter {

  /// Carries the NFC AID in its first two groups so the two transports are
  /// recognisably one protocol: F0 52 6F 73 61 50 61 79 01, then "ROSAPA".
  private static let serviceUUID = CBUUID(string: "F0526F73-6150-4179-9C01-524F53415041")
  private static let requestUUID = CBUUID(string: "F0526F73-6150-4179-9C02-524F53415041")

  private static let readEvent = "RosaPayProximityRequestRead"
  private static let errorEvent = "RosaPayProximityError"
  /// Narration of what the radio is doing, for the diagnostics screen only.
  /// Nothing in the payment path reads it.
  private static let diagnosticEvent = "RosaPayProximityDiagnostic"

  /// RTP/1 bounds its QR URI at 4,096 characters, so nothing larger is a
  /// payment request and a peer claiming otherwise is dropped rather than read.
  private static let maxPayloadBytes = 4_096
  /// One byte of sequence and one of total, so a frame count must fit in a byte.
  private static let maxFrames = 255

  /**
   How close "near enough to be offered" is, in dBm.

   NFC answers this with physics: a tap is a few centimetres or nothing. A radio
   has to be told. The free-air figures — touching around -40, a hand's width
   -55, a metre -70 — are what -55 was set from, and they do not survive the
   gesture people actually make: a phone laid flat against the merchant's
   screen puts two metal chassis between two edge-mounted antennas, and the
   reading lands well below what the same distance gives in open air.

   At -55 that shielding meant no request was offered at all, which is the
   worst failure available here — nothing on screen, no error, nothing to act
   on. Offering too readily costs far less, because it only decides which
   request appears: anything short of `touchingRssi` still opens the screen and
   waits for the customer to press Approve, and a request from the far side of
   a room is one they can simply decline.
   */
  private static let nearbyRssi = -75

  /**
   How close "being held against it" is — the reading that stands in for a tap.

   A request read at this strength starts the device prompt by itself, the way
   a tap does, so it has to mean the two phones are actually touching rather
   than merely in the same conversation. It is still only a question of which
   request is offered and how quickly: Face ID or the device passcode is what
   authorizes a payment, and the signing key is minted so the hardware will not
   sign without it.

   Same correction as `nearbyRssi`: pressed-together phones shield each other,
   so the free-air -45 was rarely reached by the one gesture this exists for,
   and holding the phones together did nothing while a working request sat
   waiting. Missing a real tap costs a press on Approve; reaching it early
   costs a prompt the customer can dismiss.
   */
  private static let touchingRssi = -55

  /**
   How many readings in a row have to agree before acting on them.

   A single sample is noise — a hand moving, a body between the phones, a
   reflection. Scanning reports duplicates several times a second, so three in
   agreement is a fraction of a second of steady contact rather than a spike.
   */
  private static let requiredSamples = 3

  private var peripheral: CBPeripheralManager?
  private var central: CBCentralManager?
  /// Callers waiting for the person to answer the system's Bluetooth prompt.
  private var permissionResolvers: [RCTPromiseResolveBlock] = []

  /// Held for the peripheral role: what to hand a customer who subscribes.
  private var advertised: Data?
  private var requestCharacteristic: CBMutableCharacteristic?
  private var advertisingWanted = false

  /// Held for the central role, one entry per peer being read.
  private var connected: [UUID: CBPeripheral] = [:]
  private var assembling: [UUID: [Int: Data]] = [:]
  private var expected: [UUID: Int] = [:]
  /// The last few signal readings per peer, and what they said at connect time.
  private var samples: [UUID: [Int]] = [:]
  private var touching: [UUID: Bool] = [:]
  private var scanningWanted = false

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String] {
    [Self.readEvent, Self.errorEvent, Self.diagnosticEvent]
  }

  override func invalidate() {
    DispatchQueue.main.async { [weak self] in
      self?.teardownPeripheral()
      self?.teardownCentral()
    }
    super.invalidate()
  }

  // MARK: - Status

  @objc(getStatus:rejecter:)
  func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    // Reading the authorization does not prompt; only allocating a manager and
    // using it does. Report from what the system already knows so a screen can
    // render its state without putting a permission sheet on someone.
    // Only an actual grant counts. Reporting "not asked yet" as authorized
    // reads as ready to a screen, so nothing would ever put the prompt up —
    // and the prompt is what allocates the managers that make the radio
    // knowable, so the app would sit waiting on a state it had no way to reach.
    let authorized = CBManager.authorization == .allowedAlways
    let poweredOn = peripheral?.state == .poweredOn || central?.state == .poweredOn
    resolve([
      "supported": true,
      // A granted app whose managers have not been allocated this launch has no
      // radio state to report yet. Saying it is on is right often enough to let
      // a screen arm itself, and `startScanning` refuses with BLE_DISABLED —
      // which a customer can act on — if the radio turns out to be off.
      "enabled": poweredOn || (authorized && peripheral == nil && central == nil),
      "authorized": authorized,
      "canBroadcast": true,
    ])
  }

  @objc(requestPermissions:rejecter:)
  func requestPermissions(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      // Nothing to wait for if the question has already been answered once.
      if CBManager.authorization != .notDetermined, self.central != nil || self.peripheral != nil {
        self.getStatus(resolve, rejecter: { _, _, _ in })
        return
      }

      // Answer when the system does, not on a timer. Allocating the managers is
      // what raises the prompt, and a person takes as long as they take to read
      // it — replying before they have touched it reports a refusal they never
      // made, and the screen then tells them to go to Settings and undo it.
      self.permissionResolvers.append(resolve)
      self.ensurePeripheral()
      self.ensureCentral()
      // A prompt nobody ever dismisses must not leave the JS side waiting for
      // an answer forever; the status it gets then is simply the true one.
      DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
        self.settlePermissionRequests(force: true)
      }
    }
  }

  /// Answers everyone waiting on the prompt, once the system has an answer.
  private func settlePermissionRequests(force: Bool = false) {
    guard !permissionResolvers.isEmpty else { return }
    guard force || CBManager.authorization != .notDetermined else { return }
    let waiting = permissionResolvers
    permissionResolvers = []
    for resolve in waiting {
      getStatus(resolve, rejecter: { _, _, _ in })
    }
  }

  // MARK: - Merchant: advertise the request

  @objc(startBroadcast:resolver:rejecter:)
  func startBroadcast(
    _ payload: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = payload.data(using: .utf8), !data.isEmpty else {
      reject("BLE_PAYLOAD_EMPTY", "This payment request is empty", nil)
      return
    }
    guard data.count <= Self.maxPayloadBytes else {
      reject("BLE_PAYLOAD_TOO_LARGE", "This payment request is too large to share over Bluetooth", nil)
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.advertised = data
      self.advertisingWanted = true
      self.ensurePeripheral()
      guard let manager = self.peripheral else {
        reject("BLE_UNAVAILABLE", "Bluetooth could not be started on this device", nil)
        return
      }
      switch manager.state {
      case .poweredOn:
        self.publishService(on: manager)
        resolve(nil)
      case .poweredOff:
        reject("BLE_DISABLED", "Turn on Bluetooth to share this request", nil)
      case .unauthorized:
        reject("BLE_UNAUTHORIZED", "Rosa Pay needs Bluetooth permission to share this request", nil)
      case .unsupported:
        reject("BLE_UNSUPPORTED", "This device cannot share a request over Bluetooth", nil)
      default:
        // Still resolving its state. `peripheralManagerDidUpdateState` publishes
        // as soon as it is on, so this is a wait rather than a failure.
        resolve(nil)
      }
    }
  }

  @objc(stopBroadcast:rejecter:)
  func stopBroadcast(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      self?.teardownPeripheral()
      resolve(nil)
    }
  }

  private func ensurePeripheral() {
    if peripheral == nil {
      peripheral = CBPeripheralManager(delegate: self, queue: nil)
    }
  }

  private func publishService(on manager: CBPeripheralManager) {
    guard advertisingWanted, advertised != nil else { return }
    manager.stopAdvertising()
    manager.removeAllServices()

    // Notify rather than read: a request is well past the 512-byte ceiling on a
    // readable attribute, so the peripheral pushes it in MTU-sized frames once
    // a customer subscribes.
    let characteristic = CBMutableCharacteristic(
      type: Self.requestUUID,
      properties: [.notify],
      value: nil,
      permissions: [.readable]
    )
    let service = CBMutableService(type: Self.serviceUUID, primary: true)
    service.characteristics = [characteristic]
    requestCharacteristic = characteristic
    manager.add(service)
    manager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
      CBAdvertisementDataLocalNameKey: "Rosa Pay",
    ])
    diagnose("Advertising this request to nearby phones")
  }

  private func teardownPeripheral() {
    advertisingWanted = false
    advertised = nil
    requestCharacteristic = nil
    peripheral?.stopAdvertising()
    peripheral?.removeAllServices()
  }

  /// Pushes the request in frames a subscriber's MTU can carry.
  private func send(to central: CBCentral) {
    guard
      let manager = peripheral,
      let characteristic = requestCharacteristic,
      let payload = advertised
    else { return }

    let capacity = max(central.maximumUpdateValueLength - 2, 1)
    let total = (payload.count + capacity - 1) / capacity
    guard total > 0, total <= Self.maxFrames else { return }

    for index in 0..<total {
      let start = index * capacity
      let end = min(start + capacity, payload.count)
      var frame = Data([UInt8(index), UInt8(total)])
      frame.append(payload.subdata(in: start..<end))
      // A false return means the queue is full; `IsReadyToUpdateSubscribers`
      // re-runs the whole send, which the receiver tolerates because frames
      // carry their own index.
      if !manager.updateValue(frame, for: characteristic, onSubscribedCentrals: [central]) {
        return
      }
    }
  }

  // MARK: - Customer: find a merchant being held against this phone

  @objc(startScanning:rejecter:)
  func startScanning(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.scanningWanted = true
      self.ensureCentral()
      guard let manager = self.central else {
        reject("BLE_UNAVAILABLE", "Bluetooth could not be started on this device", nil)
        return
      }
      switch manager.state {
      case .poweredOn:
        self.beginScan(on: manager)
        resolve(nil)
      case .poweredOff:
        reject("BLE_DISABLED", "Turn on Bluetooth to pay by holding the phones together", nil)
      case .unauthorized:
        reject("BLE_UNAUTHORIZED", "Rosa Pay needs Bluetooth permission to find a nearby merchant", nil)
      case .unsupported:
        reject("BLE_UNSUPPORTED", "This device has no Bluetooth LE", nil)
      default:
        resolve(nil)
      }
    }
  }

  @objc(stopScanning:rejecter:)
  func stopScanning(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      self?.teardownCentral()
      resolve(nil)
    }
  }

  private func ensureCentral() {
    if central == nil {
      central = CBCentralManager(delegate: self, queue: nil)
    }
  }

  private func beginScan(on manager: CBCentralManager) {
    guard scanningWanted else { return }
    // Duplicates on, because proximity is the signal: a merchant already seen
    // at arm's length has to be re-reported when the phones come together.
    manager.scanForPeripherals(
      withServices: [Self.serviceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    diagnose("Listening for a merchant nearby")
  }

  private func teardownCentral() {
    scanningWanted = false
    central?.stopScan()
    for peer in connected.values {
      central?.cancelPeripheralConnection(peer)
    }
    connected.removeAll()
    assembling.removeAll()
    expected.removeAll()
    samples.removeAll()
    touching.removeAll()
  }

  private func finish(_ peer: CBPeripheral) {
    connected.removeValue(forKey: peer.identifier)
    assembling.removeValue(forKey: peer.identifier)
    expected.removeValue(forKey: peer.identifier)
    samples.removeValue(forKey: peer.identifier)
    central?.cancelPeripheralConnection(peer)
  }

  private func emit(_ event: String, _ value: String) {
    if bridge != nil {
      sendEvent(withName: event, body: value)
    }
  }

  /**
   Narrates one step of the radio to the diagnostics screen.

   Two phones that do nothing when held together give a person nothing to act
   on: advertising may not have started, the other side may never be seen, or
   it may be seen steadily and simply read weaker than the thresholds ask for.
   Those have different fixes and look identical from the outside, so each one
   says which it is, and a discovery carries the reading it was judged on.
   */
  private func diagnose(_ message: String) {
    if bridge != nil {
      sendEvent(withName: Self.diagnosticEvent, body: message)
    }
  }

  /// A request, and whether the phones were touching when it was read.
  private func emitRequest(_ payload: String, touching: Bool) {
    if bridge != nil {
      sendEvent(withName: Self.readEvent, body: ["payload": payload, "touching": touching])
    }
  }
}

// MARK: - Peripheral delegate

extension RosaPayProximity: CBPeripheralManagerDelegate {

  func peripheralManagerDidUpdateState(_ manager: CBPeripheralManager) {
    settlePermissionRequests()
    if manager.state == .poweredOn {
      publishService(on: manager)
    }
  }

  func peripheralManager(
    _: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo _: CBCharacteristic
  ) {
    send(to: central)
  }

  func peripheralManagerIsReady(toUpdateSubscribers manager: CBPeripheralManager) {
    guard let characteristic = requestCharacteristic else { return }
    for central in characteristic.subscribedCentrals ?? [] {
      send(to: central)
    }
    _ = manager
  }
}

// MARK: - Central delegate

extension RosaPayProximity: CBCentralManagerDelegate {

  func centralManagerDidUpdateState(_ manager: CBCentralManager) {
    settlePermissionRequests()
    if manager.state == .poweredOn {
      beginScan(on: manager)
    }
  }

  func centralManager(
    _ manager: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData _: [String: Any],
    rssi RSSI: NSNumber
  ) {
    // 127 means the radio could not measure, which is not a reading at all.
    let strength = RSSI.intValue
    guard strength != 127 else {
      diagnose("Saw a Rosa Pay phone but could not measure its signal")
      return
    }
    let id = peripheral.identifier
    guard connected[id] == nil else { return }

    // Out of range resets the run: a merchant has to be approached, not merely
    // glimpsed once through a crowd.
    guard strength >= Self.nearbyRssi else {
      diagnose("Merchant seen at \(strength) dBm — too far, needs \(Self.nearbyRssi)")
      samples[id] = []
      return
    }

    var window = samples[id] ?? []
    window.append(strength)
    if window.count > Self.requiredSamples {
      window.removeFirst(window.count - Self.requiredSamples)
    }
    samples[id] = window
    guard window.count == Self.requiredSamples else {
      diagnose("Merchant at \(strength) dBm — reading \(window.count) of \(Self.requiredSamples)")
      return
    }

    // Every reading in the window agreeing is what makes this a deliberate act
    // rather than a spike, and all of them at touching strength is what lets it
    // stand in for a tap.
    let isTouching = window.allSatisfy { $0 >= Self.touchingRssi }
    diagnose(
      isTouching
        ? "Touching at \(strength) dBm — connecting"
        : "Near at \(strength) dBm but not touching, needs \(Self.touchingRssi) — connecting"
    )
    touching[id] = isTouching
    connected[id] = peripheral
    assembling[id] = [:]
    peripheral.delegate = self
    manager.connect(peripheral, options: nil)
  }

  func centralManager(_: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([Self.serviceUUID])
  }

  func centralManager(_: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error _: Error?) {
    finish(peripheral)
  }

  func centralManager(_: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error _: Error?) {
    connected.removeValue(forKey: peripheral.identifier)
    assembling.removeValue(forKey: peripheral.identifier)
    expected.removeValue(forKey: peripheral.identifier)
    samples.removeValue(forKey: peripheral.identifier)
  }
}

// MARK: - Reading one merchant's request

extension RosaPayProximity: CBPeripheralDelegate {

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
      finish(peripheral)
      return
    }
    peripheral.discoverCharacteristics([Self.requestUUID], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard
      error == nil,
      let characteristic = service.characteristics?.first(where: { $0.uuid == Self.requestUUID })
    else {
      finish(peripheral)
      return
    }
    peripheral.setNotifyValue(true, for: characteristic)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil, let frame = characteristic.value, frame.count > 2 else {
      if error != nil { finish(peripheral) }
      return
    }

    let index = Int(frame[frame.startIndex])
    let total = Int(frame[frame.startIndex + 1])
    guard total > 0, total <= Self.maxFrames, index < total else {
      finish(peripheral)
      return
    }

    let id = peripheral.identifier
    expected[id] = total
    var frames = assembling[id] ?? [:]
    frames[index] = frame.subdata(in: (frame.startIndex + 2)..<frame.endIndex)
    assembling[id] = frames
    guard frames.count == total else { return }

    var payload = Data()
    for position in 0..<total {
      guard let part = frames[position] else { return }
      payload.append(part)
    }
    let wasTouching = touching.removeValue(forKey: id) ?? false
    // Stop before emitting: the screen this wakes may tear the scanner down,
    // and a half-read second peer would then be left connected.
    finish(peripheral)

    guard payload.count <= Self.maxPayloadBytes, let value = String(data: payload, encoding: .utf8) else {
      diagnose("A phone answered but its request could not be read")
      emit(Self.errorEvent, "That phone did not share a readable payment request")
      return
    }
    diagnose(wasTouching ? "Request read — opening it as a tap" : "Request read — asking for approval")
    emitRequest(value, touching: wasTouching)
  }
}
