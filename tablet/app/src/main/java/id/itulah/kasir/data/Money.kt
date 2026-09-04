package id.itulah.kasir.data

/**
 * Money, as a counter reads it.
 *
 * Everything on the wire is minor units — rupiah has no subdivision in
 * practice, but the contract carries `_minor` because the estate also has to be
 * able to price in currencies that do, and a till that quietly assumed
 * otherwise would be wrong exactly once, expensively.
 *
 * No `NumberFormat`: the locale on a tablet is whatever the last person set,
 * and a receipt that groups with commas in one shop and dots in another is a
 * receipt somebody has to explain.
 */
object Money {
    fun format(minor: Long, currency: String = "IDR"): String {
        val prefix = if (currency == "IDR") "Rp " else "$currency "
        return prefix + grouped(minor)
    }

    fun grouped(minor: Long): String {
        val negative = minor < 0
        val digits = kotlin.math.abs(minor).toString()
        val out = StringBuilder()
        for ((index, ch) in digits.withIndex()) {
            if (index > 0 && (digits.length - index) % 3 == 0) out.append('.')
            out.append(ch)
        }
        return if (negative) "−$out" else out.toString()
    }

    /** What a cashier typed into a cash field, as minor units. Blank is zero. */
    fun parse(text: String): Long =
        text.filter { it.isDigit() }.takeIf { it.isNotEmpty() }?.toLongOrNull() ?: 0L
}

/**
 * Wire time, as a shop reads it.
 *
 * The node stamps every fact in UTC because a fact belongs to one instant
 * everywhere. A receipt does not: the till stands in the shop, so its clock is
 * the shop's clock. Printing `2026-09-04T14:28:07.191265Z` at half past nine in
 * the evening is a receipt nobody can match to a transaction they remember —
 * and the ESC/POS renderer at the node already knows this, so the screen was
 * the only place still saying the wrong hour.
 */
object WhenIt {
    private val WIRE = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.ROOT)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
    private val SHOWN = java.text.SimpleDateFormat("d MMM yyyy · HH:mm", java.util.Locale("id", "ID"))

    fun local(wire: String): String {
        val trimmed = wire.substringBefore('.').substringBefore('Z').trim()
        val parsed = runCatching { WIRE.parse(trimmed) }.getOrNull() ?: return wire
        return SHOWN.format(parsed)
    }
}
