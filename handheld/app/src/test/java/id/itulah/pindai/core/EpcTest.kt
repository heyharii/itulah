package id.itulah.pindai.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The codec, against the vectors the rest of the estate already speaks.
 *
 * If any assertion here stops holding, tags written in the warehouse stop
 * resolving on the sales floor — and the symptom is not "encoding bug", it is
 * stock going missing.
 */
class EpcTest {

    @Test
    fun `the golden vector decodes to what the centre encoded`() {
        // Lifted from backend/src/cloud/domain/identity.rs, where the same
        // vector guards the encoder: encode_epc("12345678123", 100).
        val parts = Epc.decode("A11234567812300000000064")
        assertEquals("12345678123", parts?.skuCode)
        assertEquals(100L, parts?.serial)
    }

    @Test
    fun `case is a rendering choice, not part of the value`() {
        assertEquals(
            Epc.decode("A11234567812300000000064"),
            Epc.decode("a11234567812300000000064"),
        )
    }

    @Test
    fun `an article is the first eight digits of a SKU`() {
        // The whole reason a sweep can count articles with the wifi off.
        val parts = Epc.decode("A11234567812300000000064")!!
        assertEquals("12345678", parts.skuCode.take(8))
        assertEquals("1", parts.skuCode.substring(8, 9))
        assertEquals("23", parts.skuCode.substring(9, 11))
    }

    @Test
    fun `a GS1 SGTIN is foreign, not ours`() {
        // 0x30 is an SGTIN-96 header. A reader that mistook one for ours would
        // read a competitor's stock into our count.
        assertNull(Epc.decode("301234567812300000000064"))
        assertFalse(Epc.isOurs("301234567812300000000064"))
    }

    @Test
    fun `a serial at the top of the field survives the round trip`() {
        // 2^44 - 1, the largest serial the format can carry.
        val parts = Epc.decode("A112345678123FFFFFFFFFFF")
        assertEquals("12345678123", parts?.skuCode)
        assertEquals((1L shl 44) - 1, parts?.serial)
    }

    @Test
    fun `a hex digit where a decimal digit belongs is a corrupt read`() {
        // BCD only holds 0-9. An 0xA in the SKU field means the bits are wrong,
        // and half-decoding it would invent a product.
        assertNull(Epc.decode("A1A234567812300000000064"))
    }

    @Test
    fun `malformed input is refused rather than guessed at`() {
        assertNull(Epc.decode(""))
        assertNull(Epc.decode("A1123456781230000000006"))   // 23 characters
        assertNull(Epc.decode("A112345678123000000000640")) // 25 characters
        assertNull(Epc.decode("A1123456781230000000006Z"))  // not hex
        assertNull(Epc.decode("                        "))
    }

    @Test
    fun `decode never throws, whatever it is handed`() {
        listOf("", "zz", "null", "A0", "-1", "A0".repeat(40)).forEach {
            Epc.decode(it) // must not throw
        }
        assertTrue(true)
    }
}
