package id.itulah.kasir.data

import android.content.Context

/**
 * What this tablet is, and what it is plugged into.
 *
 * Four kinds of fact live here and they change at four different rates. The
 * node URL and the terminal id are set once at commissioning — which counter
 * this tablet is standing at is a deployment fact, not a code fact, so one APK
 * serves every till in the estate. The printer is a shop fact that moves when
 * the hardware moves. Reader power is a floor decision, expected to change
 * during a shift. The session token is the only one that expires by itself.
 */
data class Config(
    /** Origin of the store-edge node, e.g. `http://192.168.1.10:8081`. */
    val nodeUrl: String = "",
    /**
     * Which till this is.
     *
     * The database enforces one open shift per terminal with a partial unique
     * index, so two tablets sharing a terminal id would each believe the
     * other's cash was theirs — and the second one to open would simply be
     * refused, at four in the afternoon, with a customer waiting.
     */
    val terminalId: String = "",
    val printerHost: String = "",
    val printerPort: Int = 9100,
    /** `NARROW` (58mm, 32 columns) or `WIDE` (80mm, 48). */
    val paper: String = "NARROW",
    /**
     * Antenna power in dBm, or 0 while nobody has chosen.
     *
     * A till is short range by nature: the garments are on the pad in front of
     * the cashier. Running it high reads the rail behind the counter into the
     * basket, and that is wrong in the one way nobody checks — a basket with
     * too much in it still looks like a basket.
     */
    val readerPower: Int = 0,
    val token: String = "",
    val cashier: String = "",
) {
    val isCommissioned: Boolean get() = nodeUrl.isNotBlank() && terminalId.isNotBlank()
    val hasPrinter: Boolean get() = printerHost.isNotBlank()
}

class ConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("itulah-kasir", Context.MODE_PRIVATE)

    fun load() = Config(
        nodeUrl = prefs.getString(K_URL, "").orEmpty(),
        terminalId = prefs.getString(K_TERMINAL, "").orEmpty(),
        printerHost = prefs.getString(K_PRINTER, "").orEmpty(),
        printerPort = prefs.getInt(K_PORT, 9100),
        paper = prefs.getString(K_PAPER, "NARROW").orEmpty(),
        readerPower = prefs.getInt(K_POWER, 0),
        token = prefs.getString(K_TOKEN, "").orEmpty(),
        cashier = prefs.getString(K_CASHIER, "").orEmpty(),
    )

    fun saveCounter(nodeUrl: String, terminalId: String, printerHost: String, printerPort: Int, paper: String) {
        prefs.edit()
            .putString(K_URL, nodeUrl.trim().trimEnd('/'))
            .putString(K_TERMINAL, terminalId.trim())
            .putString(K_PRINTER, printerHost.trim())
            .putInt(K_PORT, printerPort)
            .putString(K_PAPER, paper)
            .apply()
    }

    /**
     * Keep a power without keeping anything else — the same split the handheld
     * makes. A fader that has already moved the antenna must not wait for a
     * Save button belonging to a form of half-typed text.
     */
    fun savePower(dbm: Int) = prefs.edit().putInt(K_POWER, dbm).apply()

    fun saveSession(token: String, cashier: String) {
        prefs.edit().putString(K_TOKEN, token).putString(K_CASHIER, cashier).apply()
    }

    fun clearSession() = prefs.edit().remove(K_TOKEN).remove(K_CASHIER).apply()

    private companion object {
        const val K_URL = "node_url"; const val K_TERMINAL = "terminal_id"
        const val K_PRINTER = "printer_host"; const val K_PORT = "printer_port"
        const val K_PAPER = "paper"; const val K_POWER = "reader_power"
        const val K_TOKEN = "token"; const val K_CASHIER = "cashier"
    }
}
