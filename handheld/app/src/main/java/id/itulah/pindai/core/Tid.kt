package id.itulah.pindai.core

/**
 * What kind of silicon is on the garment.
 *
 * Every Gen2 tag carries a TID bank whose first four bytes name the chip: a
 * class identifier, then a twelve-bit mask-designer ID saying who made it, then
 * a twelve-bit model number saying which part.
 *
 * ```
 * E2 801 170
 * │  │   └── tag model number
 * │  └────── mask designer: 0x801 is Impinj
 * └───────── class identifier, 0xE2 = EPCglobal
 * ```
 *
 * This matters here for one reason. The reader module in this handheld is an
 * Impinj E710 — the firmware string says so. Impinj's Gen2X extensions (Tag
 * Focus, FastID) are a conversation between an Impinj READER and an Impinj TAG;
 * the reader half is settled, and this is how the other half is checked rather
 * than assumed.
 */
object Tid {

    /** Impinj's mask-designer ID, as it appears in the first four TID bytes. */
    const val IMPINJ = 0x801

    data class Chip(val mdid: Int, val tmn: Int) {
        val isImpinj: Boolean get() = mdid == IMPINJ

        /**
         * The maker, when it is one we can name.
         *
         * Only Impinj is claimed. Other mask-designer IDs are real and
         * meaningful, but naming a vendor from a number this code has not been
         * checked against would be a guess printed as a fact.
         */
        val vendor: String get() = if (isImpinj) "Impinj" else "MDID 0x%03X".format(mdid)

        /**
         * The part number, unresolved.
         *
         * Impinj publishes the model table; this app does not carry a copy,
         * because a stale copy would name the wrong chip with total confidence.
         * The raw number is what a person looks up.
         */
        val model: String get() = "TMN 0x%03X".format(tmn)
    }

    /** Read the maker and model out of a TID, or null when it is not one. */
    fun decode(hex: String?): Chip? {
        val value = hex?.trim()?.uppercase() ?: return null
        if (value.length < 8 || !value.all { it.isDigit() || it in 'A'..'F' }) return null
        val bytes = IntArray(4) {
            (Character.digit(value[it * 2], 16) shl 4) or Character.digit(value[it * 2 + 1], 16)
        }
        // 0xE2 is the extended-TID class identifier every modern Gen2 chip uses.
        // 0xE0 exists and carries no designer ID; it is not one we can answer for.
        if (bytes[0] != 0xE2) return null
        val mdid = (bytes[1] shl 4) or (bytes[2] shr 4)
        val tmn = ((bytes[2] and 0x0F) shl 8) or bytes[3]
        return Chip(mdid, tmn)
    }
}
