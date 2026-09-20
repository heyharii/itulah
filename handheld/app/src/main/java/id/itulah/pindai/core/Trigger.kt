package id.itulah.pindai.core

import android.view.KeyEvent

/**
 * The gun trigger, which Android only knows as a key.
 *
 * # Why this is not a constant
 *
 * The physical button under the operator's index finger is wired to a keycode
 * by the vendor's firmware, and the firmwares disagree. The same C5 shell has
 * been shipped reporting 139, 280, 293, 294 and 311 for the same pull. A build
 * that hard-codes one number works on the units it was tested against and does
 * nothing at all on the next batch — and "the trigger does nothing" is
 * indistinguishable, on the floor, from "the reader is broken".
 *
 * So Setelan learns it: one pull, one number, stored. The candidates below are
 * only what is believed before anybody has pulled it.
 *
 * # Press to latch, not hold to read
 *
 * A stock count runs thirty to sixty minutes and the trigger on this hardware
 * is stiff. Holding it for that is a hand that stops working; the operator puts
 * the gun down and starts using the screen, and the trigger might as well not
 * exist. Barcode scanners are held because a barcode is one shot. An inventory
 * sweep is a walk, and a walk latches.
 */
object Trigger {

    /**
     * What a C5 might send before anybody has taught us otherwise.
     *
     * Deliberately a small set rather than "any unrecognised key": a handheld
     * also has volume keys and a power button, and a scan that starts because
     * somebody adjusted the volume is worse than a scan that needs one setup
     * step.
     */
    val CANDIDATES = intArrayOf(139, 280, 293, 294, 311)

    /** Keys we must never claim, whatever the firmware calls the trigger. */
    private val RESERVED = intArrayOf(
        KeyEvent.KEYCODE_BACK,
        KeyEvent.KEYCODE_HOME,
        KeyEvent.KEYCODE_POWER,
        KeyEvent.KEYCODE_VOLUME_UP,
        KeyEvent.KEYCODE_VOLUME_DOWN,
        KeyEvent.KEYCODE_MENU,
        KeyEvent.KEYCODE_APP_SWITCH,
    )

    fun isReserved(keyCode: Int): Boolean = RESERVED.contains(keyCode)

    /** True when [keyCode] should start or stop a sweep. */
    fun matches(keyCode: Int, learned: Int): Boolean = when {
        isReserved(keyCode) -> false
        learned > 0 -> keyCode == learned
        else -> CANDIDATES.contains(keyCode)
    }

    /**
     * Whether this event is a fresh pull rather than the same one still held.
     *
     * A held trigger auto-repeats, and on a latching control every repeat would
     * toggle: hold it for a second and the radio starts and stops fifteen times.
     * Only the first DOWN counts, and [since] is the debounce for firmwares that
     * send two different keycodes for one pull — both arrive, both are "first",
     * and without a window the sweep starts and immediately stops.
     */
    fun isFreshPull(event: KeyEvent, lastAcceptedAt: Long, now: Long): Boolean =
        isFreshPull(event.action, event.repeatCount, lastAcceptedAt, now)

    /** The same decision, as the three numbers it is actually made from. */
    fun isFreshPull(action: Int, repeatCount: Int, lastAcceptedAt: Long, now: Long): Boolean =
        action == KeyEvent.ACTION_DOWN &&
            repeatCount == 0 &&
            now - lastAcceptedAt > DEBOUNCE_MS

    const val DEBOUNCE_MS = 300L
}
