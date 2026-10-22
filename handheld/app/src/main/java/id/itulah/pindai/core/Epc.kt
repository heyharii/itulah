package id.itulah.pindai.core

/**
 * The retail-private EPC-96 this estate already speaks: header `0xA1`, the 11
 * SKU digits as BCD, then a 44-bit serial.
 *
 * The handheld DECODES only. Minting an EPC is the centre's job and stays there —
 * a second encoder in the field is the drift this format has already paid for
 * once. Reading one back tells the operator *what* they are holding, which is
 * all a sweep needs.
 */
object Epc {
    private const val HEADER = 0xA1

    data class Parts(val skuCode: String, val serial: Long)

    fun decode(hex: String): Parts? {
        val value = hex.trim().uppercase()
        if (value.length != 24 || !value.all { it.isDigit() || it in 'A'..'F' }) return null
        val bytes = ByteArray(12) { i ->
            ((Character.digit(value[i * 2], 16) shl 4) or Character.digit(value[i * 2 + 1], 16)).toByte()
        }
        if ((bytes[0].toInt() and 0xFF) != HEADER) return null
        // Every nibble is checked BEFORE it becomes a character, not after.
        //
        // This used to build the digits with `StringBuilder.append(Int)` and
        // then look for a non-decimal character in the result — which can never
        // find one. Appending an Int writes it in decimal, so a corrupt nibble
        // of 0xA arrived as the two characters "10" and the guard saw nothing
        // wrong. The SKU came out twelve digits long and belonged to no product
        // on earth, and a corrupt read became a phantom line on a stock count
        // instead of a tag that is not ours. The centre's decoder rejects these
        // (`identity.rs`); this one now agrees with it.
        val digits = CharArray(11)
        var at = 0
        for (i in 1..5) {
            val b = bytes[i].toInt() and 0xFF
            val high = b shr 4
            val low = b and 0x0F
            if (high > 9 || low > 9) return null
            digits[at++] = '0' + high
            digits[at++] = '0' + low
        }
        val last = (bytes[6].toInt() and 0xFF) shr 4
        if (last > 9) return null
        digits[at] = '0' + last
        var serial = ((bytes[6].toLong() and 0x0F) shl 40)
        serial = serial or ((bytes[7].toLong() and 0xFF) shl 32)
        serial = serial or ((bytes[8].toLong() and 0xFF) shl 24)
        serial = serial or ((bytes[9].toLong() and 0xFF) shl 16)
        serial = serial or ((bytes[10].toLong() and 0xFF) shl 8)
        serial = serial or (bytes[11].toLong() and 0xFF)
        return Parts(String(digits), serial)
    }

    /** True when a tag is ours rather than a factory EPC or somebody else's GS1. */
    fun isOurs(hex: String) = decode(hex) != null
}

/**
 * A SKU, as a person reads it: the 8-digit article, a middle dot, then colour
 * and size — `00000004103` reads `00000004·103`. Display only; the EPC, the
 * wire and every lookup keep the plain 11 digits.
 */
fun skuDisplay(code: String): String =
    if (code.length == 11 && code.all { it in '0'..'9' }) code.take(8) + "·" + code.drop(8) else code
