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
  /**
   The channel the customer answers on.

   The merchant's characteristic notifies and cannot be written to, which was
   enough while the radio only carried a request. Paying without a network is a
   conversation — who is paying, the entry to sign, the signature, what the
   chain said — so the customer needs a way to speak. A second, writable
   characteristic is that way, and it keeps the merchant's outbound stream
   exactly as it was.
   */
  private static let replyUUID = CBUUID(string: "F0526F73-6150-4179-9C03-524F53415041")

  private static let messageEvent = "RosaPayProximityMessage"
  private static let errorEvent = "RosaPayProximityError"
  /// Narration of what the radio is doing, for the diagnostics screen only.
  /// Nothing in the payment path reads it.
  private static let diagnosticEvent = "RosaPayProximityDiagnostic"

  /// RTP/1 bounds its QR URI at 4,096 characters, so nothing larger is a
  /// payment request and a peer claiming otherwise is dropped rather than read.
  private static let maxPayloadBytes = 4_096
  /// One byte of sequence and one of total, so a frame count must fit in a byte.
  private static let maxFrames = 255
  /// One byte of kind, one of sequence, one of total.
  private static let frameHeader = 3
  /// The opening message: the signed request itself, which a QR also carries.
  private static let requestKind: UInt8 = 1

  /**
   How long a connected phone is kept while nothing arrives from it.

   Reading a request used to be the end of the encounter, so the link was
   dropped the moment the last frame landed. An offline payment starts there
   instead: the customer has to answer, and between the two there is a person
   reading an amount and a device prompt waiting to be answered. This is the
   budget for all of that, after which an abandoned payment stops holding a
   radio link open.
   */
  private static let sessionTimeout: TimeInterval = 180

  /**
   How close a phone has to read before it is worth following at all, in dBm.

   This is the outer edge of the conversation rather than the gate a request
   passes. A merchant read this strongly is only added to the list of phones
   whose readings are worth collecting; what offers a request is `closeRssi` or
   `approachDelta` below, judged on those readings.

   Deliberately loose. Following a phone too readily costs a few samples;
   following it too late means the approach that would have offered the request
   went unwatched, because the resting level it is measured against was never
   seen.
   */
  private static let nearbyRssi = -75

  /**
   How strong a reading is close enough to offer a request on its own.

   The gesture this exists for is two phones brought together, and it is meant
   to mean a few centimetres — the reach of a tap, not of a room. A radio
   cannot promise that. BLE reports one number that falls off with distance but
   also with a hand, a body, a pocket, and the two metal chassis that a pair of
   phones held face to face put between their own edge-mounted antennas. Ten
   centimetres and half a metre overlap across handsets, so no absolute number
   separates them cleanly, and a number tight enough to be certain is the worst
   failure available here: nothing on screen, no error, nothing to act on.

   So this sits where a phone is plausibly at the counter rather than across
   it, and `approachDelta` carries the rest. Free air gives touching about -40,
   a hand's width -55 and a metre -70; pressed together reads well below the
   free-air figure for the same gap, which is why this sits under the
   hand's-width reading rather than at it.
   */
  private static let closeRssi = -65

  /**
   How much stronger than its own resting level a phone must read before that
   counts as having been brought over, in dB.

   This is the half of the gate that needs no calibration. Whatever a
   particular pair of handsets reads at a metre, halving the distance adds
   about 6 dB and quartering it about 12, so a rise of this size means the
   phone moved much closer — wherever its absolute readings happen to sit. A
   merchant left on a table across the room holds a steady level and never
   produces one; a phone lifted to the counter does.

   The resting level is the weakest reading seen from that phone, so the rule
   reads as: it is now far closer than it has been all encounter.
   */
  private static let approachDelta = 12

  /**
   How long a merchant may be heard steadily before it is offered anyway.

   The point of this transport is to match the customer standing at a counter
   with the request that counter has open. Distance is how that match is
   guessed at, not the thing being asked for — so a gate on distance must never
   be the reason the match never happens. A phone heard continuously for this
   long, with nothing closer on the air, is the counter the customer is at,
   whatever the readings say about how far away it is. Short, because standing
   still waiting for a phone to notice another phone is the thing this was
   supposed to remove.

   `closeRssi` and `approachDelta` still decide how *fast* the request appears,
   which is the part the gesture earns. This only decides that it appears.
   */
  private static let patienceSeconds: TimeInterval = 2

  /**
   How much weaker than the strongest phone on the air a merchant may read and
   still be the one offered, in dB.

   Two tills side by side are the case this exists for: both are advertising,
   both are within the gate, and the customer is standing at exactly one of
   them. Taking the first to pass would be a coin toss, so a phone that reads
   clearly weaker than something else on the air waits.
   */
  private static let contenderMargin = 6

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
   reflection. Three in agreement is a fraction of a second of steady contact
   rather than a spike: a real pair of iPhones held together was measured at
   about eighteen readings a second, so this costs under a fifth of one and is
   not where any waiting comes from.
   */
  private static let requiredSamples = 3

  /// How long a half-finished read is given before it is abandoned and retried.
  private static let readTimeout: TimeInterval = 10

  private var peripheral: CBPeripheralManager?
  private var central: CBCentralManager?
  /// Callers waiting for the person to answer the system's Bluetooth prompt.
  private var permissionResolvers: [RCTPromiseResolveBlock] = []

  /// How far one message being sent to one peer has got, and how it is cut.
  private struct Transfer {
    let kind: UInt8
    let payload: Data
    var next: Int
    let capacity: Int
    let total: Int
  }

  /// A message waiting its turn on one peer's link.
  private struct Outbound {
    let kind: UInt8
    let payload: Data
  }

  /// Held for the peripheral role: what to hand a customer who subscribes.
  private var advertised: Data?
  /// One entry per customer being sent to, so a paused send can carry on.
  private var sending: [UUID: Transfer] = [:]
  /// What is still to say to each customer, in order.
  private var outbox: [UUID: [Outbound]] = [:]
  /// The customers currently subscribed, so a later message can be addressed.
  private var subscribers: [UUID: CBCentral] = [:]
  /// Half-received answers from each customer.
  private var incoming: [UUID: [Int: Data]] = [:]
  private var incomingKind: [UUID: UInt8] = [:]
  private var requestCharacteristic: CBMutableCharacteristic?
  private var replyCharacteristic: CBMutableCharacteristic?
  private var advertisingWanted = false

  /// Held for the central role, one entry per peer being read.
  private var connected: [UUID: CBPeripheral] = [:]
  private var assembling: [UUID: [Int: Data]] = [:]
  private var expected: [UUID: Int] = [:]
  /// The last few signal readings per peer, and what they said at connect time.
  private var samples: [UUID: [Int]] = [:]
  /// The weakest reading each peer has given, which an approach is measured against.
  private var resting: [UUID: Int] = [:]
  /// When each peer was first heard in range, which patience is measured from.
  private var firstSeen: [UUID: Date] = [:]
  /// When a read began, so one that never finishes can be started over.
  private var readingSince: [UUID: Date] = [:]
  /// When the last thing was heard from a peer, so an abandoned link is let go.
  private var lastHeard: [UUID: Date] = [:]
  /// The channel this phone answers a merchant on, once discovered.
  private var replyTo: [UUID: CBCharacteristic] = [:]
  /// Frames still to write to each merchant, and the one in flight.
  private var writing: [UUID: [Data]] = [:]
  /**
   Peers a payment on screen is still talking to.

   Leaving the screen the radio listens on tears the scanner down, and that used
   to be the end of every link it had made — which was right while reading a
   request was the whole encounter. It is exactly wrong now: the customer reads
   the request, the screen changes to show it, and the conversation that pays it
   has not started yet. A held peer survives the scanner being stopped and is
   let go by the screen that holds it, or by the timeout below.
   */
  private var held: Set<UUID> = []
  /// The strongest reading from any peer just now, so the nearer till wins.
  private var best: (strength: Int, at: Date)?
  private var touching: [UUID: Bool] = [:]
  private var scanningWanted = false
  /// Says out loud, every few seconds, whether anything is on the air at all.
  private var heartbeat: Timer?
  private var sightings = 0
  private var strongest: Int?

  /// A Bluetooth state in words, for the diagnostics screen.
  private static func describe(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "on"
    case .poweredOff: return "switched off"
    case .unauthorized: return "not allowed for Rosa Pay"
    case .unsupported: return "unsupported on this phone"
    case .resetting: return "restarting"
    default: return "still starting up"
    }
  }

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String] {
    [Self.messageEvent, Self.errorEvent, Self.diagnosticEvent]
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
    // Whatever was half-said belonged to the request being replaced.
    sending.removeAll()
    outbox.removeAll()
    incoming.removeAll()
    incomingKind.removeAll()

    // Notify rather than read: a request is well past the 512-byte ceiling on a
    // readable attribute, so the peripheral pushes it in MTU-sized frames once
    // a customer subscribes.
    let characteristic = CBMutableCharacteristic(
      type: Self.requestUUID,
      properties: [.notify],
      value: nil,
      permissions: [.readable]
    )
    // The customer's half of the conversation. Written rather than notified,
    // because the customer is the central here and a central cannot notify.
    let reply = CBMutableCharacteristic(
      type: Self.replyUUID,
      properties: [.write, .writeWithoutResponse],
      value: nil,
      permissions: [.writeable]
    )
    let service = CBMutableService(type: Self.serviceUUID, primary: true)
    service.characteristics = [characteristic, reply]
    requestCharacteristic = characteristic
    replyCharacteristic = reply
    // Advertising starts in `didAdd`, not here. A service is added
    // asynchronously, and a phone that advertises before its service exists is
    // found and then answers nothing — which looks from the outside exactly
    // like not being found at all.
    manager.add(service)
    diagnose("Publishing the request service")
  }

  private func teardownPeripheral() {
    advertisingWanted = false
    advertised = nil
    requestCharacteristic = nil
    replyCharacteristic = nil
    sending.removeAll()
    outbox.removeAll()
    subscribers.removeAll()
    incoming.removeAll()
    incomingKind.removeAll()
    peripheral?.stopAdvertising()
    peripheral?.removeAllServices()
  }

  /// Puts a message on one customer's queue and starts it if nothing is in flight.
  private func enqueue(_ kind: UInt8, _ payload: Data, to central: CBCentral) {
    outbox[central.identifier, default: []].append(Outbound(kind: kind, payload: payload))
    if sending[central.identifier] == nil { beginSend(to: central) }
  }

  /**
   Starts the next message waiting for this customer.

   The frame size is fixed here and kept for the whole transfer. It comes from
   the negotiated MTU, which can change while a transfer is in flight, and a
   resumed send that recomputed it would cut the payload at different offsets
   than the frames already delivered — the receiver would assemble the pieces
   in order and get something that was never sent.
   */
  private func beginSend(to central: CBCentral) {
    let id = central.identifier
    guard var queue = outbox[id], !queue.isEmpty else { return }
    let next = queue.removeFirst()
    outbox[id] = queue

    let capacity = max(central.maximumUpdateValueLength - Self.frameHeader, 1)
    let total = (next.payload.count + capacity - 1) / capacity
    guard total > 0, total <= Self.maxFrames else {
      diagnose("A message needs \(total) frames, which is more than can be sent")
      beginSend(to: central)
      return
    }
    sending[id] = Transfer(kind: next.kind, payload: next.payload, next: 0, capacity: capacity, total: total)
    diagnose("Sending message \(next.kind) in \(total) frames of \(capacity) bytes")
    send(to: central)
  }

  /**
   Pushes as many frames as the queue will take, and remembers where it stopped.

   Resuming is the whole point. `updateValue` returns false when iOS has no
   room left, and the send used to start again from the first frame every time
   `IsReadyToUpdateSubscribers` fired. A request is around 700 bytes, and a
   connection that has not yet negotiated a larger MTU carries 18 of them per
   frame — so the queue filled long before the last frame, the resend began at
   frame one again, filled at the same place, and the customer received the
   opening frames over and over for as long as the two phones were held
   together. The merchant said it was sending, the customer had subscribed, and
   the request could never arrive.
   */
  private func send(to central: CBCentral) {
    guard
      let manager = peripheral,
      let characteristic = requestCharacteristic,
      var progress = sending[central.identifier]
    else { return }

    while progress.next < progress.total {
      let start = progress.next * progress.capacity
      let end = min(start + progress.capacity, progress.payload.count)
      var frame = Data([progress.kind, UInt8(progress.next), UInt8(progress.total)])
      frame.append(progress.payload.subdata(in: start..<end))
      guard manager.updateValue(frame, for: characteristic, onSubscribedCentrals: [central]) else {
        // Full. Keep the place; `IsReadyToUpdateSubscribers` carries on here.
        sending[central.identifier] = progress
        return
      }
      progress.next += 1
    }
    sending.removeValue(forKey: central.identifier)
    diagnose("Sent a whole message — \(progress.total) frames")
    // Whatever is next for this customer follows immediately; an offline
    // payment is several messages and waiting between them is waiting at a till.
    beginSend(to: central)
  }

  // MARK: - Either role: one addressed message

  /**
   Sends one message to one peer, whichever end of the link this phone is.

   A merchant answers a customer it is advertising to; a customer answers the
   merchant it connected to. The caller does not say which, because at the level
   of the conversation there is no difference — there is a peer, and something
   to tell it.
   */
  @objc(sendMessage:kind:payload:resolver:rejecter:)
  func sendMessage(
    _ peerId: String,
    kind: NSNumber,
    payload: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let data = payload.data(using: .utf8), !data.isEmpty else {
      reject("BLE_PAYLOAD_EMPTY", "There was nothing to send", nil)
      return
    }
    guard data.count <= Self.maxPayloadBytes else {
      reject("BLE_PAYLOAD_TOO_LARGE", "That message is too large to send over Bluetooth", nil)
      return
    }
    guard let id = UUID(uuidString: peerId) else {
      reject("BLE_PEER_UNKNOWN", "That phone is no longer connected", nil)
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let code = UInt8(truncating: kind)
      if let central = self.subscribers[id] {
        self.enqueue(code, data, to: central)
        resolve(nil)
        return
      }
      if let peer = self.connected[id] {
        self.write(code, data, to: peer)
        resolve(nil)
        return
      }
      reject("BLE_PEER_UNKNOWN", "That phone is no longer connected", nil)
    }
  }

  /**
   Keeps a link open past the screen that made it.

   Called by the customer's side the moment a request is taken into a payment.
   Until it is released, stopping the scanner leaves this one peer connected.
   */
  @objc(holdPeer:resolver:rejecter:)
  func holdPeer(
    _ peerId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let id = UUID(uuidString: peerId) else {
        resolve(nil)
        return
      }
      self.held.insert(id)
      self.lastHeard[id] = Date()
      self.startHeartbeat(force: true)
      resolve(nil)
    }
  }

  /// Lets a peer go once its payment is over, one way or the other.
  @objc(releasePeer:resolver:rejecter:)
  func releasePeer(
    _ peerId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter _: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self, let id = UUID(uuidString: peerId) else {
        resolve(nil)
        return
      }
      self.outbox.removeValue(forKey: id)
      self.sending.removeValue(forKey: id)
      self.incoming.removeValue(forKey: id)
      self.incomingKind.removeValue(forKey: id)
      self.held.remove(id)
      if let peer = self.connected[id] { self.finish(peer) }
      resolve(nil)
    }
  }

  /**
   Writes a message to a merchant, one frame at a time.

   Writes are answered rather than fired: `.withResponse` is what makes a link
   with a small MTU deliver dozens of frames in order instead of dropping the
   ones that arrived while the last was still being handled. The queue here is
   the other half of that — only one write is ever in flight.
   */
  private func write(_ kind: UInt8, _ payload: Data, to peer: CBPeripheral) {
    guard let characteristic = replyTo[peer.identifier] else {
      diagnose("This merchant offers no way to answer it")
      emit(Self.errorEvent, "That phone cannot take an answer over Bluetooth")
      return
    }
    let capacity = max(peer.maximumWriteValueLength(for: .withResponse) - Self.frameHeader, 1)
    let total = (payload.count + capacity - 1) / capacity
    guard total > 0, total <= Self.maxFrames else {
      diagnose("An answer needs \(total) frames, which is more than can be sent")
      return
    }

    var frames: [Data] = []
    for index in 0..<total {
      let start = index * capacity
      let end = min(start + capacity, payload.count)
      var frame = Data([kind, UInt8(index), UInt8(total)])
      frame.append(payload.subdata(in: start..<end))
      frames.append(frame)
    }

    let idle = (writing[peer.identifier] ?? []).isEmpty
    writing[peer.identifier, default: []].append(contentsOf: frames)
    diagnose("Answering the merchant in \(total) frames of \(capacity) bytes")
    if idle { writeNext(to: peer, characteristic: characteristic) }
  }

  private func writeNext(to peer: CBPeripheral, characteristic: CBCharacteristic) {
    guard var queue = writing[peer.identifier], !queue.isEmpty else { return }
    let frame = queue.removeFirst()
    writing[peer.identifier] = queue
    peer.writeValue(frame, for: characteristic, type: .withResponse)
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
    startHeartbeat()
  }

  /**
   Says every few seconds whether anything is being heard.

   A scanner that finds nothing writes nothing, so "the merchant is not
   advertising", "Bluetooth is off at this end" and "the diagnostics panel
   itself is dead" all looked identical: an empty log. They have completely
   different fixes. This turns the silent case into a line of its own, and
   reports the strongest reading of the last few seconds when there is one, so
   a phone that is heard but never close enough says so instead of appearing
   never to have been heard at all.
   */
  private func startHeartbeat(force: Bool = false) {
    if force, heartbeat != nil { return }
    heartbeat?.invalidate()
    sightings = 0
    strongest = nil
    heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
      guard let self else { return }
      // A payment in progress outlives the scan that found it, so the sweep
      // below has to keep running after scanning has stopped.
      guard self.scanningWanted || !self.held.isEmpty else {
        self.heartbeat?.invalidate()
        self.heartbeat = nil
        return
      }
      if !self.scanningWanted {
        self.sweepAbandonedSessions()
        return
      }
      if self.sightings == 0 {
        self.diagnose("Still listening — no Rosa Pay phone on the air")
      } else if let peak = self.strongest {
        self.diagnose("Still listening — \(self.sightings) readings, strongest \(peak) dBm")
      }
      self.sightings = 0
      self.strongest = nil

      // A read that stops halfway used to hold the connection for ever: the
      // peer stays in `connected`, so it is never offered again, and the phone
      // goes quiet while being held against a counter that is still asking to
      // be paid. Let it go and let discovery start over.
      for (id, started) in self.readingSince
      where -started.timeIntervalSinceNow > Self.readTimeout && !self.held.contains(id) {
        guard let peer = self.connected[id] else { continue }
        self.diagnose("A merchant connected but never finished sending — starting over")
        self.finish(peer)
      }
      self.sweepAbandonedSessions()
    }
  }

  /// Drops a payment nobody is carrying on with, so it stops holding a link.
  private func sweepAbandonedSessions() {
    for id in held {
      let since = lastHeard[id] ?? Date.distantPast
      guard -since.timeIntervalSinceNow > Self.sessionTimeout else { continue }
      diagnose("A payment went quiet for too long — letting the merchant go")
      held.remove(id)
      if let peer = connected[id] { finish(peer) }
    }
  }

  private func teardownCentral() {
    scanningWanted = false
    // The sweep that eventually lets an abandoned payment go is the same timer,
    // so it only stops when there is no payment left to watch.
    if held.isEmpty {
      heartbeat?.invalidate()
      heartbeat = nil
    }
    central?.stopScan()
    // A payment already under way is not part of scanning and must survive it.
    for (id, peer) in connected where !held.contains(id) {
      central?.cancelPeripheralConnection(peer)
      forget(id)
    }
    samples.removeAll()
    resting.removeAll()
    firstSeen.removeAll()
    best = nil
  }

  private func finish(_ peer: CBPeripheral) {
    forget(peer.identifier)
    central?.cancelPeripheralConnection(peer)
  }

  /**
   Drops everything known about one phone, so the next encounter is a new one.

   Both ways a read can end have to leave the same state behind. Ending it here
   cleared all of it; a merchant that dropped the connection by itself cleared
   only half, leaving the patience clock and the resting level of an encounter
   that was over — so the very next reading counted as a phone that had been
   heard steadily for six seconds and it reconnected on the spot, over and over.
   */
  private func forget(_ id: UUID) {
    connected.removeValue(forKey: id)
    assembling.removeValue(forKey: id)
    expected.removeValue(forKey: id)
    incoming.removeValue(forKey: id)
    incomingKind.removeValue(forKey: id)
    lastHeard.removeValue(forKey: id)
    replyTo.removeValue(forKey: id)
    writing.removeValue(forKey: id)
    held.remove(id)
    samples.removeValue(forKey: id)
    resting.removeValue(forKey: id)
    firstSeen.removeValue(forKey: id)
    readingSince.removeValue(forKey: id)
    // Already taken by a completed read, which reads it before finishing; this
    // is for the encounter that ended without one.
    touching.removeValue(forKey: id)
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

  /**
   One message from one peer.

   The peer's identifier travels with it because an offline payment is a
   sequence rather than a single arrival: everything said back is addressed to
   the phone that started it, and a counter with two customers in front of it is
   holding two of these conversations at once.
   */
  private func emitMessage(peerId: String, kind: UInt8, payload: String, touching: Bool) {
    if bridge != nil {
      sendEvent(
        withName: Self.messageEvent,
        body: ["peerId": peerId, "kind": Int(kind), "payload": payload, "touching": touching]
      )
    }
  }
}

// MARK: - Peripheral delegate

extension RosaPayProximity: CBPeripheralManagerDelegate {

  func peripheralManagerDidUpdateState(_ manager: CBPeripheralManager) {
    settlePermissionRequests()
    if manager.state == .poweredOn {
      publishService(on: manager)
    } else {
      diagnose("Bluetooth is \(Self.describe(manager.state)) — nothing is being advertised")
    }
  }

  /**
   Puts the request on the air, now that there is something behind it to read.

   Both halves of this were silent before: `add` and `startAdvertising` report
   asynchronously and neither result was ever looked at, so a merchant whose
   advertisement iOS had refused outright saw the same screen as one being
   heard across the counter. A customer holding a phone against it had nothing
   to act on and no way to tell which end was at fault.
   */
  func peripheralManager(_ manager: CBPeripheralManager, didAdd _: CBService, error: Error?) {
    if let error {
      diagnose("This phone could not publish the request service: \(error.localizedDescription)")
      emit(Self.errorEvent, "This phone could not share the request over Bluetooth")
      return
    }
    guard advertisingWanted else { return }
    manager.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
      CBAdvertisementDataLocalNameKey: "Rosa Pay",
    ])
  }

  func peripheralManagerDidStartAdvertising(_: CBPeripheralManager, error: Error?) {
    if let error {
      diagnose("Bluetooth refused to advertise this request: \(error.localizedDescription)")
      emit(Self.errorEvent, "This phone could not share the request over Bluetooth")
      return
    }
    diagnose("On the air — a customer nearby can now pick this request up")
  }

  func peripheralManager(
    _: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo _: CBCharacteristic
  ) {
    guard let payload = advertised else { return }
    diagnose("A customer's phone connected — sending the request")
    subscribers[central.identifier] = central
    enqueue(Self.requestKind, payload, to: central)
  }

  func peripheralManager(
    _: CBPeripheralManager,
    central: CBCentral,
    didUnsubscribeFrom _: CBCharacteristic
  ) {
    sending.removeValue(forKey: central.identifier)
    outbox.removeValue(forKey: central.identifier)
    subscribers.removeValue(forKey: central.identifier)
    incoming.removeValue(forKey: central.identifier)
    incomingKind.removeValue(forKey: central.identifier)
  }

  /**
   Takes the customer's half of the conversation, frame by frame.

   Every write is answered before the next is sent, so these arrive in order and
   none is dropped for arriving while the last was still being handled. The
   reassembly is the same one the customer does on the other channel — the two
   directions are one protocol, not two.
   */
  func peripheralManager(_ manager: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests {
      guard request.characteristic.uuid == Self.replyUUID, let frame = request.value else { continue }
      receive(frame, from: request.central.identifier)
    }
    if let first = requests.first {
      manager.respond(to: first, withResult: .success)
    }
  }

  func peripheralManagerIsReady(toUpdateSubscribers _: CBPeripheralManager) {
    guard let characteristic = requestCharacteristic else { return }
    for central in characteristic.subscribedCentrals ?? [] where sending[central.identifier] != nil {
      send(to: central)
    }
  }
}

// MARK: - Central delegate

extension RosaPayProximity: CBCentralManagerDelegate {

  func centralManagerDidUpdateState(_ manager: CBCentralManager) {
    settlePermissionRequests()
    if manager.state == .poweredOn {
      beginScan(on: manager)
    } else if scanningWanted {
      diagnose("Bluetooth is \(Self.describe(manager.state)) — nothing can be heard")
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
    sightings += 1
    strongest = max(strongest ?? strength, strength)
    let id = peripheral.identifier
    guard connected[id] == nil else { return }

    // Recorded from every reading, including the ones too weak to follow: the
    // weakest this phone has given is what "it was brought closer" is measured
    // against, and the weakest readings are the ones that establish it.
    let floor = min(resting[id] ?? strength, strength)
    resting[id] = floor

    // Out of range resets the run, patience included: a merchant has to be
    // approached, not merely glimpsed once through a crowd.
    guard strength >= Self.nearbyRssi else {
      diagnose("Merchant seen at \(strength) dBm — too far to follow, needs \(Self.nearbyRssi)")
      samples[id] = []
      firstSeen[id] = nil
      return
    }

    if best == nil || best!.at.timeIntervalSinceNow < -1 || strength >= best!.strength {
      best = (strength, Date())
    }
    let waiting = firstSeen[id] ?? Date()
    firstSeen[id] = waiting

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

    // Two ways to be close, and either one offers the request straight away.
    // Reading close outright, or reading far closer than it has all encounter,
    // is what being held against this phone looks like to a radio nobody
    // calibrated for these two handsets.
    let isClose = window.allSatisfy { $0 >= Self.closeRssi }
    let approached = window.allSatisfy { $0 - floor >= Self.approachDelta }
    // And a third way, which is the whole point: a counter heard steadily for
    // a few seconds is the counter this customer is standing at. Distance is
    // how that is guessed at, never what is being asked for, so it is allowed
    // to make the match slower and never allowed to stop it happening.
    let patient = -waiting.timeIntervalSinceNow >= Self.patienceSeconds
    guard isClose || approached || patient else {
      diagnose(
        "Merchant steady at \(strength) dBm, resting \(floor) — hold the phones together"
      )
      return
    }

    // Whichever till is nearer is the one the customer is at.
    if let best, best.at.timeIntervalSinceNow > -1, strength < best.strength - Self.contenderMargin {
      diagnose("Merchant at \(strength) dBm, but one at \(best.strength) dBm is closer — waiting")
      return
    }

    // Every reading in the window agreeing is what makes this a deliberate act
    // rather than a spike, and all of them at touching strength is what lets it
    // stand in for a tap.
    let isTouching = window.allSatisfy { $0 >= Self.touchingRssi }
    diagnose(
      isTouching
        ? "Touching at \(strength) dBm — connecting"
        : patient && !isClose && !approached
          ? "Heard steadily at \(strength) dBm for \(Int(Self.patienceSeconds))s — connecting"
          : "Close at \(strength) dBm, resting \(floor), but not touching, needs \(Self.touchingRssi) — connecting"
    )
    touching[id] = isTouching
    connected[id] = peripheral
    assembling[id] = [:]
    readingSince[id] = Date()
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
    forget(peripheral.identifier)
  }
}

// MARK: - Reading one merchant's request

extension RosaPayProximity: CBPeripheralDelegate {

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
      finish(peripheral)
      return
    }
    peripheral.discoverCharacteristics([Self.requestUUID, Self.replyUUID], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard
      error == nil,
      let characteristic = service.characteristics?.first(where: { $0.uuid == Self.requestUUID })
    else {
      finish(peripheral)
      return
    }
    // A merchant that offers no reply channel is an older build. It can still
    // be paid the way it always could — online — so the request is read and the
    // absence only shows up if the customer tries to answer.
    if let reply = service.characteristics?.first(where: { $0.uuid == Self.replyUUID }) {
      replyTo[peripheral.identifier] = reply
    }
    peripheral.setNotifyValue(true, for: characteristic)
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil else {
      diagnose("The merchant did not take the answer: \(error!.localizedDescription)")
      emit(Self.errorEvent, "The answer could not be sent to that phone")
      writing.removeValue(forKey: peripheral.identifier)
      return
    }
    writeNext(to: peripheral, characteristic: characteristic)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil, let frame = characteristic.value else {
      if error != nil { finish(peripheral) }
      return
    }
    receive(frame, from: peripheral.identifier)
  }
}

// MARK: - Reassembling one message, from either direction

extension RosaPayProximity {

  /**
   Takes one frame and emits the message it completes, if it completes one.

   Both roles arrive here. The merchant's frames come in as writes on the reply
   channel and the customer's as notifications on the request channel, but a
   frame is a frame: a kind, a place in a sequence, and a piece of a payload.
   Keeping one reassembler is what stops the two directions drifting apart.
   */
  private func receive(_ frame: Data, from id: UUID) {
    guard frame.count > Self.frameHeader else { return }
    let kind = frame[frame.startIndex]
    let index = Int(frame[frame.startIndex + 1])
    let total = Int(frame[frame.startIndex + 2])
    guard total > 0, total <= Self.maxFrames, index < total else {
      if let peer = connected[id] { finish(peer) }
      return
    }

    lastHeard[id] = Date()
    // A new message on a link that was mid-way through another one replaces it:
    // the sender moved on, so the half it left behind can never be completed.
    if incomingKind[id] != kind {
      incomingKind[id] = kind
      incoming[id] = [:]
      assembling[id] = [:]
    }
    expected[id] = total
    var frames = assembling[id] ?? [:]
    frames[index] = frame.subdata(in: (frame.startIndex + Self.frameHeader)..<frame.endIndex)
    assembling[id] = frames
    guard frames.count == total else {
      // Sparsely, because a small MTU makes this dozens of frames and the log
      // is short. Enough to see a transfer stop, and where.
      if frames.count == 1 || frames.count % 8 == 0 {
        diagnose("Reading a message — \(frames.count) of \(total) frames")
      }
      return
    }

    var payload = Data()
    for position in 0..<total {
      guard let part = frames[position] else { return }
      payload.append(part)
    }
    assembling[id] = [:]
    incoming[id] = [:]
    incomingKind.removeValue(forKey: id)
    readingSince.removeValue(forKey: id)

    guard payload.count <= Self.maxPayloadBytes, let value = String(data: payload, encoding: .utf8) else {
      diagnose("A phone answered but the message could not be read")
      emit(Self.errorEvent, "That phone did not send anything readable")
      return
    }

    // Only the opening request carries a verdict about how the phones were
    // held. Everything after it belongs to a payment already on screen, where
    // proximity has already done its one job.
    let wasTouching = kind == Self.requestKind ? (touching.removeValue(forKey: id) ?? false) : false
    if kind == Self.requestKind {
      diagnose(wasTouching ? "Request read — opening it as a tap" : "Request read — asking for approval")
    } else {
      diagnose("Read message \(kind) — \(total) frames")
    }
    emitMessage(peerId: id.uuidString, kind: kind, payload: value, touching: wasTouching)
  }
}
