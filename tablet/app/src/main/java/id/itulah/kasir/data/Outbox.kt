package id.itulah.kasir.data

import android.util.AtomicFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID

/**
 * The outbox for money — `pos-desktop/ui/src/outbox.ts`, in Kotlin.
 *
 * A sale is written down **before** it is sent, and the order is the whole
 * point. A till that posted first and recorded second loses the sale the moment
 * the shop's wifi drops mid-request — and by then the cashier has taken the
 * cash, handed over the garment and started on the next customer. Nothing on
 * the node, nothing on the screen, and a drawer that will not balance.
 *
 * So [enqueue] runs at the instant of confirmation, before anything touches the
 * wire, and sending is a separate job (`TillViewModel.flush`) that can run again
 * in fifteen seconds, after the router is rebooted, or by an app that was killed
 * and reopened overnight.
 *
 * # Four properties, and the lines that exist for them
 *
 * **The idempotency key is minted once, here, and stored with the sale.** Every
 * attempt carries that same one, so the node recognises the second delivery of
 * one sale and returns the first answer instead of ringing it twice. A key
 * minted inside the send would be a new key per attempt, which is precisely the
 * bug idempotency exists to prevent.
 *
 * **A refusal and a silence are different things.** A 4xx is an answer: the node
 * read the sale and said no, and will say the same tomorrow, so the entry is
 * marked refused and the sentence it gave is kept for a person. A transport
 * failure is not an answer — nobody knows whether the sale landed — so the entry
 * stays exactly as it was and the pass stops. 401, 408, 429 and 5xx count as
 * silence: the sale is good and the node, or the session, is not ready for it.
 *
 * **There is no "sending" state and no attempt counter.** An app killed
 * mid-request leaves a row that is simply unsent, which is the truth and is safe
 * to act on: the key makes a second delivery a no-op at the node. Three states,
 * read off two fields — `saleId` set means the node has it, [OutboxEntry.refused]
 * means the node said no, and neither means it is still owed.
 *
 * **Nothing the node has not acknowledged is ever dropped — a refusal
 * included.** A refused sale was paid for. Acknowledged sales age out (the last
 * [KEEP_SENT] stay); nothing else does.
 *
 * # Where it lives
 *
 * One JSON array in the app's private files directory, written through
 * [AtomicFile] (write the new copy, sync, swap), so a kill or a power cut during
 * a save leaves the old queue or the new one and never half of each. A write
 * that fails is not swallowed: [OutboxView.storageProblem] carries it to the
 * screen until a later write succeeds. The queue still works from memory for the
 * rest of the session — losing durability is bad, and refusing to sell in front
 * of a customer is worse — but nobody is allowed to not know.
 *
 * A file that cannot be read is moved aside, never overwritten, and says so on
 * screen. A single row this build cannot read is carried through every later
 * save untouched and kept out of the queue where nothing can send it: it is
 * either a sale some other build wrote, which must not be erased, or rubbish.
 */
class Outbox(private val file: File) {

    private val lock = Any()
    private var queue: List<OutboxEntry> = emptyList()
    private var salvage: List<Any> = emptyList()

    /** The last save failed; cleared by the next that works. */
    private var writeProblem: String? = null

    /** The file could not be read at start; stays for the life of the process. */
    private var loadProblem: String? = null

    private val flow = MutableStateFlow(OutboxView())

    /** Oldest first — the order they were rung, and the order they are sent in. */
    val view: StateFlow<OutboxView> = flow.asStateFlow()

    init {
        synchronized(lock) {
            load()
            publish()
        }
    }

    /**
     * Commit a sale. Returns the entry once it is on disk — or, with
     * [Enqueued.durable] false, once it is in memory and the disk said no.
     *
     * The key is minted here and nowhere else. Sending is deliberately not
     * started here: enqueue, then flush, is the ordering this whole class is
     * about, and a caller that can see the two steps cannot collapse them back
     * into one.
     */
    fun enqueue(draft: SaleDraft): Enqueued = synchronized(lock) {
        val entry = OutboxEntry(
            localId = UUID.randomUUID().toString(),
            saleId = null,
            idempotencyKey = Api.key(),
            takenAt = java.time.Instant.now().toString(),
            epcs = draft.epcs.toList(),
            tenders = draft.tenders.toList(),
            actorId = draft.actorId,
            couponCodes = draft.couponCodes.toList(),
            customerId = draft.customerId,
            quotedTotalMinor = draft.quotedTotalMinor,
            changeMinor = draft.changeMinor,
            problem = null,
            refused = false,
        )
        queue = queue + entry
        val durable = persist()
        publish()
        Enqueued(entry, durable)
    }

    /** The oldest sale the node has not answered, or null. */
    fun nextOwed(): OutboxEntry? = synchronized(lock) { queue.firstOrNull { it.isOwed } }

    fun entry(localId: String): OutboxEntry? =
        synchronized(lock) { queue.firstOrNull { it.localId == localId } }

    /**
     * The node took it. [saleId] is the node's name for the sale; a 2xx with no
     * name still counts as acceptance ([NO_SALE_ID]), because re-sending a sale
     * the node holds on account of an oddly shaped answer would be a till
     * sending on a loop.
     */
    fun accept(localId: String, saleId: String) = synchronized(lock) {
        edit(localId) { it.copy(saleId = saleId.ifBlank { NO_SALE_ID }, problem = null) }
        ageOut()
        persist()
        publish()
    }

    /** The node read it and said no. Kept, with its sentence, and never retried here. */
    fun refuse(localId: String, words: String) = synchronized(lock) {
        edit(localId) { it.copy(refused = true, problem = words) }
        persist()
        publish()
    }

    /** Nobody answered. Exactly where it was — owed, same key, first in line. */
    fun defer(localId: String, words: String) {
        synchronized(lock) {
            // The same sentence as last time (a node that stays down says the
            // same thing every 15 s) is not worth a write.
            if (queue.firstOrNull { it.localId == localId }?.problem != words) {
                edit(localId) { it.copy(problem = words) }
                persist()
                publish()
            }
        }
    }

    // ── inside ──────────────────────────────────────────────────────────

    private fun edit(localId: String, change: (OutboxEntry) -> OutboxEntry) {
        queue = queue.map { if (it.localId == localId) change(it) else it }
    }

    /**
     * Let acknowledged sales age out, and nothing else. The node has these; the
     * queue keeps the last few only so the minutes just gone can still be read
     * back at the counter. Owed and refused rows are never touched here.
     */
    private fun ageOut() {
        val done = queue.filter { it.saleId != null }
        if (done.size <= KEEP_SENT) return
        val going = done.take(done.size - KEEP_SENT).map { it.localId }.toSet()
        queue = queue.filterNot { it.localId in going }
    }

    private fun publish() {
        var unsent = 0
        var refused = 0
        for (one in queue) {
            if (one.refused) refused += 1 else if (one.saleId == null) unsent += 1
        }
        flow.value = OutboxView(queue, unsent, refused, writeProblem ?: loadProblem)
    }

    /**
     * Put the queue on disk. True when it is there; false when it is not, with
     * the reason in [writeProblem] for the screen.
     */
    private fun persist(): Boolean {
        try {
            val rows = JSONArray()
            queue.forEach { rows.put(it.json()) }
            salvage.forEach { rows.put(it) }
            val bytes = rows.toString().toByteArray(Charsets.UTF_8)
            val atomic = AtomicFile(file)
            val out = atomic.startWrite()
            try {
                out.write(bytes)
            } catch (e: Exception) {
                atomic.failWrite(out)
                throw e
            }
            atomic.finishWrite(out)
            writeProblem = null
            return true
        } catch (e: Exception) {
            writeProblem = "Kasir tidak bisa menyimpan penjualan ke penyimpanannya " +
                "(${e.message ?: e.javaClass.simpleName}). Penjualan yang menunggu hanya ada " +
                "di memori — jangan matikan atau tutup aplikasi sampai terkirim."
            return false
        }
    }

    /**
     * Read the queue back. Storage that cannot be read is not a reason to refuse
     * to open the till — a counter that crashes on boot over one bad row cannot
     * trade at all, which is strictly worse than one that has forgotten
     * something — but neither is it a reason to erase what is there.
     */
    private fun load() {
        val bytes = try {
            AtomicFile(file).readFully()
        } catch (e: FileNotFoundException) {
            return
        } catch (e: Exception) {
            setAside("tidak terbaca (${e.message ?: e.javaClass.simpleName})")
            return
        }
        val rows = try {
            JSONArray(String(bytes, Charsets.UTF_8))
        } catch (e: Exception) {
            setAside("rusak")
            return
        }
        val kept = ArrayList<OutboxEntry>()
        val odd = ArrayList<Any>()
        for (index in 0 until rows.length()) {
            val row = rows.opt(index) ?: continue
            val entry = (row as? JSONObject)?.let { OutboxEntry.revive(it) }
            if (entry == null) odd.add(row) else kept.add(entry)
        }
        queue = kept
        salvage = odd
    }

    private fun setAside(why: String) {
        val aside = File(file.parentFile, file.name + ".rusak-" + System.currentTimeMillis())
        val moved = runCatching { file.renameTo(aside) }.getOrDefault(false)
        loadProblem = "Antrean penjualan di kasir ini $why, " +
            (if (moved) "sudah disisihkan ke ${aside.name}" else "dan tidak bisa disisihkan") +
            ". Hubungi teknisi sebelum menutup shift."
    }

    private companion object {
        /**
         * How many acknowledged sales to keep. Enough to still hold the one before
         * last when a customer walks back to the counter — not the day's trade,
         * which is a report and belongs to the node.
         */
        const val KEEP_SENT = 25
    }
}

/** What the node calls a sale it took but did not name. Never a real id. */
const val NO_SALE_ID = "—"

/** An unknown time is shown as an impossible one rather than as now. */
private const val EPOCH = "1970-01-01T00:00:00Z"

/** What a cashier confirms. */
data class SaleDraft(
    val epcs: List<String>,
    val tenders: List<Tender>,
    val actorId: String,
    val couponCodes: List<String> = emptyList(),
    val customerId: String? = null,
    /** What the screen told the customer before the node answered. */
    val quotedTotalMinor: Long,
    /** Cash to hand back, as the payment dialog worked it out. The node's own
     *  figure replaces it on the receipt; this is for the moment before. */
    val changeMinor: Long,
)

/** A sale just written down. [durable] false: it is in memory only. */
data class Enqueued(val entry: OutboxEntry, val durable: Boolean)

/** The queue, as the screens read it. */
data class OutboxView(
    val entries: List<OutboxEntry> = emptyList(),
    /** Sales the node has not acknowledged and has not refused: still owed. */
    val unsent: Int = 0,
    /** Sales the node refused: waiting on a person, never sent again here. */
    val refused: Int = 0,
    /** The disk, when it is not keeping the queue. Shown until it is. */
    val storageProblem: String? = null,
) {
    /** Owed and refused together — what must be nil before a shift closes. */
    val unacknowledged: Int get() = unsent + refused
}

/**
 * One sale, as this tablet wrote it down.
 *
 * Immutable, and replaced rather than edited: the outbox publishes a new list
 * on every change, so a screen holding an old entry is holding a true record of
 * an earlier moment and never a half-updated one.
 */
data class OutboxEntry(
    /** This row's name, minted here. A row can be forgotten and a rung sale
     *  cannot, so the two never share an identifier. */
    val localId: String,
    /** The node's name for it, once the node has accepted it — the only
     *  evidence here that a sale actually landed. */
    val saleId: String?,
    /** Minted once, at enqueue, and never again for this sale. */
    val idempotencyKey: String,
    /** When the cashier confirmed, which is when the money changed hands. Not
     *  when it was sent, which may be tomorrow morning. UTC, ISO 8601. */
    val takenAt: String,
    val epcs: List<String>,
    val tenders: List<Tender>,
    val actorId: String,
    val couponCodes: List<String>,
    val customerId: String?,
    val quotedTotalMinor: Long,
    val changeMinor: Long,
    /** The last thing that went wrong, in the node's own words where it gave any. */
    val problem: String?,
    val refused: Boolean,
) {
    val isOwed: Boolean get() = saleId == null && !refused

    fun json(): JSONObject = JSONObject()
        .put("local_id", localId)
        .put("sale_id", saleId ?: JSONObject.NULL)
        .put("idempotency_key", idempotencyKey)
        .put("taken_at", takenAt)
        .put("epcs", JSONArray(epcs))
        .put("tenders", JSONArray().apply { tenders.forEach { put(it.json()) } })
        .put("actor_id", actorId)
        .put("coupon_codes", JSONArray(couponCodes))
        .put("customer_id", customerId ?: JSONObject.NULL)
        .put("quoted_total_minor", quotedTotalMinor)
        .put("change_minor", changeMinor)
        .put("problem", problem ?: JSONObject.NULL)
        .put("refused", refused)

    companion object {
        /**
         * Read one row back as strictly as it must be read, and no more.
         *
         * The must-haves are what the sale cannot be sent or named without: its
         * two identifiers, its actor, its tags, its tenders. Everything else gets
         * a default, because a row written by a slightly different build is still
         * money and refusing it would be the one failure this file exists to
         * prevent.
         */
        fun revive(row: JSONObject): OutboxEntry? {
            val localId = row.text("local_id") ?: return null
            val key = row.text("idempotency_key") ?: return null
            val actor = row.text("actor_id") ?: return null
            val epcs = row.optJSONArray("epcs")?.texts() ?: return null
            val tenderRows = row.optJSONArray("tenders") ?: return null
            val tenders = ArrayList<Tender>(tenderRows.length())
            for (index in 0 until tenderRows.length()) {
                val one = tenderRows.optJSONObject(index)?.let { Tender.from(it) } ?: return null
                tenders.add(one)
            }
            return OutboxEntry(
                localId = localId,
                saleId = row.text("sale_id"),
                idempotencyKey = key,
                takenAt = row.text("taken_at") ?: EPOCH,
                epcs = epcs,
                tenders = tenders,
                actorId = actor,
                couponCodes = row.optJSONArray("coupon_codes")?.texts() ?: emptyList(),
                customerId = row.text("customer_id"),
                quotedTotalMinor = row.optLong("quoted_total_minor"),
                changeMinor = row.optLong("change_minor"),
                problem = row.text("problem"),
                refused = row.optBoolean("refused", false),
            )
        }

        /** A string only if it is one: JSON null is not "null". */
        private fun JSONObject.text(key: String): String? = opt(key) as? String

        private fun JSONArray.texts(): List<String>? {
            val out = ArrayList<String>(length())
            for (index in 0 until length()) out.add(opt(index) as? String ?: return null)
            return out
        }
    }
}
