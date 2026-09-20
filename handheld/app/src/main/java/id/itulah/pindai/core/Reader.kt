package id.itulah.pindai.core

import android.content.Context
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.Gen2Entity
import com.rscja.deviceapi.entity.InventoryModeEntity

/**
 * A sighting is handed on as the two strings the module already had.
 *
 * There is no object here on purpose. The poll loop sees the same garment
 * dozens of times as somebody walks past it, and at a thousand sightings a
 * second an allocation per read — a wrapper, plus a `Float` parsed out of the
 * RSSI string — is thousands of objects a second created for tags that are
 * already counted. Whether this tag is new at all is decided one call away, in
 * [id.itulah.pindai.core.ScanEngine.offer], by a set probe that allocates
 * nothing; only a tag that survives that probe is worth turning into anything.
 */
typealias OnTag = (epc: String, rssi: String?, tid: String?) -> Unit

/** Which of the reader's Gen2X extensions the module says are actually on. */
data class Gen2State(
    val tagFocus: Boolean,
    val fastId: Boolean,
    /** The Gen2 session the inventory round runs in: 0..3, or -1 when unknown. */
    val session: Int = -1,
)

/**
 * The C5's UHF reader, and nothing else.
 *
 * # Silence is deliberate
 *
 * There is no beeper and no vibration here, and no switch to turn them on. A
 * stock count runs for an hour; a device that chirps per tag is a device the
 * floor turns off, and a reader nobody carries reads nothing. Feedback belongs
 * on the screen, where it can say *what* was read.
 *
 * # Why buffer polling rather than the push callback
 *
 * `setInventoryCallback` never fires on this module (E710): continuous
 * inventory returns zero tags through it. `startInventoryTag()` fills an
 * internal buffer and `readTagFromBuffer()` drains it, which works on every
 * firmware this estate has met. One delivery path also means no double counting.
 */
class Reader {
    @Volatile private var rfid: RFIDWithUHFUART? = null
    @Volatile private var polling = false
    @Volatile private var appliedPower = -1

    /** The inventory mode this open module is already in; -1 when unknown. */
    @Volatile private var appliedMode = -1

    /**
     * Where a Select's mask starts, in bits. Bank-absolute — settled by test.
     *
     * The EPC bank begins with a CRC-16 and a protocol control word, so the EPC
     * itself starts at bit 32. Whether this vendor API counted from the bank or
     * from the EPC was undocumented, so it was measured: the same 8-bit `A0`
     * mask was tried at every byte boundary against a desk whose baseline
     * histogram said `A0 x37`.
     *
     * ```
     * ptr   0   8  16  24   32   40  48
     * tags  0   3   0   0   37    0   0
     * ```
     *
     * Thirty-seven, exactly, at 32. It counts from the bank.
     *
     * The zeros are not the filter failing — they are it working. A Select
     * whose mask matches nothing puts every tag in the state the reader is not
     * asking for, so the correct answer to a mask aimed at empty space IS no
     * tags. An evening was lost to reading those zeros as a broken module.
     */
    @Volatile var filterPointer: Int = 32

    /** The dBm somebody asked for, or 0 while nobody has. */
    @Volatile private var wantedPower = 0

    /**
     * The Gen2 configuration somebody asked for, kept so a reopen can restore it.
     *
     * # The bug this closes
     *
     * `setPower` closes and reopens the module — that is the only order this
     * firmware actually radiates at — and `init` used to restore the power and
     * nothing else. So an operator turning the antenna down mid-count silently
     * lost Tag Focus and dropped back to session S0, and the app went on
     * displaying both as still on. Clearing a Select reopens the module too, so
     * it had the same hole.
     *
     * A choice the floor made has to survive the radio being cycled underneath
     * it. -1 means nobody has chosen.
     */
    @Volatile private var wantedTagFocus: Boolean? = null
    @Volatile private var wantedFastId: Boolean? = null
    @Volatile private var wantedSession: Int = -1

    /**
     * The link mode this app last asked for, or -1 while it has never asked.
     *
     * This one is not like the others. The module KEEPS its link mode across an
     * app restart, so a handheld that is never told which mode to use runs in
     * whatever mode somebody left it in — and this project spent a night
     * measuring in a Gen2X mode it did not know was set, because the module was
     * sitting at 14. An untracked setting that survives the process is worse
     * than one that resets: the reset one is at least the same every morning.
     */
    @Volatile private var wantedRfLink: Int = -1

    /** Kept so a power change can re-open the module; see [setPower]. */
    @Volatile private var appContext: Context? = null
    private var pollThread: Thread? = null

    val isReady: Boolean get() = rfid != null

    /**
     * What every vendor call was asked, and what it answered.
     *
     * # Why this exists
     *
     * Every setter in this SDK returns a boolean and the code ignored it. A
     * mask one nibble short of a whole byte was refused before it ever reached
     * the radio, and the app carried on as though a filter were in force —
     * which cost hours of measuring a reader that had been told nothing. A
     * module already known for accepting settings it does not apply deserves
     * the opposite discipline: write down the question AND the answer, every
     * time.
     *
     * A ring of the last few dozen calls, oldest dropped. Cheap enough to leave
     * on: these are configuration calls, not the inventory path.
     */
    private val callLog = java.util.ArrayDeque<String>()

    private fun <T> logged(call: String, block: () -> T): T {
        val answer = runCatching(block)
        synchronized(callLog) {
            while (callLog.size >= CALL_LOG_DEPTH) callLog.removeFirst()
            callLog.addLast(
                call + " -> " + answer.fold(
                    { it.toString() },
                    { "THREW " + (it.message ?: it::class.java.simpleName) },
                ),
            )
        }
        return answer.getOrThrow()
    }

    /** The call log, newest last. */
    fun calls(): List<String> = synchronized(callLog) { callLog.toList() }

    /**
     * Open the module, and keep trying briefly if somebody else still has it.
     *
     * # Why a retry and not a single attempt
     *
     * The UHF module is EXCLUSIVE, and the process that held it does not have
     * to have exited tidily. An app killed with `force-stop`, a crash, or a
     * previous build still resident all leave the UART claimed for a short
     * while after the owner is gone — the kernel reclaims the descriptor, but
     * not instantly.
     *
     * The vendor API's answer to this is a bare `false`, which the app used to
     * surface as "init reader gagal" and stop. On the floor that is
     * indistinguishable from a broken reader, and the fix — wait two seconds
     * and pull the trigger again — is not something anybody can guess. So the
     * waiting happens here, once, where it can be explained.
     *
     * Three attempts over roughly a second and a half. Beyond that it is not a
     * busy UART, it is a different problem, and pretending otherwise would hold
     * an operator in front of a spinner.
     */
    @Synchronized
    fun init(context: Context): String {
        appContext = context.applicationContext
        rfid?.let { return it.version.orEmpty() }
        var lastReason: String? = null
        repeat(OPEN_ATTEMPTS) { attempt ->
            if (attempt > 0) {
                try {
                    Thread.sleep(OPEN_RETRY_MS)
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw IllegalStateException("reader tidak jadi dibuka")
                }
            }
            val instance = runCatching { RFIDWithUHFUART.getInstance() }.getOrElse {
                lastReason = it.message ?: "getInstance"
                return@repeat
            }
            val opened = runCatching { instance.init(context.applicationContext) }
                .getOrElse { lastReason = it.message ?: "init"; false }
            if (opened) {
                rfid = instance
                applyPower(instance, wantedPower)
                restoreGen2(instance)
                return instance.version.orEmpty()
            }
            lastReason = lastReason ?: "the module refused to open"
            // Hand back whatever half-open state the attempt left behind, or the
            // next attempt inherits it and fails for a reason that is now ours.
            runCatching { instance.free() }
        }
        throw IllegalStateException(
            "reader is busy — another app may still hold it ($lastReason)",
        )
    }

    /**
     * Ask the module for Impinj's Gen2X extensions, and report what it grants.
     *
     * # Tag Focus
     *
     * An Impinj tag that has been inventoried stays quiet for the rest of the
     * round instead of answering again. That is the whole shape of this app's
     * hot path turned off at the source: a garment is read dozens of times as an
     * operator walks past it, and every one of those reads after the first is
     * work we do only to throw away. With Tag Focus the reader spends its air
     * time finding tags it has NOT seen, which is also the thing an operator is
     * waiting for.
     *
     * # FastID
     *
     * Returns the TID alongside the EPC in one inventory round rather than as a
     * second read. It is how [Tid] can say whose silicon this is without
     * stopping the sweep to ask.
     *
     * # Both are a conversation, not a switch
     *
     * These are extensions an Impinj READER offers an Impinj TAG. This module is
     * an E710, so the reader half is settled; the tag half is whatever is on the
     * garment. A non-Impinj tag simply ignores them and inventories normally —
     * there is no failure mode here, only an absence of benefit.
     *
     * Returns what the module REPORTS, not what was asked for, for the same
     * reason [setPower] does: this firmware has form for accepting a setting and
     * then not applying it.
     */
    @Synchronized
    fun setGen2Extensions(tagFocus: Boolean, fastId: Boolean, session: Int? = null): Gen2State {
        val r = rfid ?: return Gen2State(false, false)
        // Session first: Tag Focus has nothing to hold on to in S0, so setting
        // it before the session would be switching on a feature that cannot
        // work and then reporting it as on.
        session?.let { setSession(it) }
        wantedTagFocus = tagFocus
        wantedFastId = fastId
        runCatching { logged("setTagFocus($tagFocus)") { r.setTagFocus(tagFocus) } }
        runCatching { logged("setFastID($fastId)") { r.setFastID(fastId) } }
        return gen2State()
    }

    /**
     * Everything the module says about its own Gen2 parameters.
     *
     * Diagnostic, and it exists because of a real mistake: [setSession] reads
     * the whole entity, changes one field and writes it all back. If the read
     * comes back partly empty — a Q of zero, say — writing it returns a reader
     * that can only hear one tag per round, and the symptom is a rack that
     * suddenly counts three garments instead of fifty. Printing what is
     * actually in there is how that stops being a guess.
     */
    @Synchronized
    fun gen2Dump(): String {
        val r = rfid ?: return "module closed"
        return runCatching { r.gen2?.toString() ?: "no gen2" }
            .getOrElse { "gen2 unreadable: ${it.message}" }
    }

    /** What the module says is on right now. */
    @Synchronized
    fun gen2State(): Gen2State {
        val r = rfid ?: return Gen2State(false, false)
        return Gen2State(
            tagFocus = runCatching { r.tagFocus }.getOrDefault(0) == 1,
            fastId = runCatching { r.fastId }.getOrDefault(0) == 1,
            session = runCatching { r.gen2?.querySession ?: -1 }.getOrDefault(-1),
        )
    }

    /**
     * Which Gen2 session the inventory round runs in.
     *
     * # Why this decides whether Tag Focus does anything at all
     *
     * A tag that answers a round sets an "inventoried" flag and then stays
     * quiet — but only for as long as that flag survives, and how long it
     * survives is the session's whole definition:
     *
     * ```
     * S0   while the tag is energised, and no longer. Unpower it for an
     *      instant and it answers again — which, for a tag being walked past,
     *      is constantly.
     * S1   500 ms to 5 s, whether powered or not.
     * S2   indefinite while powered; ~2 s after power is lost.
     * ```
     *
     * Impinj's Tag Focus extends the S1 flag so it persists for as long as the
     * tag stays in the field. In S0 there is nothing for it to extend, which is
     * measurable: with S0 on this handheld, turning Tag Focus on moved the
     * duplicate ratio from 93.1% to 92.6% — inside the noise.
     *
     * So the two are one setting, not two, and they are set together.
     */
    @Synchronized
    fun setSession(session: Int): Int = tuneGen2(session = session)

    /**
     * Change Gen2 parameters, and put back everything you did not mean to change.
     *
     * # The trap this exists to close
     *
     * `setGen2` takes the WHOLE parameter block, so changing one field means
     * reading the block, editing it and writing it all back — and whatever else
     * was in that block goes with it. On this module the block came back
     * carrying `q=1`: two slots per inventory round. With forty tags in the
     * field that is collision on nearly every slot, and the symptom is a rack
     * that counts three garments instead of fifty.
     *
     * Whether the module was already running that way or the write-back put it
     * there, the lesson is the same: this method never writes a value it was not
     * asked to write WITHOUT saying so, and [q] has a floor, because a Q of one
     * is not a setting anybody wants on a handheld that sweeps racks.
     */
    @Synchronized
    fun tuneGen2(
        session: Int? = null,
        q: Int? = null,
        target: Int? = null,
        startQ: Int? = null,
    ): Int {
        val r = rfid ?: return -1
        val current = runCatching { r.gen2 }.getOrNull() ?: return -1
        session?.let {
            current.querySession = it.coerceIn(0, 3)
            wantedSession = current.querySession
        }
        target?.let { current.queryTarget = it.coerceIn(0, 1) }
        // `q` selects the ALGORITHM, not the slot count.
        //
        // The vendor's own Javadoc on Gen2Entity.getQ(): "0: fixed Q algorithm,
        // 1: dynamic Q algorithm — in fixed algorithm, Q will be fixed as
        // StartQ, neglect MinQ and MaxQ". Nothing above 1 means anything.
        //
        // This code used to read it as the slot exponent and wrote 6 into it,
        // and worse, a line here restored that reading on every call that did
        // not pass `q` — which is every session change and every Tag Focus
        // toggle. So a correct configuration was silently replaced with an
        // impossible one at the exact moment an experiment began.
        //
        // Nothing downstream complains: Gen2Entity.checkParameter() only
        // rejects fields left at -1, so an out-of-range algorithm is passed to
        // the module without a word. That is the same shape as setFilter being
        // accepted on the write path and not applied — this firmware answers
        // "true" for things it does not do, and the only defence is to send it
        // values the documentation actually defines.
        q?.let { current.q = it.coerceIn(0, 1) }
        startQ?.let { current.startQ = it.coerceIn(0, 15) }
        // Target A, and let the round alternate normally. A tag that has gone
        // quiet in S1 is in state B; leaving the reader asking for A is what
        // keeps it quiet.
        runCatching {
            logged("setGen2(session=${current.querySession}, q=${current.q}, startQ=${current.startQ})") {
                r.setGen2(current)
            }
        }
        return runCatching { r.gen2?.querySession ?: -1 }.getOrDefault(-1)
    }

    /**
     * Put the radio back to a block that is known to sweep a rack.
     *
     * # Why a handheld needs a way back
     *
     * `setGen2` writes the whole parameter block, so one careless read-edit-write
     * can leave a reader that answers every call correctly and finds nothing.
     * That happened here: the block came back carrying `q=1` — two slots per
     * round — and a rack that had been counting fifty garments started counting
     * three. Every value below is written explicitly, so nothing survives from
     * whatever state the module was left in.
     *
     * The figures are the ordinary ones for a handheld reading a few dozen to a
     * few hundred tags: sixty-four slots, session 0, target A, no Select.
     */
    @Synchronized
    fun resetRadioDefaults(): String {
        val r = rfid ?: return "module closed"
        val block = runCatching { r.gen2 }.getOrNull() ?: return "gen2 unreadable"
        block.selectTarget = 0
        block.selectAction = 0
        block.selectTruncate = 0
        // Fixed algorithm, 64 slots. `q` is the algorithm selector (0 or 1);
        // `startQ` is the exponent, so 6 means 2^6 = 64 slots per round.
        block.q = 0
        block.startQ = 6
        block.minQ = 0
        block.maxQ = 15
        block.querySession = 0
        block.queryTarget = 0
        runCatching { r.setGen2(block) }
        // And the extensions, which live outside the block.
        runCatching { r.setTagFocus(false) }
        runCatching { r.setFastID(false) }
        runCatching { r.setFilter(EPC_BANK, EPC_BIT_OFFSET, 0, "") }
        return gen2Dump()
    }

    /** Set the number of inventory slots as 2^q. */
    @Synchronized
    /**
     * How many slots each inventory round opens, as the exponent: 2^[exponent].
     *
     * This is `startQ`, not `q`. The screen used to offer "Q=2 / Q=4 / Q=6" and
     * write those into `q`, which is the algorithm selector and only accepts 0
     * or 1 — so the buttons were setting an undefined algorithm and leaving the
     * slot count wherever it happened to be.
     *
     * Fewer slots means tags collide; more means empty slots are read and
     * thrown away. Sixty-four (exponent 6) is the order of magnitude a rack of
     * garments wants.
     */
    fun setStartQ(exponent: Int): Int {
        tuneGen2(q = 0, startQ = exponent)
        return runCatching { r0()?.startQ ?: -1 }.getOrDefault(-1)
    }

    /** The slot exponent the module reports. */
    fun startQ(): Int = runCatching { r0()?.startQ ?: -1 }.getOrDefault(-1)

    private fun r0() = runCatching { rfid?.gen2 }.getOrNull()

    /**
     * Report only tags whose EPC begins with this SKU, or clear the restriction.
     *
     * # Where the numbers come from
     *
     * A Gen2 Select names a memory bank, a bit offset and a length. The EPC bank
     * does not begin with the EPC: the first 32 bits are the CRC-16 and the
     * protocol control word, so the EPC itself starts at bit 32. Our EPC is the
     * header `A0` followed by eleven SKU digits packed one per nibble — thirteen
     * hex characters, 52 bits — and after that comes the serial, which is the
     * part that differs between two garments of the same product. Matching the
     * first 52 bits is therefore exactly "this SKU, any unit".
     *
     * ```
     * bank 1, bit 32, length 52
     * A0 12345678123 | 00000000064
     * └── matched ──┘ └─ ignored ─┘
     * ```
     *
     * # This is a claim that has to be checked, not trusted
     *
     * `setFilter` is already known to be accepted and then silently NOT applied
     * on this module's write path — a write aimed at one tag lands on whichever
     * tag answers first. Whether the inventory path honours it is a different
     * question with a different answer, and the only way to know is to filter to
     * one SKU on a desk carrying twenty and count what comes back.
     */
    /**
     * Select on an arbitrary mask, for finding out what this module means.
     *
     * The vendor API is `setFilter(bank, pointer, length, data)` and documents
     * none of it. The public class is a one-line delegate; everything below is
     * obfuscated bytecode with the method names stripped, so the units of
     * `pointer` and `length` cannot be read — only discovered.
     *
     * What is known so far, measured on this module with a 2-hex mask:
     *
     * ```
     * pointer 32, length 8   two and a half thousand EPCs from forty tags
     * pointer 0,  length 8   no effect at all
     * ```
     *
     * So this exists to try combinations against a known answer: filter to one
     * whole EPC that is definitely on the desk, and a working filter can only
     * return that one tag.
     */
    @Synchronized
    fun setRawFilter(pointer: Int, lengthBits: Int, hex: String): Boolean {
        val r = rfid ?: return false
        return runCatching {
            logged("setFilter(bank=$EPC_BANK, ptr=$pointer, bits=$lengthBits, \"$hex\" ${hex.length}hex)") {
                r.setFilter(EPC_BANK, pointer, lengthBits, hex)
            }
        }.getOrDefault(false)
    }

    @Synchronized
    fun setSkuFilter(sku: String?): Boolean {
        val r = rfid ?: return false
        if (sku.isNullOrBlank()) {
            // Length zero is how a Select is switched off; there is no
            // clearFilter on this API.
            return runCatching { r.setFilter(EPC_BANK, EPC_BIT_OFFSET, 0, "") }
                .getOrDefault(false)
        }
        if (sku.length != 11 || !sku.all { it in '0'..'9' }) return false
        // The mask has to be a whole number of BYTES, even when the match is not.
        //
        // Fifty-two bits is six and a half bytes, and the header plus eleven SKU
        // digits is thirteen hex characters — half a byte short of the seven the
        // SDK requires. It refuses the call before the reader ever sees it.
        // Padding to fourteen characters satisfies that, while the LENGTH stays
        // 52 so the trailing nibble is never compared: it is packaging, not part
        // of the match.
        val mask = ("A1" + sku).padEnd(SKU_MASK_HEX, '0')
        return runCatching {
            logged("setFilter(sku, ptr=$EPC_BIT_OFFSET, bits=$SKU_FILTER_BITS, \"$mask\" ${mask.length}hex)") {
                r.setFilter(EPC_BANK, EPC_BIT_OFFSET, SKU_FILTER_BITS, mask)
            }
        }.getOrDefault(false)
    }

    /**
     * Report only tags whose EPC carries our header, and ignore everyone else's.
     *
     * # Eight bits that do more than fifty-two
     *
     * The SKU filter narrows to one product. This narrows to one ESTATE: match
     * the header byte `A0` and nothing else, and a pallet label, a security tag,
     * a supplier's own encoding and last year's trial all stop answering. They
     * cost no air time, no sighting, and no work on this device — the reader
     * spends every slot on garments we own.
     *
     * On this bench that is the difference between fifty-three transponders and
     * the dozen that are actually ours. In a shop it is the difference between a
     * count that has to explain its foreign tags and one that never sees them.
     *
     * # The measurement that settled it, and the one that did not
     *
     * An earlier note in this same file said pointer 32 returned two and a half
     * thousand EPCs from a room holding forty tags, and concluded the module was
     * broken by any Select at all. That reading was taken while the engine's
     * counters accumulated across sweeps, so the figure was a session total
     * rather than a sweep's, and it meant nothing.
     *
     * The measurement that stands swept the pointer against a desk whose own
     * histogram said `A0 x37`: thirty-seven tags at pointer 32, and zero at
     * every other byte boundary. Zero is the filter WORKING — a mask aimed at
     * empty space puts every tag in the state the reader is not asking for.
     *
     * Safe to leave on for counting, unlike the SKU filter: it narrows to
     * everything of ours rather than to one product.
     */
    @Synchronized
    fun setOursOnlyFilter(on: Boolean): Boolean {
        val r = rfid ?: return false
        return if (on) {
            runCatching {
                logged("setFilter(bank=$EPC_BANK, ptr=$filterPointer, bits=$HEADER_BITS, \"$EPC_HEADER\")") {
                    r.setFilter(EPC_BANK, filterPointer, HEADER_BITS, EPC_HEADER)
                }
            }.getOrDefault(false)
        } else {
            // Clearing a Select means re-opening the module, not un-setting it.
            //
            // Measured on a C5 (E710_V7.10.1): once `setFilter` has been called
            // with a mask, this module returns NOTHING — zero tags, zero
            // sightings — and stays that way. `setFilter` with length 0 does not
            // undo it. Nor does writing a fresh Gen2 block, nor `setTagFocus`,
            // nor `setFastID`. The only thing that brought the radio back was
            // closing the module and opening it again.
            //
            // So that is what clearing does. It costs about a second, which is
            // the price of a control that can otherwise leave a handheld deaf
            // until somebody thinks to restart the app.
            logged("clearFilter(by reopening the module)") {
                val context = appContext
                runCatching { r.setFilter(EPC_BANK, filterPointer, 0, "") }
                stop()
                runCatching { rfid?.free() }
                rfid = null
                appliedPower = -1
                appliedMode = -1
                if (context != null) runCatching { init(context) }.isSuccess else false
            }
        }
    }

    /**
     * The RF link profile — and the only place Gen2X actually lives.
     *
     * # Why this matters more than Tag Focus did
     *
     * Everything measured on this handheld so far — Tag Focus, FastID, sessions
     * — is ordinary Gen2. The vendor documents modes 0–5 as Gen2 link profiles
     * and modes 10–15 (written A–F) as the **Gen2X** ones. Nothing in this app
     * had ever touched `setRFLink`, so a whole evening of "testing Gen2X" was
     * testing Gen2 with an Impinj reader in it.
     *
     * Returns what the module reports back, because on this firmware that is
     * the only statement worth anything.
     */
    /**
     * What each RF link mode is, from the vendor's own table.
     *
     * Modes 0–5 are Gen2. **A–F, which the API takes as 10–15, are Gen2X.**
     * That is the whole of Gen2X as this SDK exposes it: not a feature to turn
     * on but a link profile to run in. Everything this project measured — Tag
     * Focus, FastID, sessions — was Gen2, because nothing ever called this.
     */
    fun rfLinkName(mode: Int): String = when (mode) {
        0 -> "Gen2 · Miller8 · 160 kHz"
        1 -> "Gen2 · Miller4 · 250 kHz"
        2 -> "Gen2 · Miller4 · 320 kHz"
        3 -> "Gen2 · Miller4 · 640 kHz"
        4 -> "Gen2 · Miller2 · 320 kHz"
        5 -> "Gen2 · Miller2 · 640 kHz"
        10 -> "Gen2X · Miller8 · 160 kHz"
        11 -> "Gen2X · Miller4 · 250 kHz"
        12 -> "Gen2X · Miller4 · 320 kHz"
        13 -> "Gen2X · Miller4 · 640 kHz"
        14 -> "Gen2X · Miller2 · 320 kHz"
        15 -> "Gen2X · Miller2 · 640 kHz"
        else -> "unknown mode $mode"
    }

    /** Ask the module for a Gen2 target: 0 is A, 1 is B. */
    @Synchronized
    fun setTarget(target: Int): Int = tuneGen2(target = target).let {
        runCatching { rfid?.gen2?.queryTarget ?: -1 }.getOrDefault(-1)
    }

    @Synchronized
    fun setRfLink(mode: Int): Int {
        val r = rfid ?: return -1
        wantedRfLink = mode
        runCatching { logged("setRFLink($mode)") { r.setRFLink(mode) } }
        return runCatching { r.rfLink }.getOrDefault(-1)
    }

    /** What the module says its link mode is right now. */
    fun rfLink(): Int = runCatching { rfid?.rfLink ?: -1 }.getOrDefault(-1)

    /**
     * Put back what the floor chose, after the module has been cycled.
     *
     * Quiet on failure: this runs inside `init`, and a handheld that refuses to
     * open because it could not restore a preference is worse than one that
     * opens without it. What it must not do is claim the preference is in force
     * — which is why the app reads the state back rather than assuming.
     */
    private fun restoreGen2(instance: RFIDWithUHFUART) {
        if (wantedSession in 0..3) {
            runCatching {
                val block = instance.gen2 ?: return@runCatching
                block.querySession = wantedSession
                logged("restore setGen2(session=$wantedSession)") { instance.setGen2(block) }
            }
        }
        wantedTagFocus?.let { on ->
            runCatching { logged("restore setTagFocus($on)") { instance.setTagFocus(on) } }
        }
        wantedFastId?.let { on ->
            runCatching { logged("restore setFastID($on)") { instance.setFastID(on) } }
        }
        if (wantedRfLink >= 0) {
            runCatching {
                logged("restore setRFLink($wantedRfLink)") { instance.setRFLink(wantedRfLink) }
            }
        }
    }

    /** What the antenna is running at, as the module last reported it. */
    fun power(): Int = appliedPower

    /**
     * Which frequency band the module is on, as a bare vendor number.
     *
     * Read-only on purpose. The SDK exposes `setFrequencyMode(int)` with no
     * named constants anywhere in the AAR — no region enum, no documentation of
     * which integer means which band. Guessing one and writing it would be
     * transmitting on a band nobody chose, which in Indonesia is an SDPPI
     * question and not a performance one. The number is reported so a human can
     * check it against Chainway's own table before anything writes it.
     */
    fun frequencyMode(): Int =
        runCatching { rfid?.frequencyMode ?: -1 }.getOrDefault(-1)

    /**
     * Run the antenna at [dbm], now if the module is open and at the next open
     * if it is not.
     *
     * Returns the power READ BACK, not the power requested: `setPower` answers
     * true for figures this firmware then settles somewhere else, and a screen
     * that echoed the request would tell the floor it is reading at 30 while the
     * antenna sits at 26. `-1` means the module is closed and there is nothing
     * to report yet — the choice is kept and applied when it opens.
     *
     * Call this at rest. The getter returns 0 while inventory runs, so a power
     * set mid-sweep can only be reported as the number that was asked for.
     */
    @Synchronized
    fun setPower(dbm: Int): Int {
        val target = dbm.coerceIn(MIN_POWER, MAX_POWER)
        if (wantedPower == target && appliedPower > 0) return appliedPower
        wantedPower = target
        val context = appContext
        if (rfid == null || context == null) return -1
        // Re-OPEN rather than re-tune.
        //
        // Measured on a C5 (E710_V7.10.1): setPower on an already-open module
        // returns true and the getter echoes the new figure, while the antenna
        // stops radiating. Forty reads at 30 dBm became zero at 29 — and one
        // decibel cannot do that to a tag sitting at -78 dBm. Applying the
        // figure during init is the only order that moves the radio, so a
        // change closes the module and opens it again.
        //
        // This is the same species of trap as `setFilter` being ignored by
        // `writeDataToEpc`: the call succeeds, the read-back agrees, and the
        // hardware quietly does not do it.
        stop()
        runCatching { rfid?.free() }
        rfid = null
        appliedPower = -1
        appliedMode = -1
        return runCatching { init(context); appliedPower }.getOrDefault(-1)
    }

    /**
     * Put the antenna at [dbm] — or as high as this module will go when [dbm] is
     * 0, because nobody has chosen yet.
     *
     * Writing needs far more energy than reading, and reading at full power also
     * reaches the back of a rack; the module itself comes up at 14 dBm, which is
     * neither. A refused figure walks down rather than giving up: losing a dBm
     * or two is a worse sweep, losing the setting is a reader at whatever the
     * last job left behind.
     */
    private fun applyPower(instance: RFIDWithUHFUART, dbm: Int): Int {
        val ladder = if (dbm >= MIN_POWER) (dbm downTo MIN_POWER) else CEILING.asIterable()
        for (candidate in ladder) {
            if (runCatching { instance.setPower(candidate) }.getOrDefault(false)) {
                appliedPower = runCatching { instance.power }.getOrDefault(candidate)
                    .let { if (it <= 0) candidate else it }
                return appliedPower
            }
        }
        return appliedPower
    }

    /** Sweep until [stop] is called, handing every read to [onTag]. */
    @Synchronized
    fun start(withTid: Boolean, onTag: OnTag): Boolean {
        val r = rfid ?: return false
        // Only tear down what is actually up. `stop()` talks to the UART and
        // joins a thread; doing that before a sweep that is not running yet is
        // a round trip paid on every pull of the trigger for nothing.
        if (polling || pollThread != null) stop()
        // Configure the inventory mode ONCE per open module.
        //
        // Measured on a C5 (E710_V7.10.1): with the module already open, a pull
        // of the trigger took 2 659 ms to reach a live antenna, and almost all
        // of it was here. This app only ever asks for one mode — EPC, without
        // TID — so after the first configure every later call is a UART
        // conversation that changes nothing and costs seconds the operator
        // spends staring at a screen that says it is waking up.
        val mode = if (withTid) InventoryModeEntity.MODE_EPC_TID else InventoryModeEntity.MODE_EPC
        if (appliedMode != mode) {
            val configured = runCatching {
                r.setEPCAndTIDUserMode(InventoryModeEntity.Builder().setMode(mode).build())
            }.isSuccess
            // Remembered only when it worked. A failed configure that we recorded
            // would leave the module in one mode and this object certain of
            // another, which is the shape of every reader bug in this file.
            if (configured) appliedMode = mode
        }
        if (!runCatching { logged("startInventoryTag()") { r.startInventoryTag() } }
                .getOrDefault(false)
        ) return false
        polling = true
        pollThread = Thread {
            while (polling) {
                val info = runCatching { r.readTagFromBuffer() }.getOrNull()
                if (info == null) { try { Thread.sleep(3) } catch (e: InterruptedException) { break }; continue }
                val epc = info.getEPC()?.takeIf { it.isNotBlank() } ?: continue
                onTag(epc, info.rssi, info.tid)
            }
        }.apply { isDaemon = true; name = "uhf"; start() }
        return true
    }

    @Synchronized
    fun stop() {
        val thread = pollThread
        polling = false
        thread?.interrupt()
        if (thread != null && thread !== Thread.currentThread()) runCatching { thread.join(400) }
        pollThread = null
        runCatching { rfid?.stopInventory() }
    }

    @Synchronized
    fun close() {
        stop()
        runCatching { rfid?.free() }
        rfid = null
        // A closed module is in no mode at all; remembering one would let the
        // next open skip a configure it genuinely needs.
        appliedMode = -1
        // The choice survives; what the module said about it does not. A closed
        // reader has no power to report, and reporting the last one would be a
        // reading taken from a radio that is off.
        appliedPower = -1
    }

    companion object {
        /** The window this module accepts. There is no API to ask it. */
        const val MIN_POWER = 5
        const val MAX_POWER = 30

        /** Coarse descent used only to find the ceiling when nobody has chosen. */
        private val CEILING = intArrayOf(30, 27, 25, 22, 20)

        /** How many times to ask a busy UART, and how long to wait between. */
        /** Gen2 memory banks: 0 reserved, 1 EPC, 2 TID, 3 user. */
        private const val EPC_BANK = 1

        /** The EPC starts after the CRC-16 and the protocol control word. */
        private const val EPC_BIT_OFFSET = 32

        /** Header plus eleven SKU digits, one per nibble. */
        private const val SKU_FILTER_BITS = 52

        /** 52 bits rounded up to whole bytes, in hex characters. */
        private const val SKU_MASK_HEX = 14

        /** The header alone: eight bits that say "this estate". */
        private const val HEADER_BITS = 8
        private const val EPC_HEADER = "A1"

        /** How many vendor calls to keep. Enough to cover one experiment. */
        private const val CALL_LOG_DEPTH = 40

        private const val OPEN_ATTEMPTS = 3
        private const val OPEN_RETRY_MS = 700L
    }
}
