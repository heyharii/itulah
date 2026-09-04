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
) {
    val isConfigured: Boolean
        get() = baseUrl.isNotBlank() && siteId.isNotBlank() &&
            deviceId.isNotBlank() && deviceKey.isNotBlank() && pool.isNotBlank()
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
    )

    fun save(s: Settings) {
        prefs.edit()
            .putString(K_URL, s.baseUrl.trim().trimEnd('/'))
            .putString(K_SITE, s.siteId.trim())
            .putString(K_DEV, s.deviceId.trim())
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

    private companion object {
        const val K_URL = "base_url"; const val K_SITE = "site_id"
        const val K_DEV = "device_id"; const val K_KEY = "device_key"
        const val K_POOL = "pool"; const val K_TOKEN = "operator_token"
        const val K_SESSION = "session_code"; const val K_POWER = "reader_power"
    }
}
