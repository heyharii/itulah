package id.itulah.kasir.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * The node's contracts, in Kotlin.
 *
 * Hand-written rather than generated, and deliberately partial: this reads the
 * fields a counter uses and ignores the rest, so a field added at the centre
 * does not stop a till from selling. The authority for every shape here is
 * the generated `frontend-contract/src/contract`, which ts-rs writes from the Rust —
 * when the two disagree, that is the one that is right.
 */

/** One product on this shop's shelf, priced. */
data class CatalogRow(
    val skuCode: String,
    val name: String,
    val barcode: String?,
    val unitPriceMinor: Long,
    val basePriceMinor: Long,
    val currency: String,
    val priceSource: String,
    val articleCode: String?,
) {
    /** Marked down: the shelf edge shows both, and so does the basket. */
    val isMarkedDown: Boolean get() = basePriceMinor > unitPriceMinor

    companion object {
        /**
         * The identity endpoint's shape, which is deliberately not the
         * catalogue's.
         *
         * It answers what a thing IS — name, article, barcode — and carries
         * `base_price_minor`, the intake figure. That is **not** the till
         * price, and putting it on a basket line would repeat the exact
         * failure this estate has already paid for twice: a label and a fact
         * both quoting a number the counter never charges. So price is left at
         * zero here and comes from the quote.
         */
        fun fromIdentity(json: JSONObject) = CatalogRow(
            skuCode = json.optString("sku_code"),
            name = json.optString("name"),
            barcode = json.optString("barcode").takeIf { it.isNotBlank() && it != "null" },
            unitPriceMinor = 0,
            basePriceMinor = 0,
            currency = "IDR",
            priceSource = "IDENTITY",
            articleCode = json.optString("article_code").takeIf { it.isNotBlank() && it != "null" },
        )

        fun from(json: JSONObject) = CatalogRow(
            skuCode = json.optString("sku_code"),
            name = json.optString("name"),
            barcode = json.optString("barcode").takeIf { it.isNotBlank() && it != "null" },
            unitPriceMinor = json.optLong("unit_price_minor"),
            basePriceMinor = json.optLong("base_unit_price_minor"),
            currency = json.optString("currency").ifBlank { "IDR" },
            priceSource = json.optString("price_source"),
            articleCode = json.optString("article_code").takeIf { it.isNotBlank() && it != "null" },
        )
    }
}

/** What one unit costs at the counter, and on what authority. */
data class QuotedLine(
    val skuCode: String,
    val basePriceMinor: Long,
    val unitPriceMinor: Long,
    val lineTotalMinor: Long,
    val priceSource: String,
) {
    companion object {
        fun from(json: JSONObject) = QuotedLine(
            skuCode = json.optString("sku_code"),
            basePriceMinor = json.optLong("base_unit_price_minor"),
            unitPriceMinor = json.optLong("unit_price_minor"),
            lineTotalMinor = json.optLong("line_total_minor"),
            priceSource = json.optString("price_source"),
        )
    }
}

/** A promotion that applied, or did not, and why. */
data class Promotion(
    val name: String,
    val applied: Boolean,
    val benefitMinor: Long,
    val reason: String?,
) {
    companion object {
        fun from(json: JSONObject) = Promotion(
            name = json.optString("name"),
            applied = json.optBoolean("applied"),
            benefitMinor = json.optLong("benefit_minor"),
            reason = json.optString("reason").takeIf { it.isNotBlank() && it != "null" },
        )
    }
}

/**
 * Everything the counter needs to ring up a basket.
 *
 * `hasPriceBook` false is the node saying it has no published book for these
 * goods. Said plainly rather than returned as a basket worth nothing: the till
 * would otherwise be the only screen in the shop that disagreed with the drawer.
 */
data class Quote(
    val traceId: String,
    val lines: List<QuotedLine>,
    val promotions: List<Promotion>,
    val discountMinor: Long,
    val totalMinor: Long,
    val pointsEarned: Long,
    val hasPriceBook: Boolean,
) {
    companion object {
        val EMPTY = Quote("", emptyList(), emptyList(), 0, 0, 0, true)

        fun from(json: JSONObject): Quote {
            if (json.has("has_price_book") && !json.optBoolean("has_price_book")) {
                return EMPTY.copy(hasPriceBook = false)
            }
            return Quote(
                traceId = json.optString("trace_id"),
                lines = json.optJSONArray("lines").list { QuotedLine.from(it) },
                promotions = json.optJSONArray("promotions").list { Promotion.from(it) },
                discountMinor = json.optLong("discount_total_minor"),
                totalMinor = json.optLong("total_minor"),
                pointsEarned = json.optLong("points_earned"),
                hasPriceBook = true,
            )
        }
    }
}

/** How the shopper paid, in the order it was taken. */
data class Tender(val method: String, val amountMinor: Long, val reference: String? = null) {
    fun json(): JSONObject = JSONObject()
        .put("method", method)
        .put("amount_minor", amountMinor)
        .put("reference", reference ?: JSONObject.NULL)

    companion object {
        /** The five the node accepts. Voucher settles a liability rather than
         *  taking money, and only cash can produce change. */
        val METHODS = listOf("CASH", "CARD", "QRIS", "VOUCHER", "OTHER")
    }
}

data class SaleResult(
    val saleId: String,
    val totalMinor: Long,
    val paidMinor: Long,
    val changeMinor: Long,
    val pointsEarned: Long,
    val promotions: List<Promotion>,
) {
    companion object {
        fun from(json: JSONObject) = SaleResult(
            saleId = json.optString("sale_id"),
            totalMinor = json.optLong("total_minor"),
            paidMinor = json.optLong("paid_minor"),
            changeMinor = json.optLong("change_minor"),
            pointsEarned = json.optLong("points_earned"),
            promotions = json.optJSONArray("promotions").list { Promotion.from(it) },
        )
    }
}

/** A second pair of eyes. Checked at the node, never held here. */
data class Supervisor(val username: String, val password: String) {
    fun json(): JSONObject = JSONObject().put("username", username).put("password", password)
}

/**
 * One garment coming home.
 *
 * `disposition`, not "condition" — the field name is the node's, and the two
 * values decide where the unit lands rather than describing how it looks:
 * `RESALEABLE` puts it back on the floor, `DAMAGED` sends it to the reject
 * pool. Anything not fit to sell must not reach the rail by default.
 */
data class ReturnLine(val epc: String, val disposition: String) {
    fun json(): JSONObject = JSONObject().put("epc", epc).put("disposition", disposition)

    companion object {
        const val RESALEABLE = "RESALEABLE"
        const val DAMAGED = "DAMAGED"
    }
}

data class CashMovement(val kind: String, val amountMinor: Long, val reason: String) {
    companion object {
        fun from(json: JSONObject) = CashMovement(
            kind = json.optString("kind"),
            amountMinor = json.optLong("amount_minor"),
            reason = json.optString("reason"),
        )
    }
}

data class TenderTotal(val method: String, val amountMinor: Long, val count: Long) {
    companion object {
        fun from(json: JSONObject) = TenderTotal(
            method = json.optString("method"),
            amountMinor = json.optLong("amount_minor"),
            count = json.optLong("count"),
        )
    }
}

/**
 * The Z report — one shift, closed or still running.
 *
 * Cash and non-cash are separate because only cash is in the drawer. A report
 * that added card takings to the expected float would show a shortage every
 * single evening, for exactly the card takings.
 */
data class ShiftReport(
    val shiftId: String,
    val terminalId: String,
    val status: String,
    val openedBy: String,
    val openingFloatMinor: Long,
    val saleCount: Long,
    val salesTotalMinor: Long,
    val voidedCount: Long,
    val cashSalesMinor: Long,
    val nonCashMinor: Long,
    val changeGivenMinor: Long,
    val cashRefundsMinor: Long,
    val cashMovementsMinor: Long,
    val expectedCashMinor: Long,
    val declaredCashMinor: Long?,
    val varianceMinor: Long?,
    val movements: List<CashMovement>,
    val tenders: List<TenderTotal>,
    /**
     * True when the node withheld the drawer's figures because a cashier is
     * signed in — the close is blind (`http.rs::blind_for_cashier`). The
     * withheld fields then parse as 0 and must not be shown.
     */
    val blind: Boolean,
) {
    val isOpen: Boolean get() = status.equals("OPEN", ignoreCase = true)

    companion object {
        fun from(json: JSONObject) = ShiftReport(
            shiftId = json.optString("shift_id"),
            terminalId = json.optString("terminal_id"),
            status = json.optString("status"),
            openedBy = json.optString("opened_by"),
            openingFloatMinor = json.optLong("opening_float_minor"),
            saleCount = json.optLong("sale_count"),
            salesTotalMinor = json.optLong("sales_total_minor"),
            voidedCount = json.optLong("voided_count"),
            cashSalesMinor = json.optLong("cash_sales_minor"),
            nonCashMinor = json.optLong("non_cash_minor"),
            changeGivenMinor = json.optLong("change_given_minor"),
            cashRefundsMinor = json.optLong("cash_refunds_minor"),
            cashMovementsMinor = json.optLong("cash_movements_minor"),
            expectedCashMinor = json.optLong("expected_cash_minor"),
            declaredCashMinor = if (json.isNull("declared_cash_minor")) null else json.optLong("declared_cash_minor"),
            varianceMinor = if (json.isNull("variance_minor")) null else json.optLong("variance_minor"),
            movements = json.optJSONArray("movements").list { CashMovement.from(it) },
            tenders = json.optJSONArray("tenders").list { TenderTotal.from(it) },
            blind = json.optBoolean("blind", false),
        )
    }
}

data class ReceiptLine(
    val name: String,
    val skuCode: String,
    val quantity: Long,
    val unitPriceMinor: Long,
    val lineTotalMinor: Long,
    val basePriceMinor: Long?,
) {
    companion object {
        fun from(json: JSONObject) = ReceiptLine(
            name = json.optString("name"),
            skuCode = json.optString("sku_code"),
            quantity = json.optLong("quantity"),
            unitPriceMinor = json.optLong("unit_price_minor"),
            lineTotalMinor = json.optLong("line_total_minor"),
            basePriceMinor = if (json.isNull("base_unit_price_minor")) null else json.optLong("base_unit_price_minor"),
        )
    }
}

/** Everything printed, resolved. The renderer performs no lookups. */
data class ReceiptDocument(
    val shopName: String,
    val receiptNo: String,
    val saleId: String,
    val completedAt: String,
    val cashier: String,
    val lines: List<ReceiptLine>,
    val subtotalMinor: Long,
    val discountMinor: Long,
    val totalMinor: Long,
    val paidMinor: Long,
    val changeMinor: Long,
    val tenders: List<Tender>,
    val stamp: String?,
) {
    companion object {
        fun from(json: JSONObject) = ReceiptDocument(
            shopName = json.optString("shop_name"),
            receiptNo = json.optString("receipt_no"),
            saleId = json.optString("sale_id"),
            completedAt = json.optString("completed_at"),
            cashier = json.optString("cashier"),
            lines = json.optJSONArray("lines").list { ReceiptLine.from(it) },
            subtotalMinor = json.optLong("subtotal_minor"),
            discountMinor = json.optLong("discount_minor"),
            totalMinor = json.optLong("total_minor"),
            paidMinor = json.optLong("paid_minor"),
            changeMinor = json.optLong("change_minor"),
            tenders = json.optJSONArray("tenders").list {
                Tender(
                    it.optString("method"),
                    it.optLong("amount_minor"),
                    it.optString("reference").takeIf { r -> r.isNotBlank() && r != "null" },
                )
            },
            stamp = json.optString("stamp").takeIf { it.isNotBlank() && it != "null" },
        )
    }
}

/** Map a JSON array that may be absent. Absent and empty mean the same here. */
private inline fun <T> JSONArray?.list(read: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optJSONObject(index)?.let(read) }
}
