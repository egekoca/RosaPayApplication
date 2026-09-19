import CoreNFC
import Foundation
import React

/**
 The iOS half of the RTP/1 NFC transport, and only the half Apple allows.

 iOS gives no third-party app the ability to emulate a card, so an iPhone can
 never be the merchant over NFC: `getStatus` reports `canBroadcast: false` and
 `startBroadcast` refuses rather than pretending. What an iPhone *can* do is
 read, and an Android merchant running `RosaPayApduService` is an ISO-DEP card
 as far as CoreNFC is concerned. That covers the direction that matters at a
 counter — the merchant owns the terminal, the customer brings whatever phone
 they have.

 The protocol is the one `RosaPayNfcModule.kt` speaks, byte for byte: SELECT the
 AID to learn the chunk count, then READ BINARY each chunk and reassemble. iOS
 selects the AID itself before handing the tag over, but it keeps that response
 to itself, so the count is asked for again with an explicit SELECT. The Android
 service answers any SELECT with the current count, so asking twice is free.

 Unlike Android's reader mode, a CoreNFC session puts a system sheet on screen
 and cannot poll quietly in the background. Starting one the moment the scan
 screen mounts would cover the camera, so `needsUserAction` tells the JS side to
 wait for a deliberate tap instead of arming itself.
 */
@objc(RosaPayNfc)
class RosaPayNfc: RCTEventEmitter {

  /// Matches `apduservice.xml` and `RosaPayNfcModule.AID`.
  private static let aid = Data([0xF0, 0x52, 0x6F, 0x73, 0x61, 0x50, 0x61, 0x79, 0x01])
  /// Matches `RosaPayNfcModule.MAX_CHUNKS`; more than this is not a request.
  private static let maxChunks = 32
  private static let readEvent = "RosaPayNfcRequestRead"
  private static let errorEvent = "RosaPayNfcError"

  private var session: NFCTagReaderSession?

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String] {
    [Self.readEvent, Self.errorEvent]
  }

  override func invalidate() {
    // A reload must not leave a reader sheet on screen owned by a dead bridge.
    DispatchQueue.main.async { [weak self] in
      self?.session?.invalidate()
      self?.session = nil
    }
    super.invalidate()
  }

  @objc(getStatus:rejecter:)
  func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    let available = NFCTagReaderSession.readingAvailable
    resolve([
      "supported": available,
      // iOS exposes no separate "NFC is switched off" state the way Android
      // does: the radio is on whenever the hardware is there.
      "enabled": available,
      "canBroadcast": false,
      "needsUserAction": true,
    ])
  }

  @objc(startBroadcast:resolver:rejecter:)
  func startBroadcast(
    _: String,
    resolver _: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    reject("NFC_UNSUPPORTED", "iPhone cannot share a request over NFC; show the QR code instead", nil)
  }

  @objc(stopBroadcast:rejecter:)
  func stopBroadcast(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    resolve(nil)
  }

  @objc(startReading:rejecter:)
  func startReading(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard NFCTagReaderSession.readingAvailable else {
      reject("NFC_UNSUPPORTED", "This iPhone cannot read a payment request by tapping", nil)
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      // Restarting while a sheet is already up would hand CoreNFC two sessions.
      self.session?.invalidate()
      guard let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: nil) else {
        reject("NFC_UNAVAILABLE", "The NFC reader could not be started", nil)
        return
      }
      session.alertMessage = "Hold this iPhone near the merchant's phone."
      self.session = session
      session.begin()
      resolve(nil)
    }
  }

  @objc(stopReading:rejecter:)
  func stopReading(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async { [weak self] in
      self?.session?.invalidate()
      self?.session = nil
      resolve(nil)
    }
  }

  private func emit(_ event: String, _ value: String) {
    // `sendEvent` throws if nothing is listening yet, which is normal during teardown.
    if bridge != nil {
      sendEvent(withName: event, body: value)
    }
  }

  /// Ends the session with a message in the system sheet and tells the JS side why.
  private func fail(_ session: NFCTagReaderSession, _ message: String) {
    self.session = nil
    session.invalidate(errorMessage: message)
    emit(Self.errorEvent, message)
  }
}

extension RosaPayNfc: NFCTagReaderSessionDelegate {

  func tagReaderSessionDidBecomeActive(_: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    // A customer closing the sheet, or the 60s timeout, is not a failure worth
    // showing: only surface what someone can act on.
    let code = (error as? NFCReaderError)?.code
    let silent: [NFCReaderError.Code] = [
      .readerSessionInvalidationErrorUserCanceled,
      .readerSessionInvalidationErrorSessionTimeout,
      .readerSessionInvalidationErrorSessionTerminatedUnexpectedly,
    ]
    if self.session === session {
      self.session = nil
    }
    if let code, silent.contains(code) {
      return
    }
    if code == .readerSessionInvalidationErrorFirstNDEFTagRead {
      return
    }
    emit(Self.errorEvent, "The tap was interrupted")
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard let tag = tags.first, case let .iso7816(isoTag) = tag else {
      fail(session, "That device did not offer a payment request")
      return
    }

    session.connect(to: tag) { [weak self] error in
      guard let self else { return }
      if error != nil {
        self.fail(session, "Hold the phones together until the request is read")
        return
      }
      self.selectApplication(on: isoTag, session: session)
    }
  }

  private func selectApplication(on tag: NFCISO7816Tag, session: NFCTagReaderSession) {
    let select = NFCISO7816APDU(
      instructionClass: 0x00,
      instructionCode: 0xA4,
      p1Parameter: 0x04,
      p2Parameter: 0x00,
      data: Self.aid,
      expectedResponseLength: 256
    )

    tag.sendCommand(apdu: select) { [weak self] response, sw1, sw2, error in
      guard let self else { return }
      guard error == nil, sw1 == 0x90, sw2 == 0x00, let chunks = response.first.map({ Int($0) }) else {
        self.fail(session, "That device is not sharing a Rosa Pay request")
        return
      }
      guard chunks > 0, chunks <= Self.maxChunks else {
        self.fail(session, "That request is too large to be a payment request")
        return
      }
      self.readChunk(index: 0, of: chunks, from: tag, session: session, collected: Data())
    }
  }

  private func readChunk(
    index: Int,
    of total: Int,
    from tag: NFCISO7816Tag,
    session: NFCTagReaderSession,
    collected: Data
  ) {
    guard index < total else {
      guard let payload = String(data: collected, encoding: .utf8) else {
        fail(session, "That device did not share a readable payment request")
        return
      }
      self.session = nil
      session.alertMessage = "Request read."
      session.invalidate()
      emit(Self.readEvent, payload)
      return
    }

    let read = NFCISO7816APDU(
      instructionClass: 0x00,
      instructionCode: 0xB0,
      p1Parameter: UInt8(index),
      p2Parameter: 0x00,
      data: Data(),
      expectedResponseLength: 256
    )

    tag.sendCommand(apdu: read) { [weak self] response, sw1, sw2, error in
      guard let self else { return }
      guard error == nil, sw1 == 0x90, sw2 == 0x00 else {
        self.fail(session, "The tap ended before the request was complete")
        return
      }
      self.readChunk(
        index: index + 1,
        of: total,
        from: tag,
        session: session,
        collected: collected + response
      )
    }
  }
}
