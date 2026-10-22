package id.itulah.pindai.core

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** One new tag on its way from the radio to the worker. */
private class TagEvent(
    @JvmField val epc: String,
    @JvmField val rssi: String?,
    @JvmField val tid: String?,
)

/** What the scanning screen draws. Immutable; the UI never computes over it. */
data class ScanCounts(
    val units: Int = 0,
    val skus: Int = 0,
    val articles: Int = 0,
    val unknown: Int = 0,
    val foreign: Int = 0,
    val unexpected: Int = 0,
    /** Units added by reading a printed label rather than a tag. */
    val labelled: Int = 0,
    /** Tags of ours whose SKU this handheld has never heard of. Not counted. */
    val unknownUnits: Int = 0,
    /**
     * Every distinct tag the radio found, ours or not.
     *
     * The operator's total is products, and that is right for counting stock.
     * But when the question is about the RADIO — does Tag Focus lose tags, how
     * long does a tag stay quiet, does a filter narrow anything — products are
     * the wrong unit entirely: a tag carrying somebody else's EPC is still a
     * tag the reader did or did not hear. This is the number those experiments
     * are about.
     */
    val distinctTags: Int = 0,
    /**
     * Reads the radio returned that cannot be a tag at all.
     *
     * An EPC is 96 bits — twenty-four hex characters. A read that comes back
     * eight characters long, or with a non-hex byte in it, is a failed read,
     * not a transponder. Counting those as tags is how a distinct-tag total
     * creeps upward the longer a sweep runs, and how a corrupted stream can
     * report two and a half thousand tags in a room holding forty.
     */
    val malformed: Int = 0,
    val expected: Int = 0,
    val matchedExpected: Int = 0,
    val elapsedMs: Long = 0,
)

/** How the pipeline itself is coping. Development instrumentation, §27. */
data class ScanMetrics(
    val sightings: Long = 0,
    val duplicates: Long = 0,
    val dropped: Long = 0,
    val queueDepth: Int = 0,
    val processedNanos: Long = 0,
    val processed: Long = 0,
) {
    /** Reads that were a tag we already had. The number that justifies the design. */
    val dedupRatio: Double get() = if (sightings == 0L) 0.0 else duplicates.toDouble() / sightings
    val meanProcessMicros: Double get() = if (processed == 0L) 0.0 else processedNanos / processed / 1000.0
}

/**
 * How long a tag stayed quiet between two reads of itself.
 *
 * # Why a duplicate ratio cannot answer the Tag Focus question
 *
 * Tag Focus does not stop a tag being read; it makes the tag hold its
 * inventoried flag so it does not ANSWER for a while. What changes is the GAP
 * between one read of a garment and the next read of that same garment. A
 * duplicate ratio flattens all of that into one number and hides it — two
 * readers with identical ratios can be behaving completely differently, one
 * re-reading every tag every 20 ms and the other every two seconds.
 *
 * So the gaps are measured directly, per EPC, and the distribution is the
 * evidence.
 */
data class ReadGaps(
    val samples: Long = 0,
    val meanMs: Double = 0.0,
    val maxMs: Long = 0,
    /** Gaps long enough that the tag was plausibly being held silent. */
    val over500ms: Long = 0,
)

/** One product line of a finished sweep. */
data class ScanLine(val skuCode: String, val qty: Int, val epcs: List<String>)

/**
 * Everything between the antenna and the screen.
 *
 * # The shape, and why dedup sits where it does
 *
 * ```
 * reader poll thread ──probe──> [bounded ring] ──> worker ──> immutable snapshot
 * ```
 *
 * The brief this was built to says the hardware callback should enqueue and
 * nothing else. It does slightly less than that: it probes a set first, and
 * only a tag we have never seen reaches the queue.
 *
 * That is not a shortcut, it is the point. A garment is read dozens of times as
 * an operator walks past it — duplicates are the overwhelming majority of every
 * sweep. A hash-set probe on a string is tens of nanoseconds and allocates
 * nothing; an enqueue is more work and, at a thousand events a second, a
 * thousand objects a second for tags that are already counted. Filtering before
 * the queue means the queue only ever carries real work, and the callback still
 * does the least possible before returning, which is what the rule is for.
 *
 * # The queue is bounded, and a full queue is a fact we report
 *
 * If the worker ever falls behind, tags are dropped and counted rather than
 * allowed to eat the heap. A non-zero [ScanMetrics.dropped] is a bug to chase,
 * not a condition to tolerate — but a bounded queue turns it into a number
 * somebody can see instead of an OutOfMemoryError forty minutes into a count.
 */
class ScanEngine {

    // ------------------------------------------------- shared with the radio
    private val seen = java.util.concurrent.ConcurrentHashMap.newKeySet<String>(8192)
    private val queue = ArrayBlockingQueue<TagEvent>(CAPACITY)
    private val sightings = AtomicLong()
    private val duplicates = AtomicLong()
    private val dropped = AtomicLong()
    private val malformed = AtomicLong()

    /**
     * When each tag was last heard, and the gaps that fall out of it.
     *
     * On the reader thread, one map write per sighting. At the rates this
     * hardware actually produces — under a hundred a second — that is nothing,
     * and it is the only measurement that can settle what Tag Focus does.
     */
    private val lastHeard = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val gapSamples = AtomicLong()
    private val gapTotalMs = AtomicLong()
    private val gapMaxMs = AtomicLong()
    private val gapOver500 = AtomicLong()
    private val processedNanos = AtomicLong()
    private val processed = AtomicLong()

    /** Worker → spooler. The only state two threads share besides the queue. */
    private val pendingEvidence = ConcurrentLinkedQueue<Pair<String, Float?>>()

    // ------------------------------------------- owned by the worker, alone
    private val epcsBySku = LinkedHashMap<String, ArrayList<String>>()
    private val foreignEpcs = ArrayList<String>()
    private val articles = HashSet<String>()
    private val unknownSkus = HashSet<String>()
    private var unexpectedSkus = HashSet<String>()
    private var labelledUnits = 0
    private var unknownUnits = 0
    private val unknownEpcList = ArrayList<String>()

    /**
     * Units of products this handheld can name.
     *
     * Kept as a running total rather than derived, because it is the number on
     * the screen and it must equal the sum of the lines below it — exactly, at
     * every tick. Deriving it from `seen.size` counted foreign tags as stock:
     * somebody else's pallet label in the next aisle arrived as a unit of ours,
     * and the total stopped matching the list it was a total OF.
     */
    private var knownUnits = 0

    /** The first chip this sweep could identify. They are all the same order. */
    @Volatile private var chip: Tid.Chip? = null

    /**
     * How many DISTINCT tags each kind of silicon accounted for.
     *
     * Keeping only the first chip was enough while the question was "are these
     * Impinj at all". It stopped being enough the moment a Gen2X link mode
     * halved the tag count: the two explanations — Gen2X reaches fewer tags, or
     * Gen2X is only answered by tags that speak it — predict the same total and
     * completely different populations. One vendor histogram separates them.
     *
     * Counted per distinct EPC, not per read, because a loud tag read four
     * hundred times is still one garment.
     */
    private val chipsByVendor = HashMap<String, Int>()
    private val chipSeen = HashSet<String>()

    /**
     * Which EPC belongs to which silicon, kept per tag rather than summed.
     *
     * The histogram can only ever show that two populations are the same SIZE.
     * The question actually being asked — "are the tags a Gen2X link finds the
     * SAME tags a TID says are Impinj" — is about identity, and two sets of
     * equal size can be disjoint. This is what lets one sweep's EPC list be
     * intersected with another's instead of compared by count.
     */
    private val chipByEpc = HashMap<String, String>()

    /**
     * Units of each SKU that came from a label rather than a tag.
     *
     * Kept apart from [epcsBySku] because they are a different kind of fact: a
     * tag names a garment, a label names a product. A line's quantity is the
     * two added together; its EPCs are only ever the first.
     */
    private val labelsBySku = HashMap<String, Int>()

    /**
     * Count every tag as a product, whatever its EPC says.
     *
     * # What this is for, and what it is not
     *
     * A rig being commissioned is full of tags that are ours in silicon and
     * somebody else's in writing — factory EPCs, another system's encoding,
     * leftovers from a different trial. None of them decode to a SKU, so a
     * normal sweep counts them as "not ours" and the product total stays near
     * zero. That makes the app useless as an instrument for testing the RADIO,
     * which is what a rig is for.
     *
     * With this on, a tag that cannot be named becomes a line of its own, keyed
     * by its EPC. One tag, one unit, one row.
     *
     * It is OFF by default and it must stay that way outside a bench. A count
     * taken like this is not a count of stock — it is a count of transponders,
     * and the two differ by every pallet label and security tag in the room.
     * Sweeps taken in this mode are marked, so they can never be read later as
     * if they meant inventory.
     */
    @Volatile var countEveryTag: Boolean = false

    /**
     * Tags married to a product because their EPC is not ours.
     *
     * Held in RAM beside [known] and probed the same way — a HashMap lookup on
     * the worker thread, no database on the scan path. Empty in the field; a
     * bench fills it deliberately.
     */
    @Volatile private var aliases: Map<String, String> = emptyMap()

    @Volatile private var known: Set<String> = emptySet()
    @Volatile private var expected: Set<String>? = null
    @Volatile private var counts = ScanCounts()
    @Volatile private var running = false
    @Volatile private var startedAt = 0L
    private var worker: Thread? = null

    /**
     * The SKUs this handheld can name.
     *
     * Set when the catalogue generation moves, and never during a sweep: a
     * count whose UNKNOWN number changed halfway because a catalogue landed is
     * a count nobody can explain afterwards.
     */
    fun useCatalogue(skuCodes: Set<String>) {
        known = skuCodes
    }

    /**
     * Told about every read, new or repeated, from the reader's own thread.
     *
     * Kept as a bare lambda rather than a [Sounder] so the engine stays free of
     * Android — it is unit-tested on the JVM, and a class that needs an audio
     * service is a class those tests cannot construct.
     */
    @Volatile
    var onHeard: ((isNew: Boolean) -> Unit)? = null

    /**
     * Told when a read became a UNIT somebody can name, and only then.
     *
     * # Why this is separate from [onHeard]
     *
     * [onHeard] fires on "this EPC is one I have not seen", which is the
     * question the radio can answer instantly and the one the bench's
     * every-read instrument is about. It is the wrong question for the
     * operator's ear, and the difference is not academic: a corrupt read
     * arrives as twenty-four valid hex characters that have never been seen
     * before, so it is new every single time. On a desk holding twelve tags
     * that produced an endless chirp beside a count that sat still at twelve —
     * the sound saying "found one" while the screen said "found nothing", for
     * an hour.
     *
     * Foreign tags do the same thing more slowly: somebody else's pallet label
     * is genuinely new, genuinely heard, and genuinely not stock.
     *
     * So the operator's note hangs on the thing the operator is counting. A
     * silence now means the rack is done, which is a fact worth being able to
     * hear.
     */
    @Volatile
    var onCounted: (() -> Unit)? = null

    /** Which tags have been married to which product. See [aliases]. */
    fun useAliases(map: Map<String, String>) {
        aliases = map
    }

    /** What a carton or a delivery said it would contain, for Packing and Receive. */
    fun expect(skuCodes: Set<String>?) {
        expected = skuCodes
    }

    fun snapshot(): ScanCounts = counts

    fun metrics(): ScanMetrics = ScanMetrics(
        sightings = sightings.get(),
        duplicates = duplicates.get(),
        dropped = dropped.get(),
        queueDepth = queue.size,
        processedNanos = processedNanos.get(),
        processed = processed.get(),
    )

    val isRunning: Boolean get() = running

    /**
     * Called from the reader's own thread, many times a second.
     *
     * Returns immediately for a tag already counted, which is most of them.
     */
    fun offer(epc: String, rssi: String?, tid: String? = null) {
        sightings.incrementAndGet()
        // Uppercase before the probe: the module has been seen to answer in
        // either case, and two spellings of one tag is two units of stock that
        // do not exist. Java returns the same instance when nothing changes, so
        // an already-upper EPC costs no allocation here.
        val key = epc.uppercase()
        // A tag is 96 bits. Anything else is a failed read wearing an EPC's
        // clothes, and letting it through inflates every figure downstream.
        if (key.length != EPC_HEX_LEN || !key.all { it.isDigit() || it in 'A'..'F' }) {
            malformed.incrementAndGet()
            return
        }
        val now = System.currentTimeMillis()
        val previous = lastHeard.put(key, now)
        if (previous != null) {
            val gap = now - previous
            gapSamples.incrementAndGet()
            gapTotalMs.addAndGet(gap)
            if (gap > 500) gapOver500.incrementAndGet()
            gapMaxMs.accumulateAndGet(gap) { a, b -> maxOf(a, b) }
        }
        val isNew = seen.add(key)
        // On the reader's thread, deliberately: the point of the every-read
        // mode is to sound the reads the radio actually did, at the moment it
        // did them. Anything downstream of the queue has already been thinned
        // by dedup, which is precisely the information being listened for.
        onHeard?.invoke(isNew)
        if (!isNew) {
            duplicates.incrementAndGet()
            return
        }
        if (!queue.offer(TagEvent(key, rssi, tid))) {
            // Put it back so a later sweep can still find it rather than
            // believing it was counted.
            seen.remove(key)
            dropped.incrementAndGet()
        }
    }

    /** Begin a logical sweep. Clears everything the last one found. */
    fun reset() {
        require(!running) { "reset during a sweep" }
        seen.clear()
        queue.clear()
        pendingEvidence.clear()
        epcsBySku.clear()
        foreignEpcs.clear()
        articles.clear()
        unknownSkus.clear()
        unexpectedSkus = HashSet()
        labelledUnits = 0
        unknownUnits = 0
        unknownEpcList.clear()
        knownUnits = 0
        labelsBySku.clear()
        // The silicon too. A chip identified in the first sweep was surviving
        // into the second and being reported as that sweep's finding — the same
        // accumulating defect, in the one field used to decide whether these
        // tags can speak Gen2X at all.
        chip = null
        chipsByVendor.clear()
        chipSeen.clear()
        chipByEpc.clear()
        sightings.set(0); duplicates.set(0); dropped.set(0); malformed.set(0)
        lastHeard.clear()
        gapSamples.set(0); gapTotalMs.set(0); gapMaxMs.set(0); gapOver500.set(0)
        processedNanos.set(0); processed.set(0)
        // Including the clock. A second sweep whose elapsed time is measured
        // from the first is the same species of accumulating defect that
        // already voided three rounds of Gen2X measurement in this project.
        startedAt = 0L
        counts = ScanCounts()
    }

    fun start() {
        if (running) return
        running = true
        if (startedAt == 0L) startedAt = System.currentTimeMillis()
        worker = Thread {
            while (running) {
                val event = queue.poll(POLL_MS, TimeUnit.MILLISECONDS) ?: continue
                absorb(event)
                // Drain whatever else arrived while we were working, so a burst
                // is one wake-up rather than one per tag.
                while (true) absorb(queue.poll() ?: break)
                recount()
            }
        }.apply { isDaemon = true; name = "scan-worker"; priority = Thread.NORM_PRIORITY + 1; start() }
    }

    /**
     * Stop, and do not return until the queue is empty.
     *
     * The count on screen when the operator lets go of the trigger has to be the
     * count that gets filed. Tags read in the last few milliseconds are still in
     * the ring, and stopping without draining loses exactly the tags somebody
     * was reaching for when they stopped.
     *
     * Synchronized because two callers can arrive at once: a sweep's stop is
     * allowed to finish while the screen is being torn down, and the teardown
     * stops the engine too. Two drains running together would absorb into the
     * worker's maps from two threads; one after the other, the second finds
     * nothing left to do.
     */
    @Synchronized
    fun stop() {
        running = false
        worker?.let { runCatching { it.join(1_000) } }
        worker = null
        while (true) absorb(queue.poll() ?: break)
        recount()
    }

    private fun absorb(event: TagEvent) {
        val began = System.nanoTime()
        if (event.tid != null) {
            val decoded = Tid.decode(event.tid)
            if (chip == null) chip = decoded
            if (chipSeen.add(event.epc)) {
                val name = decoded?.let { "${it.vendor} ${it.model}" } ?: "TID unreadable"
                chipsByVendor[name] = (chipsByVendor[name] ?: 0) + 1
                chipByEpc[event.epc] = name
            }
        }
        val parts = Epc.decode(event.epc)
        // An EPC that is not ours may still have been married to a product on
        // this bench. The marriage is consulted only when the arithmetic fails,
        // so a real tag never pays for it.
        val sku0 = parts?.skuCode ?: aliases[event.epc]
        if (sku0 == null) {
            foreignEpcs.add(event.epc)
        } else {
            val sku = sku0
            if (sku !in known && !countEveryTag) {
                // One of ours, for a product this handheld cannot name.
                //
                // It is NOT counted. A figure an operator is about to write on a
                // count sheet must be a figure of things they can identify; a
                // total that silently includes garments nobody can name is a
                // total that cannot be checked, and it is checked by hand, later,
                // by somebody who was not there.
                //
                // It is not hidden either. The evidence still goes to the Edge —
                // the tag WAS in this pool, and that fact belongs to the ledger
                // whatever the catalogue knows — and the sweep says how many
                // there were, so a stale catalogue announces itself instead of
                // quietly shrinking the count.
                unknownSkus.add(sku)
                unknownEpcList.add(event.epc)
                unknownUnits++
            } else {
                epcsBySku.getOrPut(sku) {
                    // First time this SKU appears in this sweep. Everything that
                    // classifies it happens once, here, and never per unit.
                    articles.add(sku.take(ARTICLE_LEN))
                    expected?.let { if (sku !in it) unexpectedSkus.add(sku) }
                    ArrayList(4)
                }.add(event.epc)
                knownUnits++
                // The operator's note, and the only place it can honestly be
                // struck: a tag that got this far is ours, named, and counted.
                onCounted?.invoke()
            }
        }
        pendingEvidence.add(event.epc to event.rssi?.toFloatOrNull())
        processed.incrementAndGet()
        processedNanos.addAndGet(System.nanoTime() - began)
    }

    /**
     * Add one unit from a printed label.
     *
     * Called on the worker, from the imager's callback, and it is NOT a tag:
     * there is no EPC, so there is no unit identity, so there is nothing to
     * deduplicate against. Two scans of the same shirt count two — and that is
     * the honest answer, because a label cannot tell them apart.
     *
     * Which is why these are counted separately as well as together. The total
     * is what the operator is counting; [ScanCounts.labelled] is how much of it
     * rests on somebody pointing an imager twice, and no observation batch ever
     * carries one of these, because an observation is evidence about a TAG.
     */
    fun offerLabel(sku: String) {
        if (sku !in known) {
            unknownSkus.add(sku)
            unknownUnits++
            recount()
            return
        }
        epcsBySku.getOrPut(sku) {
            articles.add(sku.take(ARTICLE_LEN))
            expected?.let { if (sku !in it) unexpectedSkus.add(sku) }
            ArrayList(4)
        }
        labelsBySku.merge(sku, 1) { a, b -> a + b }
        labelledUnits++
        knownUnits++
        onCounted?.invoke()
        recount()
    }

    private fun recount() {
        // The total is what can be named, and it is exactly the sum of the
        // lines. Foreign tags and unknown SKUs are reported beside it, never
        // inside it.
        val units = knownUnits
        val target = expected
        counts = ScanCounts(
            units = units,
            skus = epcsBySku.size,
            labelled = labelledUnits,
            articles = articles.size,
            unknown = unknownSkus.size,
            unknownUnits = unknownUnits,
            distinctTags = seen.size,
            malformed = malformed.get().toInt(),
            foreign = foreignEpcs.size,
            unexpected = unexpectedSkus.size,
            expected = target?.size ?: 0,
            matchedExpected = if (target == null) 0 else epcsBySku.keys.count { it in target },
            elapsedMs = if (startedAt == 0L) 0 else System.currentTimeMillis() - startedAt,
        )
    }

    /**
     * The sweep as products, built once, when it is over.
     *
     * Deliberately not maintained during the sweep. Nothing draws a product row
     * while the reader is live, so grouping and sorting five thousand tags five
     * times a second would be work for a screen that is showing four numbers.
     */
    fun lines(): List<ScanLine> =
        epcsBySku.entries.map { (sku, epcs) ->
            ScanLine(sku, epcs.size + (labelsBySku[sku] ?: 0), epcs)
        }

    fun foreignTags(): List<String> = ArrayList(foreignEpcs)

    fun unknownSkuCodes(): Set<String> = HashSet(unknownSkus)

    /**
     * EPCs of tags that decoded to a SKU this handheld cannot name.
     *
     * Kept separately from [foreignTags] because they are a different problem:
     * these ARE ours, and a stale catalogue is the usual reason. A bench marries
     * them for convenience; a shop would sync the catalogue instead.
     */
    fun unknownEpcs(): List<String> = ArrayList(unknownEpcList)

    /**
     * What the engine itself believes, for when the screen and the worker
     * disagree.
     *
     * Two settings failed to reach this object in a row — a marriage map and a
     * bench flag — and both were set on what looked like the same instance. A
     * figure read straight off the engine is the only thing that can tell "the
     * view model never set it" from "the view model set it on a different
     * engine".
     */
    fun beliefs(): String = "aliases=${aliases.size} bench=$countEveryTag known=${known.size}"

    /**
     * Every distinct EPC of this sweep, summarised by shape.
     *
     * A count of "not ours" cannot tell a reader that is correctly ignoring
     * other people's tags from one that is handing back corrupted bytes —
     * both arrive as tags we cannot name. The shapes can: a reader working
     * properly returns a handful of lengths and a handful of headers, and a
     * reader that has been broken by a Select returns a scatter.
     *
     * ```
     * len 24 x45 | hdr A0 x22, E2 x18, 30 x5      healthy
     * len 24 x900, len 12 x800, len 4 x908 | ...  something is very wrong
     * ```
     */
    fun epcShapes(): String {
        val byLength = HashMap<Int, Int>()
        val byHeader = HashMap<String, Int>()
        seen.forEach { epc ->
            byLength.merge(epc.length, 1) { a, b -> a + b }
            byHeader.merge(epc.take(2), 1) { a, b -> a + b }
        }
        val lengths = byLength.entries.sortedByDescending { it.value }
            .joinToString(", ") { "len ${it.key} x${it.value}" }
        val headers = byHeader.entries.sortedByDescending { it.value }.take(6)
            .joinToString(", ") { "${it.key} x${it.value}" }
        return "$lengths | hdr $headers"
    }

    /** How long tags stayed quiet between reads of themselves. See [ReadGaps]. */
    fun gaps(): ReadGaps {
        val n = gapSamples.get()
        return ReadGaps(
            samples = n,
            meanMs = if (n == 0L) 0.0 else gapTotalMs.get().toDouble() / n,
            maxMs = gapMaxMs.get(),
            over500ms = gapOver500.get(),
        )
    }

    /** Every distinct EPC of this sweep, in the order they were first seen. */
    fun allEpcs(): List<String> = ArrayList(seen)

    /** Whose silicon is on these garments, when a TID said so. */
    fun chip(): Tid.Chip? = chip

    /**
     * Distinct tags per kind of silicon, highest first.
     *
     * Empty unless FastID was on — the TID only rides along with the EPC when
     * the reader was asked for it.
     */
    fun chips(): List<Pair<String, Int>> =
        chipsByVendor.entries.sortedByDescending { it.value }.map { it.key to it.value }

    /** Every distinct EPC this sweep identified, paired with its silicon. */
    fun chipByEpc(): Map<String, String> = HashMap(chipByEpc)

    /**
     * Take evidence that has not been spooled yet.
     *
     * Called from the IO thread on a timer. The queue is the handoff, so the
     * worker never waits for a disk write and the spooler never touches sweep
     * state.
     */
    fun takeEvidence(max: Int): List<Pair<String, Float?>> {
        val batch = ArrayList<Pair<String, Float?>>(minOf(max, pendingEvidence.size))
        while (batch.size < max) batch.add(pendingEvidence.poll() ?: break)
        return batch
    }

    /** Hand evidence back when it could not be written down. */
    fun returnEvidence(batch: List<Pair<String, Float?>>) {
        pendingEvidence.addAll(batch)
    }

    fun evidenceBacklog(): Int = pendingEvidence.size

    private companion object {
        /**
         * Eight thousand unique tags of headroom. Only NEW tags are queued, so
         * this is not a read buffer — it is how far the worker may fall behind
         * on genuinely new stock before we would rather drop and say so.
         */
        const val CAPACITY = 8_192
        const val POLL_MS = 50L
        const val ARTICLE_LEN = 8

        /** A 96-bit EPC, written out. */
        const val EPC_HEX_LEN = 24
    }
}
