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
            .apply()
    }

    private companion object {
        const val K_URL = "base_url"; const val K_SITE = "site_id"
        const val K_DEV = "device_id"; const val K_KEY = "device_key"
        const val K_POOL = "pool"; const val K_TOKEN = "operator_token"
        const val K_SESSION = "session_code"
    }
}
