package id.itulah.pindai.core

/** Inventory controls only. RF timing/encoding is supplied by the module's link profile. */
data class InventoryControls(
    val selectTarget: Int,
    val selectAction: Int,
    val selectTruncate: Int,
    val q: Int,
    val startQ: Int,
    val minQ: Int,
    val maxQ: Int,
    val querySel: Int,
    val session: Int,
    val target: Int,
)

/** Values actually returned by the module, including negative values for unread settings. */
data class RadioReadback(
    val power: Int,
    val link: Int,
    val tagFocus: Int,
    val fastId: Int,
    val inventory: InventoryControls,
    val fastInventory: Int = -1,
)

/**
 * Repeatable counts, including immediate re-counts. Duplicates are removed by ScanEngine.
 * This deliberately trades repeated air traffic for avoiding S1/TagFocus suppression.
 * Region is commissioned separately; this recipe never writes it or enables experimental modes.
 */
object RadioRecipe {
    const val ID = "c5-conservative-v1"
    const val POWER_DBM = 25
    const val RF_LINK = 1 // Plain Gen2, Miller 4, 250 kHz; the C5's measured link.
    const val SESSION = 0
    const val TARGET = 0
    const val TAG_FOCUS = false
    const val FAST_ID = false

    // A retained Select may alter SL, but must not silence a session's tags.
    // Query Sel=0 ignores SL entirely; no SKU/estate hardware filter is needed to count.
    val inventory = InventoryControls(4, 0, 0, 1, 6, 0, 15, 0, SESSION, TARGET)

    const val GUIDANCE = "Sweep each section slowly from both sides, then check the result. " +
        "Move the reader closer to missed items; do not press tags against the antenna."

    /** Unknown values never pass as an extension being off or a profile being applied. */
    fun mismatches(actual: RadioReadback): List<String> = buildList {
        if (actual.power != POWER_DBM) add("power ${actual.power}, expected $POWER_DBM dBm")
        if (actual.link != RF_LINK) add("link ${actual.link}, expected $RF_LINK")
        if (actual.tagFocus != 0) add("TagFocus ${actual.tagFocus}, expected off")
        if (actual.fastId != 0) add("FastID ${actual.fastId}, expected off")
        if (actual.fastInventory != 0) add("Fast Inventory ${actual.fastInventory}, expected off")
        if (actual.inventory != inventory) add("inventory ${actual.inventory}, expected $inventory")
    }

    fun requireApplied(actual: RadioReadback) {
        val different = mismatches(actual)
        check(different.isEmpty()) {
            "Reader profile $ID could not be confirmed (${different.joinToString("; ")}). " +
                "No scan was started."
        }
    }
}
