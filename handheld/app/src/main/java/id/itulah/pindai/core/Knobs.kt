package id.itulah.pindai.core

import java.util.Locale

/**
 * How a round is started: the two bytes after command 82.
 *
 * Bench only. The floor always starts [NORMAL], and nothing saves a choice, so
 * every launch starts there too.
 *
 * # Why the other two exist
 *
 * In EPC-only mode — ours — `UHF_GetReceived_EX` drops every tag frame outside
 * −120..−25 dBm, without a log line and without an error code. A tag pressed
 * against the antenna is the one tag this reader cannot hear. A frame that
 * carries extra bytes takes the one branch of that function that has no RSSI
 * window, and these two starts ask the firmware for extra bytes: two of phase,
 * or three of frequency point.
 *
 * Whether firmware E710_V7.10.1 appends them is the open bench question. A
 * non-zero phase or frequency on a frame is the proof that it does; a frame
 * stronger than −25 dBm is the proof that the window was escaped.
 */
enum class StartMode(val label: String, val frame: String) {
    NORMAL("Normal", "82 00 00"),
    PHASE("Phase", "82 FF FF"),
    FREQUENCY("Freq", "82 FF FE"),
}

/** What the tag frames since one start carried. Bench builds only; see [Reader.frameStats]. */
data class FrameStats(
    val mode: StartMode,
    /** Non-null frames the SDK handed over: what [Reader.heardWithin] waits on. */
    val frames: Long,
    /** Frames stronger than −25 dBm: every one is a frame the native window would have dropped. */
    val strong: Long,
    /** Frames carrying a non-zero phase or frequency point: the firmware appended the bytes. */
    val extras: Long,
    /** The last non-zero phase: a raw big-endian u16, undecoded. */
    val lastPhase: Int,
    /** The last non-zero frequency point, in MHz. */
    val lastFrequencyMhz: Float,
)

/** The module, asked at rest. Bench only; see [Reader.readAtRest]. */
data class RestReadout(
    /** `getFrequencyMode()`: the module's raw region code; -1 when unreadable. */
    val region: Int,
    /** `getFastInventoryMode().getCr()`; null when unreadable. */
    val fastInventory: Int?,
    /** `UHFGetPwm()[0]`. 0 is OK: the native return code, not the reply's status byte. */
    val pwmStatus: Int,
    val pwmWorkMs: Int,
    val pwmWaitMs: Int,
    /** °C. -1 is also the SDK's own failure value. */
    val temperature: Int,
    val hardware: String?,
    /** `getPower()`, read back. */
    val power: Int,
    /** Whether the SDK's UHF_POWER_OFF receiver is registered; null when unknown. */
    val powerOffReceiver: Boolean?,
)

/** One raw power write and what came back. Bench only; see [Reader.rawPower]. */
data class RawPower(
    val dbm: Int,
    /** The frame sent, as hex. */
    val frame: String,
    /** What the passthrough returned: 0 when a reply came at all. */
    val code: Int,
    /** The reply's status byte, 1 when the module took it; -1 when there was no reply. */
    val status: Int,
    /** `getPower()` straight after. */
    val readBack: Int,
)

/**
 * The RSSI of every frame over one short window, in all and per tag. Bench only.
 *
 * Per tag because a power change does two things at once: the tags still in
 * the field answer quieter, and the far ones leave it. The far ones are the
 * weak ones, so a mean over every tag RISES when the power falls. The tag
 * compared before and after is therefore one tag — the one heard most.
 */
class RssiWindow {
    private val byEpc = HashMap<String, DoubleArray>()
    private var sum = 0.0
    private var count = 0

    /** One frame. NaN — "N/A", or nothing — is not a reading. */
    @Synchronized
    fun add(epc: String?, dbm: Float) {
        if (dbm.isNaN()) return
        sum += dbm
        count++
        if (epc.isNullOrBlank()) return
        val acc = byEpc.getOrPut(epc) { DoubleArray(2) }
        acc[0] += dbm
        acc[1] += 1.0
    }

    @Synchronized
    fun reads(): Int = count

    @Synchronized
    fun mean(): Float = if (count == 0) Float.NaN else (sum / count).toFloat()

    /** The tag with the most readings, or null when nothing was heard. */
    @Synchronized
    fun busiest(): String? = byEpc.maxByOrNull { it.value[1] }?.key

    @Synchronized
    fun readsOf(epc: String): Int = byEpc[epc]?.get(1)?.toInt() ?: 0

    @Synchronized
    fun meanOf(epc: String): Float = byEpc[epc]?.let { (it[0] / it[1]).toFloat() } ?: Float.NaN
}

/**
 * The vendor SDK's bench knobs: the parts that are arithmetic, kept apart from
 * the radio so a laptop can test them.
 *
 * Read out of DeviceAPI_ver20251103 by reverse engineering: javap on the
 * classes, REA + Ghidra and objdump on `libDeviceAPIM.so` (the MTK path). The
 * evidence is in `docs/research/2026-10-22-chainway-sdk-knobs.md`.
 */
object Knobs {

    /**
     * The edge of the native window. In EPC-only mode a frame stronger than
     * this never leaves `UHF_GetReceived_EX`.
     */
    const val WINDOW_DBM = -25f

    /**
     * "-48.30" → −48.3, without allocating: this runs for every new tag's
     * evidence ([ScanEngine]), and on a bench for every frame.
     *
     * The SDK formats RSSI with `DecimalFormat("##0.00")` in the device's own
     * locale, so a handheld set to Indonesian writes "-48,30". Both separators
     * are read. "N/A" — what the SDK writes outside 0..200 — and anything else
     * is NaN.
     */
    fun rssiOf(s: String?): Float {
        if (s.isNullOrEmpty()) return Float.NaN
        val negative = s[0] == '-'
        var i = if (negative) 1 else 0
        var whole = 0
        var fraction = 0
        var scale = 1
        var digits = 0
        var point = false
        while (i < s.length) {
            val c = s[i]
            when {
                c in '0'..'9' -> {
                    if (!point) {
                        whole = whole * 10 + (c - '0')
                        if (whole > 10_000) return Float.NaN
                    } else if (scale < 10_000) {
                        fraction = fraction * 10 + (c - '0')
                        scale *= 10
                    }
                    digits++
                }
                (c == '.' || c == ',') && !point -> point = true
                else -> return Float.NaN
            }
            i++
        }
        if (digits == 0) return Float.NaN
        val value = whole + fraction.toFloat() / scale
        return if (negative) -value else value
    }

    /**
     * `setPower` as the SDK sends it, but with option byte 00 where the SDK
     * always sends 02: `10 [00][01][RP][RP][WP][WP]`, each power dBm×100,
     * big-endian.
     *
     * On the R3 the same command's option byte is the save flag — 02 to save,
     * 00 not to — and the C5's `UHF_SetPower` hard-codes 02. So every power
     * change this app makes is probably a write to the module's flash, and
     * this frame is how to find out whether the 00 variant radiates.
     */
    fun powerFrame(dbm: Int): ByteArray {
        val centi = dbm * 100
        val hi = (centi shr 8 and 0xFF).toByte()
        val lo = (centi and 0xFF).toByte()
        return byteArrayOf(0x10, 0x00, 0x01, hi, lo, hi, lo)
    }

    /** The frame `setDynamicDistance` sends, for the call log. It reads no reply. */
    fun dynamicFrame(dbm: Int): String = String.format(Locale.ROOT, "30 01 %02X", dbm and 0xFF)

    fun hex(bytes: ByteArray): String =
        bytes.joinToString(" ") { String.format(Locale.ROOT, "%02X", it.toInt() and 0xFF) }

    /**
     * A region code, named from the vendor's own table.
     *
     * The names are the vendor demo's (`UHFAPP.ConfigForm`). The C5 reads the
     * module's raw code back for every code 10 and above, so 0x3F reads 63.
     * Five codes cannot be told apart from their aliases: the SDK maps raw
     * 00, 05, 06, 07 and 09 through its own index and back, and they read as
     * 02, 16, 32, 80 and 34.
     *
     * Read-only on purpose: nothing in this app writes a region until the band
     * Indonesia allows these devices is confirmed.
     */
    fun regionName(code: Int): String {
        if (code < 0) return "unreadable"
        val name = REGIONS[code] ?: "not in the vendor table"
        val alias = ALIASES[code]?.let { String.format(Locale.ROOT, " · or raw 0x%02X", it) }.orEmpty()
        return String.format(Locale.ROOT, "0x%02X · ", code) + name + alias
    }

    /**
     * The last `UHF_StopGet: okcnt=…, GetTagCount=…` in a log dump, as the
     * pair; null when there is none.
     *
     * The native layer writes it at every stop, and it is the only count of
     * frames the reader thread took in — so the frames the window dropped are
     * the difference between it and what reached this app. See [dropped].
     */
    fun stopCounts(log: String): Pair<Int, Int>? {
        val line = STOP_LINE.findAll(log).lastOrNull() ?: return null
        val ok = line.groupValues[1].toIntOrNull() ?: return null
        val got = line.groupValues[2].toIntOrNull() ?: return null
        return ok to got
    }

    /** Frames the SDK took in and never handed over: okcnt − frames − 1, the one being a bogus frame per stop. */
    fun dropped(okcnt: Int, frames: Long): Long = (okcnt - frames - 1).coerceAtLeast(0)

    private val STOP_LINE = Regex("""UHF_StopGet: okcnt=(\d+), GetTagCount=(\d+)""")

    /** Code → label, from the vendor demo's region list. */
    private val REGIONS = mapOf(
        0x01 to "China Standard1 840–845",
        0x02 to "China Standard2 920–925",
        0x04 to "Europe 865–868",
        0x08 to "USA 902–928",
        0x16 to "Korea 917–923",
        0x32 to "Japan 916.8–920.8",
        0x33 to "South Africa 915–919",
        0x34 to "China Taiwan 920–928",
        0x35 to "Vietnam 918–923",
        0x36 to "Peru 915–928",
        0x37 to "Russia 860–867.6",
        0x3B to "Malaysia 919–923",
        0x3C to "Brazil",
        0x3D to "ETSI_UPPER 915–921",
        0x3E to "Australia 920–926",
        0x3F to "Indonesia 920–923",
        0x40 to "Israel 915–917",
        0x41 to "HK 920–925",
        0x42 to "New Zealand 920–928",
        0x43 to "880–930",
        0x44 to "Singapore",
    )

    /** A read-back of the key may really be the raw value: the SDK's index maps both to it. */
    private val ALIASES = mapOf(0x02 to 0x00, 0x16 to 0x05, 0x32 to 0x06, 0x80 to 0x07, 0x34 to 0x09)
}
