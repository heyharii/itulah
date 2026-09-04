package id.itulah.kasir.core

/**
 * The retail-private EPC-96 this estate already speaks: header `0xA0`, the 11
 * SKU digits as BCD, then a 44-bit serial.
 *
 * The handheld DECODES only. Minting an EPC is the centre's job and stays there —
 * a second encoder in the field is the drift this format has already paid for
 * once. Reading one back tells the operator *what* they are holding, which is
 * all a sweep needs.
 */
object Epc {
    private const val HEADER = 0xA0

    data class Parts(val skuCode: String, val serial: Long)

    fun decode(hex: String): Parts? {
        val value = hex.trim().uppercase()
        if (value.length != 24 || !value.all { it.isDigit() || it in 'A'..'F' }) return null
        val bytes = ByteArray(12) { i ->
            ((Character.digit(value[i * 2], 16) shl 4) or Character.digit(value[i * 2 + 1], 16)).toByte()
        }
        if ((bytes[0].toInt() and 0xFF) != HEADER) return null
        val digits = StringBuilder()
        for (i in 1..5) {
            val b = bytes[i].toInt() and 0xFF
            digits.append(b shr 4).append(b and 0x0F)
        }
        digits.append((bytes[6].toInt() and 0xFF) shr 4)
        if (digits.any { it !in '0'..'9' }) return null
        var serial = ((bytes[6].toLong() and 0x0F) shl 40)
        serial = serial or ((bytes[7].toLong() and 0xFF) shl 32)
        serial = serial or ((bytes[8].toLong() and 0xFF) shl 24)
        serial = serial or ((bytes[9].toLong() and 0xFF) shl 16)
        serial = serial or ((bytes[10].toLong() and 0xFF) shl 8)
        serial = serial or (bytes[11].toLong() and 0xFF)
        return Parts(digits.toString(), serial)
    }

    /** True when a tag is ours rather than a factory EPC or somebody else's GS1. */
    fun isOurs(hex: String) = decode(hex) != null
}
