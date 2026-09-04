package id.itulah.kasir.core

import android.os.SystemClock
import android.util.Log

/**
 * What the till costs, measured where a cashier would feel it.
 *
 * One tag, one logcat line, so a whole evening's behaviour can be read with
 * `adb logcat -s kasir-perf` and nothing has to be reproduced in a lab. The
 * numbers that matter at a counter are not throughput:
 *
 *   - **scan** — a tag arriving to that line being on screen. Everything on
 *     this path is local, so it is tens of microseconds; if it ever is not,
 *     something has put the network on it.
 *   - **quote** — the round trip that prices the basket. Debounced, so this
 *     fires once per pause in scanning rather than once per garment.
 *   - **sale** — the one that happens while the customer is watching.
 *   - **book** — the resident catalogue, paged. Paid once per shift.
 *
 * Left on in release. It is four log lines a minute at a busy counter, it costs
 * nothing measurable, and the one thing worse than a slow till is a slow till
 * nobody can prove is slow.
 */
object Perf {
    const val TAG = "kasir-perf"

    inline fun <T> time(label: String, detail: String = "", block: () -> T): T {
        val started = SystemClock.elapsedRealtimeNanos()
        val result = block()
        val micros = (SystemClock.elapsedRealtimeNanos() - started) / 1_000
        // Milliseconds with one decimal: a counter cares about the difference
        // between 40ms and 400ms, and never about the difference between
        // 40.11ms and 40.12ms.
        Log.i(TAG, "$label ${micros / 1000.0} ms" + if (detail.isEmpty()) "" else " · $detail")
        return result
    }

    fun mark(label: String, millis: Long, detail: String = "") {
        Log.i(TAG, "$label $millis ms" + if (detail.isEmpty()) "" else " · $detail")
    }
}
