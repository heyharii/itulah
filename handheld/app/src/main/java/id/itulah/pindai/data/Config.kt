package id.itulah.pindai.data

import android.content.Context
import android.content.SharedPreferences
import id.itulah.pindai.BuildConfig
import id.itulah.pindai.core.RadioRecipe

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
    /** Fixed production power; a Lab build may override it in memory. */
    val readerPower: Int = RadioProfile.POWER_DBM,
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
    /** Effective recipe. Old radio preferences are intentionally ignored. */
    val tagFocus: Boolean = RadioProfile.TAG_FOCUS,
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

/** Compatibility names for the single, versioned production recipe. */
object RadioProfile {
    const val ID = RadioRecipe.ID
    const val POWER_DBM = RadioRecipe.POWER_DBM
    const val RF_LINK = RadioRecipe.RF_LINK
    const val SESSION = RadioRecipe.SESSION
    const val TARGET = RadioRecipe.TARGET
    const val TAG_FOCUS = RadioRecipe.TAG_FOCUS
    const val FAST_ID = RadioRecipe.FAST_ID
}

class ConfigStore internal constructor(
    private val prefs: SharedPreferences,
    private val bench: Boolean,
) {
    constructor(context: Context) : this(
        context.getSharedPreferences("itulah-pindai", Context.MODE_PRIVATE), BuildConfig.BENCH,
    )

    // Lab choices live in memory only. Old per-phone radio preferences are never loaded.
    @Volatile private var radio = Settings()

    fun load() = Settings(
        baseUrl = prefs.getString(K_URL, "").orEmpty(),
        siteId = prefs.getString(K_SITE, "").orEmpty(),
        deviceId = prefs.getString(K_DEV, "").orEmpty(),
        deviceKey = prefs.getString(K_KEY, "").orEmpty(),
        pool = prefs.getString(K_POOL, "").orEmpty(),
        operatorToken = prefs.getString(K_TOKEN, "").orEmpty(),
        sessionCode = prefs.getString(K_SESSION, "").orEmpty(),
        readerPower = radio.readerPower,
        clockWatermark = prefs.getLong(K_CLOCK, 0L),
        triggerKeyCode = prefs.getInt(K_TRIGGER, 0),
        tagFocus = radio.tagFocus,
        gen2Session = radio.gen2Session,
        rfLink = radio.rfLink,
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
            .apply()
    }

    /** A Lab power override, never persisted or accepted in a production build. */
    fun saveReaderPower(dbm: Int) {
        if (bench) radio = radio.copy(readerPower = dbm)
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

    /** A Lab inventory override, reset at the next app launch. */
    fun saveRadio(tagFocus: Boolean, session: Int) {
        if (bench) radio = radio.copy(tagFocus = tagFocus, gen2Session = session)
    }

    /** A Lab link override. The production recipe replaces it at the next launch. */
    fun saveRfLink(mode: Int) {
        if (bench) radio = radio.copy(rfLink = mode)
    }

    fun saveTriggerKeyCode(keyCode: Int) {
        prefs.edit().putInt(K_TRIGGER, keyCode).apply()
    }

    private companion object {
        const val K_URL = "base_url"; const val K_SITE = "site_id"
        const val K_DEV = "device_id"; const val K_KEY = "device_key"
        const val K_POOL = "pool"; const val K_TOKEN = "operator_token"
        const val K_SESSION = "session_code"
        const val K_CLOCK = "clock_watermark"; const val K_TRIGGER = "trigger_keycode"
        const val K_SEQ = "sequence_watermark"
    }
}
