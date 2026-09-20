package id.itulah.pindai.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Where this handheld points and what it may prove about itself.
 *
 * The base URL is set here rather than compiled in: the same build serves a DC
 * and a shop, and which one a device belongs to is a deployment fact, not a
 * code fact. `siteId` and the pools follow from that choice.
 */
data class Settings(
    val baseUrl: String = "",
    val siteId: String = "",
    val deviceId: String = "",
    val deviceKey: String = "",
    val pool: String = "",
    val operatorToken: String = "",
    /** The shared reading session this handheld is helping with, if any. */
    val sessionCode: String = "",
    /**
     * Antenna power in dBm, or 0 while nobody has chosen and the reader should
     * take as much as the module will give.
     *
     * This one is not a deployment fact like the rest. Power is a floor
     * decision — a shop counting its own rail at 30 dBm reads the stockroom
     * through the wall — so it is expected to move, and it is kept here only
     * so that it survives the walk back to the charger.
     */
    val readerPower: Int = 0,
    /**
     * The newest wall-clock second at which this device successfully filed.
     *
     * Kept because the Edge remembers a `last_sequence` per device forever and
     * refuses anything at or below it, and because it checks the signature's
     * timestamp against a five-minute window in both directions. A handheld
     * whose RTC resets after a flat battery — exactly the accident the evidence
     * spool exists for — therefore fails both checks at once, and no
     * bookkeeping on this side can talk its way past either. This watermark is
     * how the app knows that is what happened, rather than retrying into a
     * wall and calling it a network problem.
     */
    val clockWatermark: Long = 0,
    /**
     * The keycode this handheld's trigger actually sends.
     *
     * Not a constant, because it is not constant: C5 firmware has been seen to
     * report 139, 280, 293, 294 and 311 for the same physical button. Setelan
     * learns it from one pull rather than guessing, and 0 means nothing has
     * been learned yet and the built-in candidates apply.
     */
    val triggerKeyCode: Int = 0,
    /**
     * The radio configuration the floor chose, kept the way power is kept.
     *
     * Held in memory alone, these were lost to an app restart or a night on the
     * charging shelf — and the screen went on reporting them as set. Power has
     * survived that walk since the beginning; there was never a reason these
     * should not.
     */
    val tagFocus: Boolean = true,
    val gen2Session: Int = RadioProfile.SESSION,
    /**
     * The Gen2 link mode, or -1 while nobody has pinned one.
     *
     * Kept for a reason the others do not share: the MODULE remembers this one
     * on its own, so leaving it unset does not mean "default", it means
     * "whatever the last person set". Pinning it is how two mornings produce
     * the same reader.
     */
    val rfLink: Int = RadioProfile.RF_LINK,
) {
    val isConfigured: Boolean
        get() = baseUrl.isNotBlank() && siteId.isNotBlank() &&
            deviceId.isNotBlank() && deviceKey.isNotBlank() && pool.isNotBlank()
}

/**
 * The radio this app ships with, and why each number is that number.
 *
 * These are defaults, not policy the floor cannot change — the bench overrides
 * every one of them. They exist because the alternative is not "no setting": an
 * E710 keeps its link mode across a restart, so a handheld nobody configures
 * runs in whatever mode the last person left behind. This project measured a
 * whole night in a Gen2X mode it did not know was set.
 *
 * Every figure here was measured on a C5 against the same bundle of tags, and
 * the measurements are written up in `handheld/SCAN-REDESIGN.md`.
 */
object RadioProfile {
    /**
     * Gen2, Miller4, 250 kHz.
     *
     * All six Gen2 modes read the same population (58-60 tags). All six Gen2X
     * modes read exactly 11 of our 31 — identically at every data rate, which is
     * the signature of a population that cannot answer rather than a link that
     * cannot reach. Gen2X is the better protocol on tags that implement it; this
     * estate's tags do not all implement it yet.
     */
    const val RF_LINK = 1

    /**
     * S1 — the only session Tag Focus can work in.
     *
     * S0 keeps no inventoried flag at all, so Tag Focus there is a setting with
     * nothing to act on. S2 and S3 hold their flag far longer than a handheld
     * sweep, which is what fixed portal readers want and what makes a second
     * count of the same rack return almost nothing.
     */
    const val SESSION = 1

    /** Target A. The B population is what an inventoried tag moves INTO. */
    const val TARGET = 0

    /**
     * Tag Focus on.
     *
     * Ten measured pairs: a third of the radio traffic, a fifteenth of the
     * malformed reads, and not one tag lost — on an open desk and on a bundle
     * bound with a rubber band.
     */
    const val TAG_FOCUS = true

    /**
     * FastID off.
     *
     * It concatenates the TID onto every EPC, and 28 % of the population cannot
     * finish the longer reply — 58 tags become 42. It is how this app answers
     * "whose silicon is this", and it is never how it counts.
     */
    const val FAST_ID = false
}

class ConfigStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("itulah-pindai", Context.MODE_PRIVATE)

    fun load() = Settings(
        baseUrl = prefs.getString(K_URL, "").orEmpty(),
        siteId = prefs.getString(K_SITE, "").orEmpty(),
        deviceId = prefs.getString(K_DEV, "").orEmpty(),
        deviceKey = prefs.getString(K_KEY, "").orEmpty(),
        pool = prefs.getString(K_POOL, "").orEmpty(),
        operatorToken = prefs.getString(K_TOKEN, "").orEmpty(),
        sessionCode = prefs.getString(K_SESSION, "").orEmpty(),
        readerPower = prefs.getInt(K_POWER, 0),
        clockWatermark = prefs.getLong(K_CLOCK, 0L),
        triggerKeyCode = prefs.getInt(K_TRIGGER, 0),
        tagFocus = prefs.getBoolean(K_FOCUS, true),
        gen2Session = prefs.getInt(K_SESSION_N, RadioProfile.SESSION),
        rfLink = prefs.getInt(K_RFLINK, RadioProfile.RF_LINK),
    )

    fun save(s: Settings) {
        prefs.edit()
            .putString(K_URL, s.baseUrl.trim().trimEnd('/'))
            .putString(K_SITE, s.siteId.trim())
            // Upper case, because the Edge normalises before it signs.
            //
            // `edge/rfid.rs` upper-cases the device id and computes the HMAC
            // over the normalised form; this client signs the raw text from the
            // form. Commission a handheld by typing "c5-dc-01" and every batch
            // it ever files is refused with "invalid RFID device signature" — a
            // message that sends whoever reads it hunting for a wrong key.
            .putString(K_DEV, s.deviceId.trim().uppercase())
            .putString(K_KEY, s.deviceKey.trim())
            .putString(K_POOL, s.pool.trim())
            .putString(K_TOKEN, s.operatorToken.trim())
            .putString(K_SESSION, s.sessionCode.trim())
            .putInt(K_POWER, s.readerPower)
            .apply()
    }

    /**
     * Keep a power without keeping anything else.
     *
     * The settings screen holds a whole form of half-typed text until Save; a
     * slider that has already changed the antenna must not wait for that button,
     * and must not drag the rest of the form along when it does not.
     */
    fun saveReaderPower(dbm: Int) {
        prefs.edit().putInt(K_POWER, dbm).apply()
    }

    /**
     * The highest device sequence this handheld has ever signed with.
     *
     * The Edge keeps a `last_sequence` per device forever and refuses anything
     * at or below it. Our counter used to start from the wall clock inside each
     * `Api` instance — and a drain of eight batches runs the sequence eight
     * seconds ahead of the clock, so the NEXT drain, two seconds later, starts
     * behind what the Edge has already seen and every batch in it is refused.
     * An app restart did the same thing.
     *
     * That is very likely why an outbox with two dozen batches in it sat there
     * all evening while the endpoint answered a hand-written probe perfectly.
     */
    fun sequenceWatermark(): Long = prefs.getLong(K_SEQ, 0L)

    fun saveSequenceWatermark(seq: Long) {
        if (seq > prefs.getLong(K_SEQ, 0L)) {
            prefs.edit().putLong(K_SEQ, seq).apply()
        }
    }

    /** Only ever moves forward, so a reset clock cannot erase the evidence of itself. */
    fun saveClockWatermark(epochSeconds: Long) {
        if (epochSeconds > prefs.getLong(K_CLOCK, 0L)) {
            prefs.edit().putLong(K_CLOCK, epochSeconds).apply()
        }
    }

    /** Remember the radio configuration, separately from the settings form. */
    fun saveRadio(tagFocus: Boolean, session: Int) {
        prefs.edit().putBoolean(K_FOCUS, tagFocus).putInt(K_SESSION_N, session).apply()
    }

    /** Remember the link mode, which the module would otherwise decide for us. */
    fun saveRfLink(mode: Int) {
        prefs.edit().putInt(K_RFLINK, mode).apply()
    }

    fun saveTriggerKeyCode(keyCode: Int) {
        prefs.edit().putInt(K_TRIGGER, keyCode).apply()
    }

    private companion object {
        const val K_URL = "base_url"; const val K_SITE = "site_id"
        const val K_DEV = "device_id"; const val K_KEY = "device_key"
        const val K_POOL = "pool"; const val K_TOKEN = "operator_token"
        const val K_SESSION = "session_code"; const val K_POWER = "reader_power"
        const val K_CLOCK = "clock_watermark"; const val K_TRIGGER = "trigger_keycode"
        const val K_SEQ = "sequence_watermark"
        const val K_FOCUS = "tag_focus"; const val K_SESSION_N = "gen2_session"
        const val K_RFLINK = "rf_link"
    }
}
