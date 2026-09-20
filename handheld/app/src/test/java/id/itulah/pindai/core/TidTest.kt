package id.itulah.pindai.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Whose silicon is on the garment.
 *
 * This is the half of the Gen2X question the reader cannot answer about itself.
 * Tag Focus is a conversation between an Impinj reader and an Impinj tag; if
 * this decoder is wrong, the project concludes "the feature does not work here"
 * when the truth is "we asked the wrong chip".
 */
class TidTest {

    @Test
    fun `our own tags read as Impinj`() {
        // Taken off the bench: the M700-series chips on the test garments.
        val chip = Tid.decode("E2801B03")!!
        assertTrue(chip.isImpinj)
        assertEquals(Tid.IMPINJ, chip.mdid)
        assertEquals("Impinj", chip.vendor)
    }

    @Test
    fun `the designer and the model come out of the same twelve bit pair`() {
        // E2 | 801 | 170 — the nibble at the byte boundary belongs to both
        // fields, which is the only interesting thing in this decoder.
        val chip = Tid.decode("E2801170")!!
        assertEquals(0x801, chip.mdid)
        assertEquals(0x170, chip.tmn)
        assertEquals("TMN 0x170", chip.model)
    }

    @Test
    fun `another maker is reported as a number, not as a name`() {
        // 0x003 is NXP. This code has not been checked against NXP silicon, so
        // it says what it read rather than what it supposes.
        val chip = Tid.decode("E2003412")!!
        assertFalse(chip.isImpinj)
        assertEquals("MDID 0x003", chip.vendor)
    }

    @Test
    fun `case is a rendering choice here too`() {
        assertEquals(Tid.decode("E2801B03"), Tid.decode("e2801b03"))
    }

    @Test
    fun `a longer TID is read from its first four bytes`() {
        // FastID returns EPC and TID concatenated; the tail is serial number.
        assertEquals(Tid.decode("E2801B03"), Tid.decode("E2801B0320001A2B3C4D5E6F"))
    }

    @Test
    fun `a TID without the extended class identifier is refused`() {
        // 0xE0 is a real class identifier and carries no designer ID at all.
        // Decoding it anyway would name a maker out of unrelated bits.
        assertNull(Tid.decode("E0801B03"))
    }

    @Test
    fun `nothing, something short, and something that is not hex are all refused`() {
        assertNull(Tid.decode(null))
        assertNull(Tid.decode(""))
        assertNull(Tid.decode("E2801"))
        assertNull(Tid.decode("E2801G03"))
    }
}
