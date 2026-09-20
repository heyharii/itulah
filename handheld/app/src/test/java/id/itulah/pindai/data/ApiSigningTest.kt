package id.itulah.pindai.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * The device proof, pinned to a vector both sides agree on.
 *
 * # Why this test exists
 *
 * The Edge recomputes this signature before it reads a single EPC, and if the
 * two implementations disagree by one byte every batch a handheld ever files is
 * refused — with the message "invalid RFID device signature", which points at
 * the key and not at the real cause. That happened: the Edge upper-cases the
 * device id before signing (`edge/rfid.rs`, `normalize_device_id`) and this
 * client signed the raw text from the settings form, so commissioning a reader
 * by typing "c5-dc-01" produced a device that could never file anything.
 *
 * The vector below was computed independently of the Kotlin, from the canonical
 * string the Rust builds:
 *
 * ```
 * POST\n/api/v1/rfid/observations\n{DEVICE}\n{ts}\n{seq}\n{sha256(body)}
 * key = sha256_hex(device_key)
 * ```
 */
class ApiSigningTest {

    private val device = "C5-DC-01"
    private val key = "demo-handheld-key-2026"
    private val timestamp = 1_789_000_000L
    private val sequence = 1_789_000_000L
    private val body = """{"site_id":"dc-01"}""".toByteArray()

    @Test
    fun `the body digest matches the vector`() {
        assertEquals(
            "2b199a9ae2b556b8a0fa10280bf7472dac8acf53c44c8a8fb44bb84ddbd85239",
            Api.bodyDigest(body),
        )
    }

    @Test
    fun `the signature matches what the Edge will recompute`() {
        assertEquals(
            "0f1469fb637663f4dd5af799df8e743cc8a60601cd2fc2a909c8ddb5352c4b01",
            Api.signObservation(device, key, timestamp, sequence, Api.bodyDigest(body)),
        )
    }

    @Test
    fun `a device id typed in lower case signs the same as upper`() {
        // The whole point. The Edge normalises before it signs; so must we, or
        // a handheld commissioned in lower case is silently unable to file.
        assertEquals(
            Api.signObservation("C5-DC-01", key, timestamp, sequence, Api.bodyDigest(body)),
            Api.signObservation("c5-dc-01", key, timestamp, sequence, Api.bodyDigest(body)),
        )
        assertEquals(
            Api.signObservation("C5-DC-01", key, timestamp, sequence, Api.bodyDigest(body)),
            Api.signObservation("  c5-Dc-01  ", key, timestamp, sequence, Api.bodyDigest(body)),
        )
    }

    @Test
    fun `a different key, sequence or body changes the signature`() {
        val base = Api.signObservation(device, key, timestamp, sequence, Api.bodyDigest(body))
        assertNotEquals(base, Api.signObservation(device, "other", timestamp, sequence, Api.bodyDigest(body)))
        assertNotEquals(base, Api.signObservation(device, key, timestamp, sequence + 1, Api.bodyDigest(body)))
        assertNotEquals(base, Api.signObservation(device, key, timestamp + 1, sequence, Api.bodyDigest(body)))
        assertNotEquals(
            base,
            Api.signObservation(device, key, timestamp, sequence, Api.bodyDigest("{}".toByteArray())),
        )
    }
}
