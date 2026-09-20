package id.itulah.pindai.core

import android.content.Context
import com.rscja.barcode.BarcodeDecoder
import com.rscja.barcode.BarcodeFactory
import com.rscja.barcode.BarcodeUtility

/**
 * The 2D imager, for the garments RFID cannot answer for.
 *
 * # Why this exists next to a working RFID reader
 *
 * A tag can be dead, missing, or buried in a bale nobody wants to open. The
 * label under it still carries the same identity as a QR — `R1:<sku>` — and a
 * barcode — `8<sku>`. An operator who cannot read the tag can read the label,
 * and the alternative is a garment that goes uncounted because its tag lost an
 * argument with a hanger.
 *
 * # What a label is NOT
 *
 * It is not a unit. An EPC names one physical garment out of the thousands
 * carrying that SKU; a QR names the SKU and nothing else, so two scans of two
 * different shirts and two scans of the SAME shirt are indistinguishable.
 * Counting labels is therefore counting somebody's intention, not counting
 * stock, and this app keeps the two apart everywhere they meet — see
 * [ScanEngine.offerLabel].
 */
class Barcode {

    @Volatile private var decoder: BarcodeDecoder? = null
    @Volatile private var open = false

    /** Kept so [close] can put the device's scanner settings back. See [announce]. */
    @Volatile private var appContext: Context? = null

    val isOpen: Boolean get() = open

    /**
     * Open the imager.
     *
     * Deliberately separate from [Reader]: the two are different pieces of
     * hardware behind different vendor APIs, and on this handheld they are also
     * different answers to "what is in front of me". Opening one does not
     * disturb the other.
     */
    @Synchronized
    fun init(context: Context): Boolean {
        decoder?.let { return open }
        val instance = runCatching { BarcodeFactory.getInstance().barcodeDecoder }
            .getOrElse { return false }
        val opened = runCatching { instance.open(context.applicationContext) }
            .getOrDefault(false)
        if (opened) {
            decoder = instance
            open = true
            appContext = context.applicationContext
            announce(context, on = true)
        }
        return opened
    }

    /**
     * Ask the handheld's own scanner service to sound and buzz on a decode.
     *
     * # Why this and not a sound of our own
     *
     * A label is one shot, and every scanner anybody has ever held answers a
     * shot with a click. This is the C5's own — the same beep and the same
     * buzz its other apps make — so an operator recognises it as "read" without
     * being taught. The RFID sweep is a different problem and keeps its own
     * sound: a beep per tag, forty times a second, is not feedback.
     *
     * Chainway's own 2D sample puts exactly these three calls beside
     * `barcodeDecoder.open()`, on the same `setDecodeCallback` path this class
     * uses. They are commented out there, so the vendor shows the wiring
     * without proving it fires on this path — see TESTING.md. If it turns out
     * the system service only sounds for scans IT performed, the fallback is
     * `res/raw/scan_beep.wav`, already in the tree for that reason.
     *
     * # This is a DEVICE setting, not an app setting
     *
     * These are broadcasts to the system scanner service, so they change the
     * handheld for every app on it and they persist after ours exits. That is
     * why [close] puts them back: leaving a shop's scanner permanently altered
     * because a stock count ran once is not ours to do.
     */
    private fun announce(context: Context, on: Boolean) {
        val app = context.applicationContext
        val utility = runCatching { BarcodeUtility.getInstance() }.getOrNull() ?: return
        runCatching { utility.enablePlaySuccessSound(app, on) }
        runCatching { utility.enablePlayFailureSound(app, on) }
        runCatching { utility.enableVibrate(app, on) }
    }

    /**
     * How many times this imager has been ASKED to scan, and what came back.
     *
     * # Why a counter, for a thing that should just work
     *
     * "The trigger does nothing in Labels mode" has two causes that look
     * identical from in front of the screen, and the app could not tell them
     * apart: either the key never reached us at all, or it reached us, started
     * a scan, and the scan found nothing. Both leave the screen unchanged —
     * the note is only written on refusal, and a scan that starts cleanly and
     * decodes nothing is silent by design.
     *
     * So the ask is counted separately from the outcome. If [requested] does
     * not move when somebody pulls the trigger, the key never got here and the
     * problem is upstream of this class. If it moves and [lastOutcome] says
     * `started`, the imager is working and the label is not being read. That is
     * one number and one word, and it turns a guess into a reading.
     */
    @Volatile var requested: Int = 0
        private set

    @Volatile var lastOutcome: String = "not asked yet"
        private set

    /**
     * Take one shot, and hand back whatever it read.
     *
     * One shot, not continuous: an imager is a torch pointed at a label, and a
     * torch left on is a flat battery. [onResult] fires once per successful
     * decode; a timeout is silence, which is the correct report for "the
     * operator pointed it at nothing".
     *
     * Every exit writes [lastOutcome] before it returns. The old version
     * swallowed a failed `setDecodeCallback` in a bare `runCatching` and
     * reported only `startScan`'s boolean, so a decoder that refused its
     * callback looked exactly like one that was working.
     */
    @Synchronized
    fun scanOnce(onResult: (String) -> Unit): Boolean {
        requested++
        val active = decoder ?: run {
            lastOutcome = "closed — the imager was never opened"
            return false
        }
        val armed = runCatching {
            active.setDecodeCallback { entity ->
                lastOutcome = when {
                    entity == null -> "decode returned nothing"
                    entity.resultCode == BarcodeDecoder.DECODE_SUCCESS ->
                        "decoded " + entity.barcodeData.orEmpty().take(24)
                    // The SDK's own vocabulary, so a timeout is not read as a
                    // failure and a failure is not read as an empty aisle.
                    entity.resultCode == BarcodeDecoder.DECODE_TIMEOUT -> "timed out — nothing in view"
                    entity.resultCode == BarcodeDecoder.DECODE_CANCEL -> "cancelled"
                    entity.resultCode == BarcodeDecoder.DECODE_ENGINE_ERROR -> "engine error"
                    else -> "no read (code ${entity.resultCode})"
                }
                if (entity != null && entity.resultCode == BarcodeDecoder.DECODE_SUCCESS) {
                    entity.barcodeData?.takeIf { it.isNotBlank() }?.let(onResult)
                }
            }
        }.isSuccess
        if (!armed) {
            lastOutcome = "the decoder refused its callback"
            return false
        }
        val started = runCatching { active.startScan() }.getOrDefault(false)
        lastOutcome = if (started) "started — waiting for a decode" else "startScan() refused"
        return started
    }

    /** One line saying what this imager has been asked and what it answered. */
    fun diagnostics(): String =
        "imager " + (if (open) "open" else "closed") + " · asked $requested · $lastOutcome"

    @Synchronized
    fun stop() {
        runCatching { decoder?.stopScan() }
    }

    @Synchronized
    fun close() {
        runCatching { decoder?.stopScan() }
        // Hand the device back the way we found it BEFORE letting go of the
        // decoder: these settings outlive this process, and a handheld left
        // beeping in every other app because our label mode ran once is a
        // change nobody asked for and nobody would connect to us.
        appContext?.let { announce(it, on = false) }
        appContext = null
        runCatching { decoder?.close() }
        decoder = null
        open = false
    }
}

/**
 * What a printed label says, turned into the SKU it names.
 *
 * Three spellings reach this, and all three are the estate's own:
 *
 * ```
 * R1:00000007203   the QR printed on a hang tag
 * 800000007203     the barcode under it
 * 00000007203      the SKU itself, for a label that carries nothing else
 * ```
 *
 * Anything else is refused rather than guessed at. A supplier's own barcode on
 * a poly bag is a real thing to scan by accident, and turning eleven of its
 * digits into one of our SKUs would put a garment we do not own into a count.
 */
object Label {
    private const val SKU_LEN = 11
    private const val QR_PREFIX = "R1:"
    private const val BARCODE_PREFIX = "8"

    fun toSku(raw: String): String? {
        val text = raw.trim()
        val candidate = when {
            text.startsWith(QR_PREFIX) -> text.removePrefix(QR_PREFIX)
            text.length == SKU_LEN + 1 && text.startsWith(BARCODE_PREFIX) -> text.substring(1)
            else -> text
        }
        if (candidate.length != SKU_LEN) return null
        if (!candidate.all { it in '0'..'9' }) return null
        return candidate
    }
}
