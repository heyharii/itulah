package id.itulah.pindai.core

import org.junit.Assert.*
import org.junit.Test

class RadioRecipeTest {
    private val confirmed = RadioReadback(25, 1, 0, 0, RadioRecipe.inventory, fastInventory = 0)

    @Test fun `a freshly read matching profile can start`() {
        RadioRecipe.requireApplied(confirmed)
    }

    @Test fun `unread extensions cannot look disabled`() {
        assertTrue(RadioRecipe.mismatches(confirmed.copy(tagFocus = -1)).isNotEmpty())
        assertTrue(RadioRecipe.mismatches(confirmed.copy(fastId = -1)).isNotEmpty())
        assertTrue(RadioRecipe.mismatches(confirmed.copy(fastInventory = -1)).isNotEmpty())
    }

    @Test fun `old per-phone radio and power values do not pass the recipe`() {
        for (stale in listOf(
            confirmed.copy(power = 30), confirmed.copy(link = 11),
            confirmed.copy(tagFocus = 1), confirmed.copy(fastId = 1),
            confirmed.copy(fastInventory = 1),
            confirmed.copy(inventory = confirmed.inventory.copy(session = 1)),
        )) assertTrue(RadioRecipe.mismatches(stale).isNotEmpty())
    }

    @Test fun `retained filters and broken slot settings are rejected`() {
        val correct = confirmed.inventory
        for (wrong in listOf(
            correct.copy(querySel = 3), correct.copy(selectTarget = 0),
            correct.copy(selectAction = 5), correct.copy(selectTruncate = 1),
            correct.copy(q = 0), correct.copy(startQ = 0), correct.copy(minQ = 7),
            correct.copy(maxQ = 0), correct.copy(target = 1),
        )) assertTrue(RadioRecipe.mismatches(confirmed.copy(inventory = wrong)).isNotEmpty())
    }

    @Test fun `refused readback explicitly says no scan started`() {
        val failure = runCatching { RadioRecipe.requireApplied(confirmed.copy(link = -1)) }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertTrue(failure!!.message!!.contains("No scan was started"))
    }

    @Test fun `repeat reads are allowed without reader-side suppression`() {
        assertEquals(0, RadioRecipe.inventory.session)
        assertEquals(0, RadioRecipe.inventory.querySel)
        assertFalse(RadioRecipe.TAG_FOCUS)
        assertFalse(RadioRecipe.FAST_ID)
    }
}
