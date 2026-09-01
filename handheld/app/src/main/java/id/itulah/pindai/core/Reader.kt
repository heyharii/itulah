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
    private var pollThread: Thread? = null

    val isReady: Boolean get() = rfid != null

    @Synchronized
    fun init(context: Context): String {
        rfid?.let { return it.version.orEmpty() }
        val instance = runCatching { RFIDWithUHFUART.getInstance() }
            .getOrElse { throw IllegalStateException("reader tidak tersedia: ${it.message}") }
        val ok = runCatching { instance.init(context.applicationContext) }
            .getOrElse { throw IllegalStateException("init reader gagal: ${it.message}") }
        if (!ok) throw IllegalStateException("init reader gagal")
        rfid = instance
        // Writing needs far more energy than reading; reading at full power also
        // reaches the back of a rack. The module comes up at 14 dBm.
        // Read the power back rather than trusting setPower's return: the
        // getter returns 0 once inventory is running on this firmware, so the
        // honest figure is the one taken here, at rest.
        for (dbm in intArrayOf(30, 27, 25, 22, 20)) {
            if (runCatching { instance.setPower(dbm) }.getOrDefault(false)) {
                appliedPower = runCatching { instance.power }.getOrDefault(dbm)
                    .let { if (it <= 0) dbm else it }
                break
            }
        }
        return instance.version.orEmpty()
    }

    fun power(): Int = appliedPower

    /** Sweep until [stop] is called, handing every read to [onTag]. */
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
    }
}
