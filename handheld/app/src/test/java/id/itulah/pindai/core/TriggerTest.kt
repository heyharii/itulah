package id.itulah.pindai.core

import android.view.KeyEvent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TriggerTest {

    @Test
    fun `before anything is learned the known candidates all work`() {
        Trigger.CANDIDATES.forEach {
            assertTrue("candidate $it", Trigger.matches(it, learned = 0))
        }
    }

    @Test
    fun `a learned keycode is the only one that counts`() {
        assertTrue(Trigger.matches(293, learned = 293))
        // 139 is a candidate, but this unit told us its trigger is 293.
        assertFalse(Trigger.matches(139, learned = 293))
    }

    @Test
    fun `volume and power are never the trigger`() {
        listOf(
            KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_POWER, KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_HOME,
        ).forEach {
            assertFalse("reserved $it", Trigger.matches(it, learned = 0))
            // Not even if somebody manages to teach it one.
            assertFalse("reserved learned $it", Trigger.matches(it, learned = it))
        }
    }

    @Test
    fun `a held trigger latches once, not once per repeat`() {
        val down = KeyEvent.ACTION_DOWN
        assertTrue(Trigger.isFreshPull(down, repeatCount = 0, lastAcceptedAt = 0, now = 10_000))
        // Auto-repeat while the finger stays down.
        assertFalse(Trigger.isFreshPull(down, repeatCount = 1, lastAcceptedAt = 10_000, now = 10_050))
        assertFalse(Trigger.isFreshPull(down, repeatCount = 7, lastAcceptedAt = 10_000, now = 10_400))
    }

    @Test
    fun `two keycodes for one pull do not start and immediately stop`() {
        // Some firmware sends both 139 and 280 for one physical pull. Both are
        // repeatCount 0; only the debounce keeps the sweep alive.
        val accepted = 10_000L
        assertFalse(
            Trigger.isFreshPull(KeyEvent.ACTION_DOWN, 0, accepted, accepted + 20),
        )
        assertTrue(
            Trigger.isFreshPull(KeyEvent.ACTION_DOWN, 0, accepted, accepted + Trigger.DEBOUNCE_MS + 1),
        )
    }

    @Test
    fun `releasing the trigger does not toggle`() {
        assertFalse(Trigger.isFreshPull(KeyEvent.ACTION_UP, 0, 0, 10_000))
    }
}
