package id.itulah.pindai.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The other way a garment identifies itself.
 *
 * When the RFID tag is missing, unreadable or was never applied, the imager
 * reads the printed label instead — and whatever it hands back has to turn into
 * the same eleven digits an EPC decodes to, or the two paths count different
 * things and nobody can tell which total is real.
 */
class LabelTest {

    @Test
    fun `the QR form carries the SKU behind a prefix`() {
        assertEquals("12345678123", Label.toSku("R1:12345678123"))
    }

    @Test
    fun `the printed barcode carries a leading 8 that is not part of the SKU`() {
        // Twelve characters in, eleven out. The 8 is the symbology's, not ours.
        assertEquals("12345678123", Label.toSku("812345678123"))
    }

    @Test
    fun `a bare SKU is already the answer`() {
        assertEquals("12345678123", Label.toSku("12345678123"))
    }

    @Test
    fun `an eleven digit code starting with 8 is a SKU, not a prefixed one`() {
        // The prefix rule is guarded by LENGTH for exactly this case. Strip a
        // leading 8 from an eleven-digit SKU and the scan silently becomes a
        // different garment — one that may well exist.
        assertEquals("81234567812", Label.toSku("81234567812"))
    }

    @Test
    fun `surrounding whitespace is the scanner's, not the label's`() {
        assertEquals("12345678123", Label.toSku("  12345678123\n"))
    }

    @Test
    fun `anything that is not eleven digits is refused`() {
        assertNull(Label.toSku("1234567812"))
        assertNull(Label.toSku("123456781234"))
        assertNull(Label.toSku("1234567812A"))
        assertNull(Label.toSku("R1:1234567812A"))
        assertNull(Label.toSku(""))
    }

    @Test
    fun `a price barcode from another system is refused rather than guessed at`() {
        // A shop floor has barcodes on it that are not ours. Returning null is
        // how one of them becomes "unknown" instead of becoming a wrong SKU.
        assertNull(Label.toSku("8991234567890"))
    }
}
