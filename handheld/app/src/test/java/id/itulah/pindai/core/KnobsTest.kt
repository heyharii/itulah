package id.itulah.pindai.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The arithmetic behind the Lab's SDK knobs.
 *
 * Each of these is a reading somebody will act on at the bench — a frame they
 * will believe was sent, a region they will believe the module is in — so a
 * wrong byte here is a wrong conclusion about the hardware.
 */
class KnobsTest {

    @Test
    fun `an RSSI reads in either decimal separator`() {
        // The SDK formats it in the device's own locale; Indonesian writes a comma.
        assertEquals(-48.3f, Knobs.rssiOf("-48.30"), 0.001f)
        assertEquals(-48.3f, Knobs.rssiOf("-48,30"), 0.001f)
        assertEquals(-15f, Knobs.rssiOf("-15.00"), 0.001f)
    }

    @Test
    fun `what the SDK writes when it has no RSSI is not a reading`() {
        assertTrue(Knobs.rssiOf("N/A").isNaN())
        assertTrue(Knobs.rssiOf(null).isNaN())
        assertTrue(Knobs.rssiOf("").isNaN())
        assertTrue(Knobs.rssiOf("-").isNaN())
        assertTrue(Knobs.rssiOf("-48.3.0").isNaN())
    }

    @Test
    fun `only a frame stronger than minus 25 is outside the window`() {
        assertTrue(Knobs.rssiOf("-24.90") > Knobs.WINDOW_DBM)
        assertTrue(Knobs.rssiOf("-25.00") <= Knobs.WINDOW_DBM)
        assertTrue(Knobs.rssiOf("-71.60") <= Knobs.WINDOW_DBM)
    }

    @Test
    fun `the raw power frame carries option 00 and the power twice in centi-dBm`() {
        // 25 dBm is 2500 = 0x09C4; read and write power both.
        assertArrayEquals(
            byteArrayOf(0x10, 0x00, 0x01, 0x09, 0xC4.toByte(), 0x09, 0xC4.toByte()),
            Knobs.powerFrame(25),
        )
        assertEquals("10 00 01 0B B8 0B B8", Knobs.hex(Knobs.powerFrame(30)))
    }

    @Test
    fun `the dynamic power frame is 30 01 and the figure`() {
        assertEquals("30 01 14", Knobs.dynamicFrame(20))
    }

    @Test
    fun `a region is named from the vendor table`() {
        // The C5 reads the raw code back for every code from 10 up: 0x3F is 63.
        assertEquals("0x3F · Indonesia 920–923", Knobs.regionName(63))
        assertEquals("0x41 · HK 920–925", Knobs.regionName(0x41))
    }

    @Test
    fun `an aliased code says what else it could be`() {
        // Raw 00 goes through the SDK's index and back as 02.
        assertEquals("0x02 · China Standard2 920–925 · or raw 0x00", Knobs.regionName(2))
        assertEquals("0x80 · not in the vendor table · or raw 0x07", Knobs.regionName(0x80))
    }

    @Test
    fun `an unreadable region says so`() {
        assertEquals("unreadable", Knobs.regionName(-1))
        assertEquals("0x45 · not in the vendor table", Knobs.regionName(0x45))
    }

    @Test
    fun `the last stop in the log is the one that counts`() {
        val log = """
            10-22 19:01:02.003  1234  1290 D DeviceAPI: UHF_StopGet: okcnt=120, GetTagCount=121
            10-22 19:01:02.010  1234  1290 D DeviceAPI: something else
            10-22 19:02:11.512  1234  1290 D DeviceAPI: UHF_StopGet: okcnt=412, GetTagCount=413
        """.trimIndent()
        assertEquals(412 to 413, Knobs.stopCounts(log))
        assertNull(Knobs.stopCounts("no stop here"))
    }

    @Test
    fun `dropped frames are okcnt less ours less the bogus one`() {
        assertEquals(19L, Knobs.dropped(120, 100))
        // Never below zero: a log line from an earlier round says nothing.
        assertEquals(0L, Knobs.dropped(10, 100))
    }

    @Test
    fun `a window compares one tag, not the room`() {
        val w = RssiWindow()
        repeat(10) { w.add("A1NEAR", -50f) }
        w.add("A1FAR", -80f)
        w.add("A1NEAR", Float.NaN)
        assertEquals(11, w.reads())
        assertEquals("A1NEAR", w.busiest())
        assertEquals(10, w.readsOf("A1NEAR"))
        assertEquals(-50f, w.meanOf("A1NEAR"), 0.001f)
        assertTrue(w.meanOf("A1GONE").isNaN())
    }

    @Test
    fun `an empty window has nothing to say`() {
        val w = RssiWindow()
        assertEquals(0, w.reads())
        assertNull(w.busiest())
        assertTrue(w.mean().isNaN())
    }
}
