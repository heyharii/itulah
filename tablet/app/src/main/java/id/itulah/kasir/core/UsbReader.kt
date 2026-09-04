package id.itulah.kasir.core

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import com.rscja.deviceapi.RFIDWithUHFUSB
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The R3 on the tablet's USB port.
 *
 * A port of `~/Documents/retail/pos-android`'s `RfidManager` onto the vendor
 * aar this estate already ships (`DeviceAPI_ver20251103_release.aar`, which
 * carries `RFIDWithUHFUSB`), with one change of stance: this class does not
 * know what a basket is. It reads tags and reports them. What a tag means is
 * decided by the till, in one place, at `frontend-store-new/src/lib/epc.ts`.
 *
 * Everything here no-ops without a reader attached, because a counter with no
 * sled must still sell on a wedge scanner.
 */
class UsbReader(private val context: Context) {

    /** What the shell needs to hear. Delivered off the poll thread. */
    interface Listener {
        fun onTag(epc: String)
        fun onStatus(connected: Boolean, scanning: Boolean, power: Int?, detail: String?)
        /** The pad has been empty long enough that a new batch has begun. */
        fun onFieldCleared()
    }

    private val reader: RFIDWithUHFUSB? = runCatching { RFIDWithUHFUSB.getInstance() }.getOrNull()
    private val usbManager get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

    @Volatile private var connected = false
    @Volatile private var scanning = false
    private val running = AtomicBoolean(false)
    private var pollThread: Thread? = null
    private var permissionReceiver: BroadcastReceiver? = null
    private var attachReceiver: BroadcastReceiver? = null
    private var listener: Listener? = null
    @Volatile private var wantedPower: Int = 0

    /** Whether this build can drive a reader at all — false on a plain tablet. */
    val isSupported: Boolean get() = reader != null

    fun setListener(listener: Listener?) {
        this.listener = listener
    }

    /**
     * Notice a sled arriving.
     *
     * A counter plugs the reader in when the shop opens, and sometimes halfway
     * through the morning after somebody borrowed it. Without this the app has
     * to be restarted to see it, which is a thing a cashier should never be
     * asked to know.
     */
    fun watchForAttach() {
        if (attachReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                if (intent.action != UsbManager.ACTION_USB_DEVICE_ATTACHED) return
                Log.i(TAG, "USB terpasang, mencoba menyambung")
                connect(wantedPower)
                startInventory()
            }
        }
        attachReceiver = receiver
        val filter = IntentFilter(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
    }

    /**
     * Find the sled, ask for USB permission if Android has not already granted
     * it, and open the module. Returns immediately; the answer arrives on
     * [Listener.onStatus].
     */
    fun connect(power: Int) {
        val module = reader ?: return report("pustaka pembaca tidak ada di build ini")
        if (connected) return report(null)
        val devices = runCatching { module.getUsbDeviceList(context) }.getOrDefault(emptyList())
        Log.i(TAG, "connect: ${devices.size} perangkat UHF terlihat")
        wantedPower = power
        val device = devices.firstOrNull() ?: return report("tidak ada pembaca terpasang")
        Log.i(TAG, "connect: ${device.deviceName} vid=${device.vendorId} pid=${device.productId} " +
            "izin=${usbManager.hasPermission(device)}")
        if (usbManager.hasPermission(device)) open(device, power) else askPermission(device, power)
    }

    private fun askPermission(device: UsbDevice, power: Int) {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_IMMUTABLE else 0
        val intent = PendingIntent.getBroadcast(context, 0, Intent(ACTION_USB_PERMISSION), flags)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, received: Intent) {
                if (received.action != ACTION_USB_PERMISSION) return
                val granted = received.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                @Suppress("DEPRECATION")
                val target = received.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
                runCatching { context.unregisterReceiver(this) }
                permissionReceiver = null
                Log.i(TAG, "izin USB: granted=$granted device=${target?.deviceName}")
                if (granted && target != null) open(target, power) else report("izin USB ditolak")
            }
        }
        permissionReceiver = receiver
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(receiver, filter)
        }
        usbManager.requestPermission(device, intent)
    }

    private fun open(device: UsbDevice, power: Int) {
        val module = reader ?: return
        // `init` blocks on the USB handshake. Doing it on the main thread means
        // a WebView that stops painting while a cashier is looking at it.
        Thread {
            val outcome = runCatching { module.init(device, context) }
            connected = outcome.getOrDefault(false)
            Log.i(TAG, "init: ok=$connected " +
                (outcome.exceptionOrNull()?.let { "gagal=${it.message}" } ?: "versi=" +
                    runCatching { module.version }.getOrNull()))
            if (connected) {
                configure(module, power)
                // Start here rather than at the call site.
                //
                // `connect` opens the module on this thread and returns
                // immediately, so a caller that called `startInventory()` on
                // the next line found `connected` still false and went home
                // quietly. The reader was open, the antenna was off, and the
                // screen said "aktif" — the worst of the three possible
                // outcomes. Opening and starting are one act; they belong on
                // one thread.
                startInventory()
            }
            report(
                when {
                    connected -> null
                    outcome.isFailure -> "modul menolak dibuka: ${outcome.exceptionOrNull()?.message}"
                    else -> "modul tidak mau terbuka"
                },
            )
        }.apply { isDaemon = true; name = "uhf-usb-open"; start() }
    }

    /** Radio setup after init. Each step is survivable: a firmware that refuses
     *  one of these still reads tags, and a till that refused to start over a
     *  beeper setting would be worse than a till that beeps. */
    private fun configure(module: RFIDWithUHFUSB, power: Int) {
        // Indonesia sits in 920–925 MHz. The module keeps the last band across
        // power cycles, so a unit bench-tested on another region inits happily
        // and then reads nothing at all.
        runCatching { module.setFrequencyMode(FREQ_MODE_CN920) }
            .onFailure { Log.w(TAG, "setFrequencyMode", it) }
        // Continuous inventory re-reports each tag many times a second; a
        // hardware beep per read is a drone at the counter. Feedback belongs on
        // the screen, where it can say *what* was read — the same ruling the
        // handheld made.
        runCatching { module.setBeep(false) }.onFailure { Log.w(TAG, "setBeep", it) }
        // Tag focus would silence a tag after its first read. The field-clear
        // boundary below depends on tags repeating while they sit on the pad, so
        // this must stay off.
        runCatching { module.setTagFocus(false) }.onFailure { Log.w(TAG, "setTagFocus", it) }
        applyPower(power)
    }

    /**
     * Move the antenna, and report what the module settled on.
     *
     * Returns the figure READ BACK, never the one requested: `setPower` answers
     * true for values this firmware then rounds elsewhere, and a screen echoing
     * the request would tell a counter it is reading at 12 while the antenna
     * sits at 14.
     */
    fun applyPower(dbm: Int): Int {
        val module = reader ?: return -1
        val target = (if (dbm <= 0) COUNTER_DEFAULT else dbm).coerceIn(MIN_POWER, MAX_POWER)
        runCatching { module.setPower(target) }.onFailure { Log.w(TAG, "setPower", it) }
        val settled = runCatching { module.power }.getOrDefault(-1)
        report(null)
        return settled
    }

    fun startInventory() {
        val module = reader ?: return
        if (!connected) {
            Log.i(TAG, "startInventory dilewati: modul belum terbuka")
            return
        }
        if (running.get()) return
        if (!runCatching { module.startInventoryTag() }.getOrDefault(false)) {
            Log.w(TAG, "startInventoryTag menolak")
            return report("pembaca tidak mau mulai")
        }
        Log.i(TAG, "inventory jalan")
        running.set(true)
        scanning = true
        report(null)

        // One line per physical tag per batch. The batch resets once the pad has
        // been empty for FIELD_CLEAR_MS, so the next customer's identical shirt
        // is not silently swallowed as a duplicate of the last one's.
        val batch = HashSet<String>()
        var lastTagAt = 0L
        pollThread = Thread {
            while (running.get()) {
                val info = runCatching { module.readTagFromBuffer() }.getOrNull()
                if (info == null) {
                    // The buffer is empty: the only correct place to sleep.
                    // Sleeping on a duplicate read throttles the drain and
                    // delays the tag that has not been seen yet.
                    try {
                        Thread.sleep(POLL_IDLE_MS)
                    } catch (_: InterruptedException) {
                        break
                    }
                    val now = SystemClock.elapsedRealtime()
                    if (lastTagAt != 0L && now - lastTagAt > FIELD_CLEAR_MS && batch.isNotEmpty()) {
                        batch.clear()
                        lastTagAt = 0L
                        listener?.onFieldCleared()
                    }
                    continue
                }
                val epc = info.getEPC()?.trim()?.uppercase().orEmpty()
                if (epc.isBlank()) continue
                val now = SystemClock.elapsedRealtime()
                if (lastTagAt != 0L && now - lastTagAt > FIELD_CLEAR_MS) {
                    batch.clear()
                    listener?.onFieldCleared()
                }
                lastTagAt = now
                // Everything the antenna sees is forwarded, ours or not. The
                // till already tells an EPC from a supplier's GS1 label
                // (`readScan`), and a second filter here would be a second
                // implementation of the tag format — the drift this estate has
                // already paid for once.
                if (batch.add(epc)) {
                    Log.i(TAG, "tag $epc")
                    listener?.onTag(epc)
                }
            }
        }.apply { isDaemon = true; name = "uhf-usb-poll"; start() }
    }

    fun stopInventory() {
        running.set(false)
        scanning = false
        val thread = pollThread
        thread?.interrupt()
        if (thread != null && thread !== Thread.currentThread()) runCatching { thread.join(500) }
        pollThread = null
        reader?.let { runCatching { it.stopInventory() } }
        report(null)
    }

    /** Ordered teardown. Leaving the module open holds the USB handle until
     *  somebody unplugs the sled — the failure `fresh/pos-app` fixed the hard
     *  way and wrote down. */
    fun close() {
        stopInventory()
        reader?.let { runCatching { it.free() } }
        connected = false
        permissionReceiver?.let { runCatching { context.unregisterReceiver(it) } }
        permissionReceiver = null
        attachReceiver?.let { runCatching { context.unregisterReceiver(it) } }
        attachReceiver = null
        report(null)
    }

    private fun report(detail: String?) {
        // The getter answers 0 while inventory runs, so a figure taken mid-sweep
        // would be a lie. Only report power at rest; otherwise say nothing.
        val power = if (connected && !scanning) runCatching { reader?.power }.getOrNull() else null
        listener?.onStatus(connected, scanning, power?.takeIf { it > 0 }, detail)
    }

    private companion object {
        const val TAG = "UsbReader"
        const val ACTION_USB_PERMISSION = "id.itulah.kasir.USB_PERMISSION"
        /** Vendor region code for CN920 — Indonesia's 920–925 MHz. */
        const val FREQ_MODE_CN920 = 0x02
        /** The pad is empty once nothing has been read for this long. */
        const val FIELD_CLEAR_MS = 3000L
        const val POLL_IDLE_MS = 5L
        /** Short range on purpose: the garments are on the pad, not on the rail. */
        const val COUNTER_DEFAULT = 12
        const val MIN_POWER = 5
        const val MAX_POWER = 30
    }
}
