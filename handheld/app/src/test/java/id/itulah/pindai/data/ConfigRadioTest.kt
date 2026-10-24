package id.itulah.pindai.data

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class ConfigRadioTest {
    private fun oldPreferences(): SharedPreferences {
        val old: Map<String, Any> = mapOf(
            "base_url" to "http://shop.example", "site_id" to "SHOP",
            "device_id" to "C5-01", "reader_power" to 30, "tag_focus" to true,
            "gen2_session" to 2, "rf_link" to 14,
        )
        return Proxy.newProxyInstance(
            SharedPreferences::class.java.classLoader, arrayOf(SharedPreferences::class.java),
        ) { _, method, args ->
            when (method.name) {
                "getString", "getInt", "getLong", "getBoolean" -> old[args!![0]] ?: args[1]
                else -> error("Unexpected preference call ${method.name}")
            }
        } as SharedPreferences
    }

    @Test fun `an upgrade discards old radio choices but keeps deployment settings`() {
        val saved = ConfigStore(oldPreferences(), bench = false).load()
        assertEquals("http://shop.example", saved.baseUrl)
        assertEquals("C5-01", saved.deviceId)
        assertEquals(25, saved.readerPower)
        assertEquals(0, saved.gen2Session)
        assertEquals(1, saved.rfLink)
        assertFalse(saved.tagFocus)
    }

    @Test fun `production cannot change the recipe through former preference setters`() {
        val store = ConfigStore(oldPreferences(), bench = false)
        store.saveReaderPower(30)
        store.saveRadio(true, 3)
        store.saveRfLink(11)
        assertEquals(Settings().readerPower, store.load().readerPower)
        assertEquals(Settings().gen2Session, store.load().gen2Session)
        assertEquals(Settings().rfLink, store.load().rfLink)
        assertFalse(store.load().tagFocus)
    }

    @Test fun `lab overrides disappear when its config store is recreated`() {
        val prefs = oldPreferences()
        val lab = ConfigStore(prefs, bench = true)
        lab.saveReaderPower(20)
        lab.saveRadio(true, 1)
        lab.saveRfLink(11)
        assertEquals(11, lab.load().rfLink)
        val restarted = ConfigStore(prefs, bench = true).load()
        assertEquals(25, restarted.readerPower)
        assertEquals(0, restarted.gen2Session)
        assertEquals(1, restarted.rfLink)
        assertFalse(restarted.tagFocus)
    }
}
