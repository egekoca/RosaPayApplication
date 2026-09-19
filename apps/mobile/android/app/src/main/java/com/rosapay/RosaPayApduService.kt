package com.rosapay

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Publishes the merchant's signed payment request over NFC, so a customer can
 * tap instead of scanning. The request is the same RTP/1 payload the QR carries:
 * NFC is a transport here, never a second source of truth, and nothing secret
 * ever crosses it — the payload is already public and merchant-signed.
 *
 * Android's HCE stack limits each response to a few hundred bytes, so a request
 * is read in numbered chunks and the reader reassembles it.
 */
class RosaPayApduService : HostApduService() {

  companion object {
    /** Registered in `apduservice.xml`; the reader selects this AID. */
    private val AID = byteArrayOf(0xF0.toByte(), 0x52, 0x6F, 0x73, 0x61, 0x50, 0x61, 0x79, 0x01)

    private val OK = byteArrayOf(0x90.toByte(), 0x00)
    private val UNKNOWN_COMMAND = byteArrayOf(0x6D.toByte(), 0x00)
    private val NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())

    /** Comfortably inside the shortest ISO-DEP response limit reported by phones. */
    const val CHUNK_SIZE = 240
    /** Covers the protocol's 4 KiB QR bound while keeping each response small. */
    const val MAX_CHUNKS = 24
    const val MAX_PAYLOAD_BYTES = CHUNK_SIZE * MAX_CHUNKS

    private val broadcast = AtomicReference<ByteArray?>(null)
    private val broadcastGeneration = AtomicLong(0)

    /** Starts offering `payload` to any reader that taps, replacing any earlier one. */
    fun broadcast(payload: String) {
      val encoded = payload.toByteArray(Charsets.UTF_8)
      if (encoded.isEmpty() || encoded.size > MAX_PAYLOAD_BYTES) return
      broadcast.set(encoded)
      broadcastGeneration.incrementAndGet()
    }

    /** Stops offering a request, so a cancelled or paid request cannot be tapped. */
    fun clear() {
      broadcast.set(null)
      broadcastGeneration.incrementAndGet()
    }

    fun current(): ByteArray? = broadcast.get()

    fun generation(): Long = broadcastGeneration.get()
  }

  /** Frozen for one ISO-DEP connection so a refresh cannot splice two requests. */
  @Volatile
  private var sessionPayload: ByteArray? = null
  @Volatile
  private var sessionGeneration: Long = -1

  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
    val command = commandApdu ?: return UNKNOWN_COMMAND

    if (isSelect(command)) {
      // A reader starts a new session with SELECT. Take one copy here and use it
      // for every READ so a merchant refresh cannot mix bytes from two requests.
      val payload = current()?.copyOf()
      val snapshotGeneration = generation()
      sessionPayload = payload
      sessionGeneration = snapshotGeneration
      if (payload == null || payload.isEmpty() || snapshotGeneration != generation()) return NOT_FOUND
      // The reader learns how many chunks to ask for before asking for any.
      val chunks = (payload.size + CHUNK_SIZE - 1) / CHUNK_SIZE
      return byteArrayOf(chunks.toByte()) + OK
    }

    if (isRead(command)) {
      if (sessionGeneration != generation()) {
        sessionPayload = null
        return NOT_FOUND
      }
      val payload = sessionPayload ?: return NOT_FOUND
      val index = command[2].toInt() and 0xFF
      val start = index * CHUNK_SIZE
      if (start >= payload.size) return NOT_FOUND
      val end = minOf(start + CHUNK_SIZE, payload.size)
      return payload.copyOfRange(start, end) + OK
    }

    return UNKNOWN_COMMAND
  }

  override fun onDeactivated(reason: Int) {
    sessionPayload = null
    sessionGeneration = -1
  }

  private fun isSelect(command: ByteArray): Boolean {
    if (command.size < 5 || command[0] != 0x00.toByte() || command[1] != 0xA4.toByte() ||
      command[2] != 0x04.toByte() || command[3] != 0x00.toByte()
    ) return false
    val length = command[4].toInt() and 0xFF
    return length == AID.size && command.size >= 5 + length &&
      command.copyOfRange(5, 5 + length).contentEquals(AID)
  }

  /** `00 B0 <chunk> 00` — read binary, one chunk at a time. */
  private fun isRead(command: ByteArray): Boolean =
    command.size >= 4 && command[0] == 0x00.toByte() && command[1] == 0xB0.toByte() &&
      command[3] == 0x00.toByte()
}
