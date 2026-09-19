package com.rosapay

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
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
    private const val SELECT_APDU_HEADER = "00A40400"

    private val OK = byteArrayOf(0x90.toByte(), 0x00)
    private val UNKNOWN_COMMAND = byteArrayOf(0x6D.toByte(), 0x00)
    private val NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())

    /** Comfortably inside the shortest ISO-DEP response limit reported by phones. */
    const val CHUNK_SIZE = 240

    private val broadcast = AtomicReference<ByteArray?>(null)

    /** Starts offering `payload` to any reader that taps, replacing any earlier one. */
    fun broadcast(payload: String) {
      broadcast.set(payload.toByteArray(Charsets.UTF_8))
    }

    /** Stops offering a request, so a cancelled or paid request cannot be tapped. */
    fun clear() {
      broadcast.set(null)
    }

    fun current(): ByteArray? = broadcast.get()
  }

  override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
    val command = commandApdu ?: return UNKNOWN_COMMAND
    val payload = current() ?: return NOT_FOUND

    if (isSelect(command)) {
      // The reader learns how many chunks to ask for before asking for any.
      val chunks = (payload.size + CHUNK_SIZE - 1) / CHUNK_SIZE
      return byteArrayOf(chunks.toByte()) + OK
    }

    if (isRead(command)) {
      val index = command[2].toInt() and 0xFF
      val start = index * CHUNK_SIZE
      if (start >= payload.size) return NOT_FOUND
      val end = minOf(start + CHUNK_SIZE, payload.size)
      return payload.copyOfRange(start, end) + OK
    }

    return UNKNOWN_COMMAND
  }

  override fun onDeactivated(reason: Int) = Unit

  private fun isSelect(command: ByteArray): Boolean =
    command.size >= 4 && command.copyOfRange(0, 4).toHex() == SELECT_APDU_HEADER

  /** `00 B0 <chunk> 00` — read binary, one chunk at a time. */
  private fun isRead(command: ByteArray): Boolean =
    command.size >= 4 && command[0] == 0x00.toByte() && command[1] == 0xB0.toByte()

  private fun ByteArray.toHex(): String = joinToString("") { "%02X".format(it) }
}
