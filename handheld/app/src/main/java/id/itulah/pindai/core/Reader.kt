package id.itulah.pindai.core

import android.content.Context
import com.rscja.deviceapi.RFIDWithUHFUART
import com.rscja.deviceapi.entity.InventoryModeEntity

/** One sighting as the reader saw it. */
data class TagRead(val epc: String, val rssi: Float?, val tid: String?, val count: Int)

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

    /** The dBm somebody asked for, or 0 while nobody has. */
    @Volatile private var wantedPower = 0

    /** Kept so a power change can re-open the module; see [setPower]. */
    @Volatile private var appContext: Context? = null
    private var pollThread: Thread? = null

    val isReady: Boolean get() = rfid != null

    @Synchronized
    fun init(context: Context): String {
        appContext = context.applicationContext
        rfid?.let { return it.version.orEmpty() }
        val instance = runCatching { RFIDWithUHFUART.getInstance() }
            .getOrElse { throw IllegalStateException("reader tidak tersedia: ${it.message}") }
        val ok = runCatching { instance.init(context.applicationContext) }
            .getOrElse { throw IllegalStateException("init reader gagal: ${it.message}") }
        if (!ok) throw IllegalStateException("init reader gagal")
        rfid = instance
        applyPower(instance, wantedPower)
        return instance.version.orEmpty()
    }

    /** What the antenna is running at, as the module last reported it. */
    fun power(): Int = appliedPower

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
    fun start(withTid: Boolean, onTag: (TagRead) -> Unit): Boolean {
        val r = rfid ?: return false
        stop()
        runCatching {
            r.setEPCAndTIDUserMode(
                InventoryModeEntity.Builder()
                    .setMode(if (withTid) InventoryModeEntity.MODE_EPC_TID else InventoryModeEntity.MODE_EPC)
                    .build(),
            )
        }
        if (!runCatching { r.startInventoryTag() }.getOrDefault(false)) return false
        polling = true
        pollThread = Thread {
            while (polling) {
                val info = runCatching { r.readTagFromBuffer() }.getOrNull()
                if (info == null) { try { Thread.sleep(3) } catch (e: InterruptedException) { break }; continue }
                val epc = info.getEPC()?.uppercase()?.takeIf { it.isNotBlank() } ?: continue
                onTag(
                    TagRead(
                        epc = epc,
                        rssi = info.rssi?.toFloatOrNull(),
                        tid = info.tid?.uppercase()?.takeIf { t -> t.isNotBlank() && t.any { c -> c != '0' } },
                        count = info.count.coerceAtLeast(1),
                    ),
                )
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
    }
}
