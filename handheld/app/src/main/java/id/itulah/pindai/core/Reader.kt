package id.itulah.pindai.core

import android.content.Context
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.UhfBase
import com.rscja.deviceapi.entity.Gen2Entity
import com.rscja.deviceapi.entity.InventoryModeEntity
import com.rscja.deviceapi.entity.InventoryParameter
import com.rscja.deviceapi.entity.UHFTAGInfo
import com.rscja.deviceapi.interfaces.ConnectionStatus
import com.rscja.deviceapi.interfaces.ConnectionStatusCallback
import com.rscja.team.mtk.deviceapi.DeviceAPI
import id.itulah.pindai.BuildConfig

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
    @Volatile private var productionRecipe = true

    /** The round is stopped and the poll thread is emptying the SDK's buffer. See [stop]. */
    @Volatile private var draining = false

    /** Tag frames handed over since the last [start]. See [heardWithin]. */
    @Volatile private var framesSinceStart = 0L

    /**
     * How the next round starts. Bench only: nothing on the floor sets it and
     * nothing saves it, so every launch starts [StartMode.NORMAL].
     *
     * Read by every start. A round already running keeps the frame it was
     * started with; a change takes effect at the next start.
     */
    @Volatile var startMode: StartMode = StartMode.NORMAL
        set(value) {
            if (BuildConfig.BENCH) {
                productionRecipe = false
                field = value
            }
        }

    // What the frames since the last [start] carried, in a bench build. Written
    // by the poll thread alone; see [frameStats].
    @Volatile private var startedIn = StartMode.NORMAL
    @Volatile private var strongFrames = 0L
    @Volatile private var extraFrames = 0L
    @Volatile private var lastPhase = 0
    @Volatile private var lastFrequencyMhz = 0f

    /** Armed by [listen] for one window, null otherwise. */
    @Volatile private var rssiWindow: RssiWindow? = null

    /**
     * A power written raw at rest and still in force, or -1. Bench only, and
     * gone at the next open, which applies the chosen power. See [rawPower].
     */
    @Volatile private var benchRawPower = -1

    /**
     * Keep the module when another app broadcasts UHF_POWER_OFF. Bench only,
     * off unless somebody turns it on, and never saved. See [setIgnorePowerOff].
     */
    @Volatile private var ignorePowerOff = false

    /**
     * The firmware version, read once when the module opens.
     *
     * Not asked again on every [init]: every pull of the trigger calls it, and
     * while a round runs the SDK's own reader thread swallows every reply that
     * is not a tag or a stop — so a version asked then fails after about a
     * second, with this object's lock held the whole time.
     */
    @Volatile private var version = ""
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

    /** The Gen2 target the floor runs in, 0 (A) or 1 (B); -1 while nobody has said. */
    @Volatile private var wantedTarget: Int = -1

    /** Kept so a power change can re-open the module; see [setPower]. */
    @Volatile private var appContext: Context? = null
    private var pollThread: Thread? = null

    /**
     * True only while THIS object is opening the module, so the SDK's report of
     * that open is not mistaken for somebody else's. See [sdkWatch].
     */
    @Volatile private var opening = false

    /**
     * The SDK opened the module on its own since we last did.
     *
     * # Why the instance we hold cannot simply be trusted
     *
     * The vendor SDK lets go of the module behind this object's back, and says
     * nothing. When another app opens the UHF module it broadcasts
     * `UHF_POWER_OFF`, and our instance frees ITSELF
     * (`UhfBase.PowerOffReceiver`). The receiver is exported, so any app's
     * broadcast does it, and a `free()` powers the module off. The instance in
     * [rfid] looks exactly as it did, and an early return on "we have one"
     * swept with a radio that was off. That case shows in `isPowerOn()`.
     *
     * The case this flag is for does not show there: a module the SDK opened
     * again by itself, at the module's defaults, with none of the power or
     * radio profile this app applied. It IS powered, just not by us — so the
     * SDK's own connection report is watched for an open we did not make.
     *
     * Nothing in DeviceAPI_ver20251103 makes such an open. An earlier note here
     * blamed `UhfBase.ScreenReceiver` — freeing the module at screen-off and
     * opening it again on unlock — but that receiver never registers in this
     * build: `isMonitorScreen` is only ever assigned false, in the `UhfBase`
     * constructor (javap, 22 Oct 2026). The watch stays. It costs one flag, and
     * an SDK update that does watch the screen would bring that exact failure
     * back, silently, at a power nobody chose.
     */
    @Volatile private var openedElsewhere = false

    /**
     * Told by the SDK whenever the module connects or drops.
     *
     * Only ever sets a flag. It runs inside the SDK's own synchronized methods,
     * on whatever thread the SDK chose — the main thread, for a screen event —
     * so waiting here for this object's lock could deadlock against a thread
     * that holds ours and is waiting for the SDK's.
     */
    private val sdkWatch = ConnectionStatusCallback<Any> { status, _ ->
        if (status == ConnectionStatus.CONNECTED && !opening) openedElsewhere = true
    }

    /**
     * The open module, if it is still the one this object opened: powered, and
     * not re-opened by the SDK on its own since. Null means the next [init]
     * has to open it properly. See [openedElsewhere].
     */
    private fun held(): RFIDWithUHFUART? =
        rfid?.takeIf { !openedElsewhere && runCatching { it.isPowerOn }.getOrDefault(false) }

    val isReady: Boolean get() = held() != null

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
        if (held() != null) return version
        // Held, but no longer ours to trust: the SDK freed it, or opened it
        // again at the module's defaults. Forget what this object believed
        // about it — power, inventory mode — and open it properly below, which
        // is the only path that applies the power and the profile.
        if (rfid != null) {
            stop()
            runCatching { rfid?.free() }
            rfid = null
            appliedPower = -1
            appliedMode = -1
        }
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
            // A module the SDK is already holding open — whoever opened it —
            // answers `init` with "already initialized" and opens nothing, so
            // the power below would be written to an open module: accepted,
            // and not radiated (see [setPower]). Let it go first, so this is a
            // real open.
            if (runCatching { instance.isPowerOn }.getOrDefault(false)) {
                runCatching { instance.free() }
            }
            runCatching { instance.setConnectionStatusCallback(sdkWatch) }
            opening = true
            val opened = try {
                runCatching { instance.init(context.applicationContext) }
                    .getOrElse { lastReason = it.message ?: "init"; false }
            } finally {
                opening = false
            }
            if (opened) {
                rfid = instance
                openedElsewhere = false
                // A fresh open: the power applied below replaces anything the
                // bench wrote raw.
                benchRawPower = -1
                version = versionOf(instance)
                try {
                    applyPower(instance, wantedPower)
                    restoreGen2(instance)
                } catch (failure: Exception) {
                    runCatching { instance.free() }
                    rfid = null
                    appliedPower = -1
                    appliedMode = -1
                    throw failure
                }
                // The SDK registers its UHF_POWER_OFF receiver again on every
                // open, so a bench that asked for it gone takes it away again.
                if (ignorePowerOff) dropPowerOffReceiver()
                return version
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
     * The firmware version, or nothing. Asked only when the module has just
     * opened; see [version].
     *
     * `getVersion()` is not safe to call bare: when the native call answers
     * null the SDK dereferences it while logging the failure and throws a
     * NullPointerException. A version is a caption on a screen; it must never
     * be the reason a module that opened fine is reported as broken.
     */
    private fun versionOf(instance: RFIDWithUHFUART): String =
        runCatching { instance.version }.getOrNull().orEmpty()

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
        if (BuildConfig.BENCH) productionRecipe = false
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
        if (BuildConfig.BENCH) productionRecipe = false
        val r = rfid ?: return -1
        val current = runCatching { r.gen2 }.getOrNull() ?: return -1
        session?.let {
            current.querySession = it.coerceIn(0, 3)
            wantedSession = current.querySession
        }
        target?.let {
            current.queryTarget = it.coerceIn(0, 1)
            wantedTarget = current.queryTarget
        }
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
        if (BuildConfig.BENCH) productionRecipe = false
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
        // Which tags the round addresses, after a Select: 0 is all of them. It
        // was the one field in this block nothing wrote, so whatever the last
        // experiment left there went straight back into the module.
        block.querySel = 0
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
     * header `A1` followed by eleven SKU digits packed one per nibble — thirteen
     * hex characters, 52 bits — and after that comes the serial, which is the
     * part that differs between two garments of the same product. Matching the
     * first 52 bits is therefore exactly "this SKU, any unit".
     *
     * ```
     * bank 1, bit 32, length 52
     * A1 12345678123 | 00000000064
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
     * the header byte `A1` and nothing else, and a pallet label, a security tag,
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
        if (BuildConfig.BENCH) productionRecipe = false
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
        if (productionRecipe) {
            installRecipe(instance)
            return
        }
        // The link mode first, in the order the floor's profile has always been
        // applied in: a link profile is the frame the rest of the block lives
        // in, and nothing here may depend on it NOT resetting the session.
        //
        // Written only when the module says something else. The link-mode
        // frame carries the module's save flag, so every write is probably a
        // write to its flash — and this runs on every open, which is several
        // times a day, for a setting the module already keeps across restarts.
        if (wantedRfLink >= 0 && runCatching { instance.rfLink }.getOrDefault(-1) != wantedRfLink) {
            runCatching {
                logged("restore setRFLink($wantedRfLink)") { instance.setRFLink(wantedRfLink) }
            }
        }
        if (wantedSession in 0..3 || wantedTarget in 0..1) {
            runCatching {
                val block = instance.gen2 ?: return@runCatching
                if (wantedSession in 0..3) block.querySession = wantedSession
                if (wantedTarget in 0..1) block.queryTarget = wantedTarget
                logged("restore setGen2(session=${block.querySession}, target=${block.queryTarget})") {
                    instance.setGen2(block)
                }
            }
        }
        wantedTagFocus?.let { on ->
            runCatching { logged("restore setTagFocus($on)") { instance.setTagFocus(on) } }
        }
        wantedFastId?.let { on ->
            runCatching { logged("restore setFastID($on)") { instance.setFastID(on) } }
        }
    }

    /**
     * Hand the reader the floor's saved radio profile — before the module opens.
     *
     * # The bug this closes
     *
     * The profile (link mode, target, Tag Focus, session) used to be applied by
     * the view model AFTER it opened the module, and skipped whenever the
     * module was already open. At a cold start the activity opens the module
     * first, so the skip was the normal case: the floor swept in whatever link
     * mode the module had kept from the last person — the very thing pinning
     * it was for.
     *
     * Kept here as the reader's own wishes instead, it is applied by [init] the
     * moment the module opens, whichever caller opened it, and again after
     * every re-open: a power change, a cleared filter, or a module the SDK took
     * away and this object had to open again.
     *
     * Saying the same profile twice says nothing to the module. A different
     * one is applied now if the module is open and at rest; mid-round it is
     * only recorded, because a configuration applied to a running inventory is
     * one nobody can reason about, and the next open applies it.
     */
    @Synchronized
    fun useProfile(rfLink: Int, target: Int, tagFocus: Boolean, fastId: Boolean, session: Int) {
        if (!BuildConfig.BENCH) return
        productionRecipe = false
        val link = if (rfLink >= 0) rfLink else wantedRfLink
        val tgt = if (target in 0..1) target else wantedTarget
        val sess = if (session in 0..3) session else wantedSession
        val changed = link != wantedRfLink || tgt != wantedTarget || sess != wantedSession ||
            tagFocus != wantedTagFocus || fastId != wantedFastId
        wantedRfLink = link
        wantedTarget = tgt
        wantedSession = sess
        wantedTagFocus = tagFocus
        wantedFastId = fastId
        if (!changed || polling) return
        held()?.let { restoreGen2(it) }
    }

    /** Reset to the versioned production recipe, including after a Lab session. At rest only. */
    @Synchronized
    fun useProductionRecipe() {
        check(!polling) { "Stop the current scan before applying the reader profile." }
        val needsPower = held() != null && appliedPower != RadioRecipe.POWER_DBM
        productionRecipe = true
        wantedPower = RadioRecipe.POWER_DBM
        wantedRfLink = RadioRecipe.RF_LINK
        wantedSession = RadioRecipe.SESSION
        wantedTarget = RadioRecipe.TARGET
        wantedTagFocus = RadioRecipe.TAG_FOCUS
        wantedFastId = RadioRecipe.FAST_ID
        if (needsPower) {
            val context = appContext ?: error("Reader context unavailable")
            close()
            init(context)
        } else held()?.let { installRecipe(it) }
    }

    private fun controls(block: Gen2Entity) = InventoryControls(
        block.selectTarget, block.selectAction, block.selectTruncate, block.q,
        block.startQ, block.minQ, block.maxQ, block.querySel,
        block.querySession, block.queryTarget,
    )

    /** No fallback values: an unread setting must never look like an extension being off. */
    private fun readRecipe(instance: RFIDWithUHFUART): RadioReadback {
        val block = instance.gen2 ?: error("Reader inventory profile is unreadable. No scan was started.")
        return RadioReadback(
            instance.power, instance.rfLink, instance.tagFocus, instance.fastId, controls(block),
            instance.fastInventoryMode?.cr ?: -1,
        )
    }

    private fun installRecipe(instance: RFIDWithUHFUART) {
        if (instance.rfLink != RadioRecipe.RF_LINK) check(
            logged("recipe setRFLink(${RadioRecipe.RF_LINK})") { instance.setRFLink(RadioRecipe.RF_LINK) },
        ) { "Reader refused the radio link. No scan was started." }
        // The selected link supplies the hardware-specific DR/M/TRext/LF values.
        val block = instance.gen2 ?: error("Reader inventory profile is unreadable. No scan was started.")
        check(block.queryDR in 0..1 && block.queryM in 0..3 &&
            block.queryTRext in 0..1 && block.linkFrequency in 0..7) {
            "Reader returned invalid radio timing. No scan was started."
        }
        if (controls(block) != RadioRecipe.inventory) {
            val wanted = RadioRecipe.inventory
            block.selectTarget = wanted.selectTarget
            block.selectAction = wanted.selectAction
            block.selectTruncate = wanted.selectTruncate
            block.q = wanted.q
            block.startQ = wanted.startQ
            block.minQ = wanted.minQ
            block.maxQ = wanted.maxQ
            block.querySel = wanted.querySel
            block.querySession = wanted.session
            block.queryTarget = wanted.target
            check(logged("recipe setGen2($wanted)") { instance.setGen2(block) }) {
                "Reader refused the inventory profile. No scan was started."
            }
        }
        if (instance.tagFocus != 0) check(logged("recipe setTagFocus(false)") { instance.setTagFocus(false) }) {
            "Reader refused TagFocus off. No scan was started."
        }
        if (instance.fastId != 0) check(logged("recipe setFastID(false)") { instance.setFastID(false) }) {
            "Reader refused FastID off. No scan was started."
        }
        RadioRecipe.requireApplied(readRecipe(instance))
        logged("recipe ${RadioRecipe.ID}") { "confirmed" }
    }

    /** At-rest hardware validation, including the region as observed, without starting inventory. */
    @Synchronized
    fun recipeReadback(): String {
        check(!polling) { "Stop reading before checking the profile." }
        val instance = held() ?: error("Reader is not open")
        val actual = readRecipe(instance)
        RadioRecipe.requireApplied(actual)
        return "${RadioRecipe.ID} confirmed: $actual; region=${instance.frequencyMode} (unchanged)"
    }

    /** What the antenna is running at, as the module last reported it. */
    fun power(): Int = appliedPower

    /**
     * Which frequency band the module is on: its raw region code, or -1.
     * [Knobs.regionName] names it from Chainway's own table.
     *
     * Read-only on purpose. The AAR names no region anywhere — the table comes
     * from the vendor's desk-reader demo — and writing one is transmitting on a
     * band, which in Indonesia is an SDPPI question and not a performance one.
     * Nothing writes it until the band these devices are certified for is
     * confirmed. At rest only: mid-round the getter fails after about a second.
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
        if (BuildConfig.BENCH) productionRecipe = false
        val target = dbm.coerceIn(MIN_POWER, MAX_POWER)
        // Only a module that is still ours is already at the figure. One the SDK
        // freed has no power at all, and one it re-opened by itself is at the
        // module's default — both are re-opened below at the chosen figure.
        if (wantedPower == target && appliedPower > 0 && held() != null) return appliedPower
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
        if (productionRecipe) {
            check(logged("recipe setPower(${RadioRecipe.POWER_DBM})") { instance.setPower(RadioRecipe.POWER_DBM) }) {
                "Reader refused the profile power. No scan was started."
            }
            appliedPower = instance.power
            check(appliedPower == RadioRecipe.POWER_DBM) {
                "Reader power is $appliedPower, expected ${RadioRecipe.POWER_DBM} dBm. No scan was started."
            }
            return appliedPower
        }
        val ladder = if (dbm >= MIN_POWER) (dbm downTo MIN_POWER) else CEILING.asIterable()
        for (candidate in ladder) {
            val askedAt = System.nanoTime()
            if (runCatching { instance.setPower(candidate) }.getOrDefault(false)) {
                appliedPower = runCatching { instance.power }.getOrDefault(candidate)
                    .let { if (it <= 0) candidate else it }
                return appliedPower
            }
            // A "no" that took this long was not the module declining a figure:
            // it did not answer at all, and the SDK gave up after its own
            // timeout. Walking the rest of the ladder would wait that out once
            // per dBm — the better part of half a minute of a frozen open — for
            // the same silence. The open goes ahead, and [power] says nothing
            // was applied.
            if ((System.nanoTime() - askedAt) / 1_000_000 >= UNANSWERED_MS) break
        }
        return appliedPower
    }

    /** Sweep until [stop] is called, handing every read to [onTag]. */
    @Synchronized
    fun start(withTid: Boolean, onTag: OnTag): Boolean {
        if (rfid == null) return false
        // Only tear down what is actually up. `stop()` talks to the UART and
        // joins a thread; doing that before a sweep that is not running yet is
        // a round trip paid on every pull of the trigger for nothing.
        if (polling || pollThread != null) stop()
        if (held() == null || !beginInventory(withTid)) {
            // No longer ours, or refused — and the usual reason on this
            // handheld is not the radio but the SDK, which lets go of the module
            // behind our back (another app's UHF_POWER_OFF; see
            // [openedElsewhere]) and leaves an instance that refuses everything.
            // Open it again, once, and ask again. A second refusal is a real
            // one, and is reported as one.
            val context = appContext ?: return false
            stop()
            runCatching { rfid?.free() }
            rfid = null
            appliedPower = -1
            appliedMode = -1
            if (runCatching { init(context) }.isFailure || !beginInventory(withTid)) return false
        }
        val r = rfid ?: return false
        framesSinceStart = 0
        if (BuildConfig.BENCH) {
            strongFrames = 0
            extraFrames = 0
            lastPhase = 0
            lastFrequencyMhz = 0f
        }
        polling = true
        pollThread = Thread {
            var misses = 0
            while (polling) {
                val info = runCatching { r.readTagFromBuffer() }.getOrNull()
                if (info == null) {
                    // A null is not always an empty buffer: a frame the SDK's
                    // parser rejected comes back as null too, with good frames
                    // still queued behind it. One more look straight away,
                    // before sleeping on a buffer that may not be empty.
                    if (++misses < 2) continue
                    misses = 0
                    // Stopped, and the buffer has given up all it held.
                    if (draining) break
                    try { Thread.sleep(3) } catch (e: InterruptedException) { break }
                    continue
                }
                misses = 0
                framesSinceStart++
                if (BuildConfig.BENCH) watch(info)
                val epc = info.getEPC()?.takeIf { it.isNotBlank() } ?: continue
                onTag(epc, info.rssi, info.tid)
            }
        }.apply { isDaemon = true; name = "uhf"; start() }
        return true
    }

    /**
     * Whether the round just started has handed over a tag frame within [ms].
     *
     * This module never acknowledges a start (command 82 has no reply); a tag
     * frame arriving is the only proof that one took. Not synchronized: it
     * waits, and must not hold the lock that the stop it may lead to needs.
     */
    fun heardWithin(ms: Long): Boolean {
        val until = System.currentTimeMillis() + ms
        while (framesSinceStart == 0L) {
            if (System.currentTimeMillis() >= until) return false
            try {
                Thread.sleep(PROOF_POLL_MS)
            } catch (interrupted: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }
        return true
    }

    /** Put the open module in this app's inventory mode and start a round. */
    private fun beginInventory(withTid: Boolean): Boolean {
        val r = rfid ?: return false
        if (productionRecipe) RadioRecipe.requireApplied(readRecipe(r))
        // Configure the inventory mode ONCE per open module.
        //
        // Measured on a C5 (E710_V7.10.1): with the module already open, a pull
        // of the trigger took 2 659 ms to reach a live antenna, and almost all
        // of it was here. This app only ever asks for one mode — EPC, without
        // TID — so after the first configure every later call is a UART
        // conversation that changes nothing and costs seconds the operator
        // spends staring at a screen that says it is waking up.
        val mode = if (!productionRecipe && withTid) InventoryModeEntity.MODE_EPC_TID else InventoryModeEntity.MODE_EPC
        if (appliedMode != mode) {
            val configured = runCatching {
                r.setEPCAndTIDUserMode(InventoryModeEntity.Builder().setMode(mode).build())
            }.getOrDefault(false)
            // Remembered only when it worked. A failed configure that we recorded
            // would leave the module in one mode and this object certain of
            // another, which is the shape of every reader bug in this file.
            if (configured) appliedMode = mode
            else return false
        }
        // `82 00 00` is the floor's start and the only one a release ever
        // sends: nothing outside a bench sets [startMode]. The other two ask
        // the firmware to append bytes to every tag frame; see [StartMode].
        val how = if (productionRecipe) StartMode.NORMAL else startMode
        startedIn = how
        return runCatching {
            when (how) {
                StartMode.NORMAL -> logged("startInventoryTag()") { r.startInventoryTag() }
                StartMode.PHASE -> logged("startInventoryTag(phase) ${how.frame}") {
                    r.startInventoryTag(
                        InventoryParameter(InventoryParameter.ResultData().setNeedPhase(true)),
                    )
                }
                StartMode.FREQUENCY -> logged("startInventoryTag(frequency point) ${how.frame}") {
                    r.startInventoryTag(
                        InventoryParameter(InventoryParameter.ResultData().setNeedFrequencyPoint(true)),
                    )
                }
            }
        }.getOrDefault(false)
    }

    /**
     * Stop the round, keep what it already heard, and only then let go.
     *
     * # The order is the fix
     *
     * This used to end the poll thread first and send the stop last, and both
     * halves cost something:
     *
     * - Tags the module had already sent sit in the SDK's buffer, survive
     *   `stopInventory`, and are only thrown away by the NEXT start. Ending the
     *   poll thread first left exactly those — the last garments somebody
     *   reached for — in a buffer nobody would read again.
     * - A stop sent to a module that is NOT inventorying waits for a reply that
     *   never comes: five tries of 500 ms, about two and a half seconds, and
     *   the SDK answers true either way. Every release, every visit to Setelan
     *   and both halves of a power change paid it. Now it is only sent while a
     *   round is actually running.
     *
     * So: the stop, if there is a round to stop; then the poll thread drains
     * the buffer and leaves by itself at the first empty look; then it is
     * joined, and only waited for beyond that if the module never goes quiet.
     */
    @Synchronized
    fun stop() {
        val thread = pollThread
        val r = rfid
        if (r != null && runCatching { r.isInventorying }.getOrDefault(true)) {
            runCatching { r.stopInventory() }
        }
        if (thread != null && thread !== Thread.currentThread()) {
            draining = true
            runCatching { thread.join(DRAIN_MS) }
        }
        polling = false
        thread?.interrupt()
        if (thread != null && thread !== Thread.currentThread()) runCatching { thread.join(400) }
        pollThread = null
        draining = false
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

    // ------------------------------------------------------------- the bench
    //
    // Reached only from the Lab, in a bench build. The knobs come from reverse
    // engineering the SDK, and each is a question for the bench rather than an
    // answer: docs/research/2026-10-22-chainway-sdk-knobs.md.

    /**
     * Note what one frame carried. Bench builds only: called on the poll
     * thread for every non-null frame, and it allocates nothing unless a
     * window is armed.
     */
    private fun watch(info: UHFTAGInfo) {
        val dbm = Knobs.rssiOf(info.rssi)
        if (dbm > Knobs.WINDOW_DBM) strongFrames++
        if (startedIn != StartMode.NORMAL) {
            val phase = info.phase
            val mhz = info.frequencyPoint
            if (phase != 0 || mhz != 0f) {
                extraFrames++
                if (phase != 0) lastPhase = phase
                if (mhz != 0f) lastFrequencyMhz = mhz
            }
        }
        rssiWindow?.add(info.getEPC(), dbm)
    }

    /** What the frames since the last start carried. Only the frame count outside a bench build. */
    fun frameStats(): FrameStats =
        FrameStats(startedIn, framesSinceStart, strongFrames, extraFrames, lastPhase, lastFrequencyMhz)

    /**
     * The RSSI of every frame for [ms], mid-round. Not synchronized, like
     * [heardWithin]: it waits.
     */
    fun listen(ms: Long): RssiWindow {
        val window = RssiWindow()
        rssiWindow = window
        try {
            Thread.sleep(ms)
        } catch (interrupted: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            rssiWindow = null
        }
        return window
    }

    /**
     * Move the antenna mid-round, without the re-open [setPower] pays.
     *
     * `setDynamicDistance` sends `30 01 P` and reads no reply
     * (`UHF_SetPowerOnDynamic`), so true only says the bytes left. Whether the
     * antenna moved is what the RSSI either side of it says. What this object
     * believes the power is does not change: [power] still reports the figure
     * applied at open, and the next open applies the chosen one again.
     */
    @Synchronized
    fun setDynamicPower(dbm: Int): Boolean {
        val r = rfid ?: return false
        if (!polling) return false
        val target = dbm.coerceIn(MIN_POWER, MAX_POWER)
        return runCatching {
            logged("setDynamicDistance($target) ${Knobs.dynamicFrame(target)}") {
                r.setDynamicDistance(target)
            }
        }.getOrDefault(false)
    }

    /** A power written raw and still in force, or -1. See [rawPower]. */
    fun rawPowerInForce(): Int = benchRawPower

    /**
     * Ask the open module everything the bench wants to know about it.
     *
     * At rest only, and refused otherwise: mid-round the SDK's reader thread
     * swallows every reply that is not a tag or a stop, so each of these would
     * fail after about a second with this object's lock held. Every figure is
     * the module's own, and nothing this object believes changes.
     */
    @Synchronized
    fun readAtRest(): RestReadout {
        val r = restingModule()
        // `UHFGetPwm` lives on the MTK native class and answers
        // {status, work, wait}. Status 0 is the native call succeeding; the
        // module's own status byte, 01, was checked underneath it.
        val pwm = if (onMtk()) {
            runCatching {
                logged("UHFGetPwm()") { DeviceAPI.getInstance().UHFGetPwm()?.take(3) }
            }.getOrNull()
        } else {
            null
        }
        return RestReadout(
            region = runCatching { logged("getFrequencyMode()") { r.frequencyMode } }.getOrDefault(-1),
            fastInventory = runCatching {
                logged("getFastInventoryMode()") { r.fastInventoryMode?.cr }
            }.getOrNull(),
            pwmStatus = pwm?.getOrNull(0) ?: -1,
            pwmWorkMs = pwm?.getOrNull(1) ?: -1,
            pwmWaitMs = pwm?.getOrNull(2) ?: -1,
            temperature = runCatching { logged("getTemperature()") { r.temperature } }.getOrDefault(-1),
            hardware = runCatching { logged("getHardwareVersion()") { r.hardwareVersion } }.getOrNull(),
            power = runCatching { logged("getPower()") { r.power } }.getOrDefault(-1),
            powerOffReceiver = powerOffReceiverRegistered(),
        )
    }

    /**
     * Write the power raw, with the option byte the SDK never sends. At rest only.
     *
     * `setPower` always sends option 02, which on the R3 means "save". This
     * sends 00 ([Knobs.powerFrame]) through the SDK's raw passthrough, which
     * waits up to 1.2 s for the reply. Status 01 says the module took it, not
     * that it radiates: a sweep straight after says that.
     *
     * Nothing this object believes changes. [power] keeps the figure applied at
     * open, and the next open — [reopen], a cleared filter, a different power —
     * applies the chosen figure again and ends the experiment.
     */
    @Synchronized
    fun rawPower(dbm: Int): RawPower {
        val r = restingModule()
        productionRecipe = false
        check(onMtk()) { "not the MTK SDK path — no raw frames" }
        val target = dbm.coerceIn(MIN_POWER, MAX_POWER)
        val frame = Knobs.powerFrame(target)
        val reply = ByteArray(RAW_REPLY_BYTES)
        val replyLength = IntArray(1)
        val code = runCatching {
            logged("UHFUnvarnishedTransmission(${Knobs.hex(frame)})") {
                DeviceAPI.getInstance().UHFUnvarnishedTransmission(frame, frame.size, reply, replyLength)
            }
        }.getOrDefault(-1)
        // The reply's data, status byte first, read the way the SDK's own raw
        // getter reads it.
        val status = if (code == 0 && replyLength[0] >= 1) reply[0].toInt() and 0xFF else -1
        if (status == 1) benchRawPower = target
        val readBack = runCatching { logged("getPower()") { r.power } }.getOrDefault(-1)
        return RawPower(target, Knobs.hex(frame), code, status, readBack)
    }

    /**
     * Close the module and open it again, at the chosen power and profile: a
     * cold boot, and the way back from every experiment above.
     */
    @Synchronized
    fun reopen(): String {
        val context = appContext ?: error("the module was never opened")
        stop()
        runCatching { rfid?.free() }
        rfid = null
        appliedPower = -1
        appliedMode = -1
        return init(context)
    }

    /**
     * Keep the module when another app asks every UHF app to let go. Off unless
     * a bench turns it on, and never saved.
     *
     * The SDK registers `UhfBase.PowerOffReceiver` on every open, exported
     * (`RECEIVER_EXPORTED` on API 34+). Any `UHF_POWER_OFF` broadcast whose
     * `apiId` is not ours — or that carries none — makes this instance `free()`
     * itself, and a free powers the module off. On, the receiver is
     * unregistered now and after every open. Off, it is registered again now:
     * the SDK's own behaviour. While it is on, another UHF app cannot make
     * this one let go.
     *
     * Returns whether the receiver is registered afterwards; null when unknown.
     */
    @Synchronized
    fun setIgnorePowerOff(on: Boolean): Boolean? {
        ignorePowerOff = on
        if (held() != null) {
            if (on) dropPowerOffReceiver() else restorePowerOffReceiver()
        }
        return powerOffReceiverRegistered()
    }

    /** Whether the SDK's UHF_POWER_OFF receiver is registered right now; null when unknown. */
    fun powerOffReceiverRegistered(): Boolean? {
        val core = sdkCore() ?: return null
        return runCatching { uhfBaseField("powerOffReceiver").get(core) != null }.getOrNull()
    }

    /**
     * The last `UHF_StopGet: okcnt=…` the SDK logged, read from this app's own
     * log, which an app may read without any permission. Blocking.
     */
    fun lastStopCounts(): Pair<Int, Int>? = runCatching {
        val process = ProcessBuilder("logcat", "-d", "-t", OWN_LOG_LINES.toString())
            .redirectErrorStream(true)
            .start()
        val text = process.inputStream.bufferedReader().use { it.readText() }
        process.waitFor()
        Knobs.stopCounts(text)
    }.getOrNull()

    /** The open module, at rest — or a refusal that says why not. */
    private fun restingModule(): RFIDWithUHFUART {
        val r = held() ?: error("the module is not open")
        check(!polling && !runCatching { r.isInventorying }.getOrDefault(true)) {
            "stop the sweep first — mid-round the SDK eats the reply"
        }
        return r
    }

    /**
     * The object the SDK really runs on. `RFIDWithUHFUART` only forwards to a
     * private static delegate — on a C5, `com.rscja.team.mtk.deviceapi.m` —
     * and it is the delegate that registered the receivers, holds the context
     * it was opened with, and frees itself.
     */
    private fun sdkCore(): UhfBase? = runCatching {
        RFIDWithUHFUART::class.java.getDeclaredField("iuhf")
            .apply { isAccessible = true }
            .get(null) as? UhfBase
    }.getOrNull()

    /** The MTK native class answers only on the MTK path. */
    private fun onMtk(): Boolean = sdkCore()?.javaClass?.name?.startsWith(MTK_PACKAGE) == true

    private fun uhfBaseField(name: String) =
        UhfBase::class.java.getDeclaredField(name).apply { isAccessible = true }

    private fun dropPowerOffReceiver(): Boolean = receiverCall("unregisterUhfPowerOffReceiver")

    private fun restorePowerOffReceiver(): Boolean = receiverCall("registerUhfPowerOffReceiver")

    /**
     * One of `UhfBase`'s protected receiver methods, on the delegate, with the
     * context it was opened with: a receiver is unregistered through the same
     * context that registered it.
     */
    private fun receiverCall(method: String): Boolean {
        val core = sdkCore() ?: return false
        val context = runCatching { uhfBaseField("context").get(core) as? Context }.getOrNull()
            ?: appContext ?: return false
        return runCatching {
            logged("$method(${core.javaClass.simpleName})") {
                UhfBase::class.java.getDeclaredMethod(method, Context::class.java)
                    .apply { isAccessible = true }
                    .invoke(core, context)
                true
            }
        }.getOrDefault(false)
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

        /**
         * How long [stop] lets the poll thread empty the SDK's buffer. A buffer
         * empties in milliseconds; this only bounds a module that never goes
         * quiet because its stop did not take.
         */
        private const val DRAIN_MS = 1_000L

        /** How often [heardWithin] looks for the first frame. */
        private const val PROOF_POLL_MS = 20L

        /** The reply buffer the SDK's own raw getter allocates for the passthrough. */
        private const val RAW_REPLY_BYTES = 512

        /** Where the SDK's MTK classes live; the C5 runs on them. */
        private const val MTK_PACKAGE = "com.rscja.team.mtk."

        /** How far back [lastStopCounts] looks in this app's own log. */
        private const val OWN_LOG_LINES = 4_000

        /**
         * A setter that takes this long has not been refused, it has gone
         * unanswered: the SDK's own timeout is about 1.2 s, and an answer is a
         * matter of milliseconds.
         */
        private const val UNANSWERED_MS = 1_000L
    }
}
