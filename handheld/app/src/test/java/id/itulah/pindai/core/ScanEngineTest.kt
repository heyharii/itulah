package id.itulah.pindai.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A malformed read the radio sometimes returns: not 24 hex characters.
 *
 * These are failed reads wearing an EPC's clothes, and counting them as tags is
 * how a distinct-tag total creeps upward the longer a sweep runs.
 */
private const val TRUNCATED = "A1123456"

/** A valid EPC for [sku], unit [serial]. */
private fun epc(sku: String, serial: Long): String {
    val digits = sku.padStart(11, '0')
    val bytes = ByteArray(12)
    bytes[0] = 0xA1.toByte()
    for (i in 0 until 5) {
        bytes[i + 1] = (((digits[i * 2] - '0') shl 4) or (digits[i * 2 + 1] - '0')).toByte()
    }
    bytes[6] = (((digits[10] - '0') shl 4) or ((serial ushr 40).toInt() and 0x0F)).toByte()
    for (i in 0 until 5) {
        bytes[7 + i] = ((serial ushr ((4 - i) * 8)) and 0xFF).toByte()
    }
    return bytes.joinToString("") { "%02X".format(it) }
}

class ScanEngineTest {

    private fun engineWith(vararg known: String) = ScanEngine().apply {
        useCatalogue(known.toSet())
        reset()
    }

    /** Feed the engine and let its worker finish, without a UI to wait on. */
    private fun ScanEngine.sweep(block: ScanEngine.() -> Unit) {
        start()
        block()
        stop()
    }

    @Test
    fun `a tag read seventy-four times is one unit`() {
        val engine = engineWith("12345678123")
        val tag = epc("12345678123", 1)
        engine.sweep { repeat(74) { offer(tag, "-55") } }

        assertEquals(1, engine.snapshot().units)
        assertEquals(1, engine.snapshot().skus)
        assertEquals(74, engine.metrics().sightings)
        assertEquals(73, engine.metrics().duplicates)
    }

    @Test
    fun `different units of one SKU add up`() {
        val engine = engineWith("12345678123")
        engine.sweep {
            (1L..5L).forEach { offer(epc("12345678123", it), null) }
        }
        val counts = engine.snapshot()
        assertEquals(5, counts.units)
        assertEquals(1, counts.skus)
        assertEquals(1, counts.articles)
        assertEquals(5, engine.lines().single().qty)
    }

    @Test
    fun `sizes and colours of one article are one article and many SKUs`() {
        // article 12345678, two colours, two sizes.
        val engine = engineWith("12345678101", "12345678102", "12345678201", "12345678202")
        engine.sweep {
            offer(epc("12345678101", 1), null)
            offer(epc("12345678102", 1), null)
            offer(epc("12345678201", 1), null)
            offer(epc("12345678202", 1), null)
        }
        val counts = engine.snapshot()
        assertEquals(4, counts.units)
        assertEquals(4, counts.skus)
        assertEquals(1, counts.articles)
    }

    @Test
    fun `an unknown SKU is reported beside the total, never inside it`() {
        val engine = engineWith("12345678123")
        engine.sweep {
            offer(epc("12345678123", 1), null)
            offer(epc("99999999999", 1), null)
        }
        val counts = engine.snapshot()
        // The total is what can be NAMED. A figure somebody is about to write on
        // a count sheet must be a figure of things they can identify.
        assertEquals(1, counts.units)
        assertEquals(1, counts.skus)
        // But it is not hidden: the sweep says how many it could not name, so a
        // stale catalogue announces itself instead of quietly shrinking a count.
        assertEquals(1, counts.unknown)
        assertEquals(1, counts.unknownUnits)
        assertEquals(0, counts.foreign)
        // And the radio's own figure still sees both.
        assertEquals(2, counts.distinctTags)
    }

    @Test
    fun `a foreign tag is not product and not unknown`() {
        val engine = engineWith("12345678123")
        engine.sweep {
            offer(epc("12345678123", 1), null)
            offer("301234567812300000000064", null) // SGTIN
        }
        val counts = engine.snapshot()
        assertEquals(1, counts.units)   // one product
        assertEquals(1, counts.skus)
        assertEquals(0, counts.unknown)
        assertEquals(1, counts.foreign) // somebody else's tag, correctly set aside
        assertEquals(2, counts.distinctTags) // the radio heard both
    }

    @Test
    fun `the same tag in two letter cases is one unit`() {
        val engine = engineWith("12345678123")
        val tag = epc("12345678123", 7)
        engine.sweep {
            offer(tag.uppercase(), null)
            offer(tag.lowercase(), null)
        }
        assertEquals(1, engine.snapshot().units)
    }

    @Test
    fun `stopping drains what was still in flight`() {
        // Tags offered with no chance for the worker to wake must still be
        // counted: these are the reads from the instant the trigger was let go.
        val engine = engineWith("12345678123")
        engine.start()
        (1L..500L).forEach { engine.offer(epc("12345678123", it), null) }
        engine.stop()
        assertEquals(500, engine.snapshot().units)
        assertEquals(500, engine.lines().single().qty)
    }

    @Test
    fun `an expected set turns a sweep into a comparison`() {
        val engine = ScanEngine().apply {
            useCatalogue(setOf("12345678123", "12345678124", "12345678999"))
            expect(setOf("12345678123", "12345678124"))
            reset()
        }
        engine.sweep {
            offer(epc("12345678123", 1), null)
            offer(epc("12345678999", 1), null) // not on the list
        }
        val counts = engine.snapshot()
        assertEquals(2, counts.expected)
        assertEquals(1, counts.matchedExpected)
        assertEquals(1, counts.unexpected)
    }

    @Test
    fun `evidence is handed over once and can be handed back`() {
        val engine = engineWith("12345678123")
        engine.sweep { (1L..10L).forEach { offer(epc("12345678123", it), null) } }

        val first = engine.takeEvidence(4)
        assertEquals(4, first.size)
        assertEquals(6, engine.evidenceBacklog())

        engine.returnEvidence(first)
        assertEquals(10, engine.evidenceBacklog())

        val all = engine.takeEvidence(1_000)
        assertEquals(10, all.size)
        assertEquals(0, engine.evidenceBacklog())
    }

    @Test
    fun `evidence keeps an RSSI written in either decimal separator`() {
        // The SDK formats RSSI in the device's locale: Indonesian writes a comma.
        val engine = engineWith("12345678123")
        val comma = epc("12345678123", 1)
        val point = epc("12345678123", 2)
        val none = epc("12345678123", 3)
        val empty = epc("12345678123", 4)
        engine.sweep {
            offer(comma, "-48,30")
            offer(point, "-48.30")
            offer(none, "N/A")
            offer(empty, "")
        }

        val rssi = engine.takeEvidence(10).toMap()
        assertEquals(-48.3f, rssi.getValue(comma)!!, 0.001f)
        assertEquals(-48.3f, rssi.getValue(point)!!, 0.001f)
        assertNull(rssi.getValue(none))
        assertNull(rssi.getValue(empty))
    }

    @Test
    fun `a read that is not 96 bits is not a tag`() {
        val engine = engineWith("12345678123")
        engine.sweep {
            offer(epc("12345678123", 1), null)
            offer(TRUNCATED, null)
            offer("NOTHEXNOTHEXNOTHEXNOTHEX", null)
        }
        val counts = engine.snapshot()
        assertEquals(1, counts.distinctTags)
        assertEquals(1, counts.units)
        assertEquals(0, counts.foreign)
        assertEquals(2, counts.malformed)
    }

    @Test
    fun `a tag married to a product is counted as that product`() {
        // The bench fixture: a tag carrying somebody else's EPC, bound locally
        // to a real SKU so a rig full of foreign tags can exercise the screen.
        val engine = ScanEngine().apply {
            useCatalogue(setOf("12345678123"))
            useAliases(mapOf("301234567812300000000064" to "12345678123"))
            reset()
        }
        engine.sweep { offer("301234567812300000000064", null) }
        val counts = engine.snapshot()
        assertEquals(1, counts.units)
        assertEquals(0, counts.foreign)
        assertEquals("12345678123", engine.lines().single().skuCode)
    }

    @Test
    fun `a reset sweep keeps nothing from the last one`() {
        val engine = engineWith("12345678123")
        engine.sweep { offer(epc("12345678123", 1), null) }
        assertEquals(1, engine.snapshot().units)

        engine.reset()
        assertEquals(0, engine.snapshot().units)
        assertEquals(0, engine.lines().size)
        assertEquals(0, engine.evidenceBacklog())
    }

    @Test
    fun `ten thousand units aggregate without losing one`() {
        val skus = (0 until 100).map { "1234567%04d".format(it).takeLast(11) }
        val engine = ScanEngine().apply { useCatalogue(skus.toSet()); reset() }
        engine.start()
        var serial = 0L
        skus.forEach { sku ->
            repeat(100) { engine.offer(epc(sku, ++serial), null) }
        }
        engine.stop()
        assertEquals(10_000, engine.snapshot().units)
        assertEquals(0, engine.metrics().dropped)
        assertTrue(
            "worker should be well under 100us per new tag, was " +
                engine.metrics().meanProcessMicros,
            engine.metrics().meanProcessMicros < 100.0,
        )
    }
}
