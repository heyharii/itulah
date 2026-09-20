package id.itulah.pindai.core

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.media.ToneGenerator

/**
 * What a sweep sounds like.
 *
 * # There is no buzzer to ask
 *
 * The C5's UHF module has no beeper this SDK can reach: `RFIDWithUHFUART` has
 * not one sound method on it, the AAR references no Android audio API from any
 * of its classes, and every `setBeep`/`triggerBeep`/`setBuzzer` symbol in it
 * belongs to Chainway's OTHER readers — A4, A8, URx, USB, network. Chainway's
 * own UART sample settles it from the other side: it drives the same class we
 * do and beeps with a SoundPool and a bundled clip, rate-limited, exactly like
 * this. The sound a handheld makes on a tag read is the app's to produce.
 *
 * A label is different and is NOT handled here — the imager's decode goes
 * through the device's own scanner service, which has a real beep and a real
 * buzz of its own. See [Barcode].
 *
 * # Two sounds, two questions
 *
 * [Mode.NEW_TAG] is the operator's. One note per garment nobody has counted
 * yet, so a sweep still finding things is audible from behind a rack and one
 * that has finished goes quiet by itself. It says nothing about how hard the
 * radio is working, because the operator does not care.
 *
 * [Mode.EVERY_READ] is the bench's, and it is the only instrument in this app
 * that makes tag silence audible. A tag that has not gone quiet is read about
 * twenty times a second; one that has is read once. So with Tag Focus off a
 * rack sounds like a sewing machine and with it on the same rack gives a burst
 * and then near silence — the feature heard rather than plotted, which after a
 * night of measurements that were twice wrong is worth having.
 */
class Sounder {

    enum class Mode { OFF, NEW_TAG, EVERY_READ }

    @Volatile
    var mode: Mode = Mode.NEW_TAG

    private var pool: SoundPool? = null
    private var clip = 0
    private var tone: ToneGenerator? = null
    private val lock = Any()

    @Volatile
    private var lastSoundAt = 0L

    /**
     * Load the clip, once, off the reader's path.
     *
     * Resolved by NAME rather than through `R.raw`: the asset belongs to the
     * label lane, and a compile-time reference would make this file fail to
     * build whenever that lane has not landed yet. A missing clip is not a
     * failure here — [heard] falls back to a generated tone.
     */
    fun prepare(context: Context) {
        synchronized(lock) {
            if (pool != null) return
            val app = context.applicationContext
            val id = runCatching {
                app.resources.getIdentifier(CLIP, "raw", app.packageName)
            }.getOrDefault(0)
            if (id == 0) return
            // Ten streams, because reads arrive faster than one clip finishes
            // and a pool of one drops every overlap — which on EVERY_READ is
            // precisely the density being listened for. The media stream, not
            // the alarm: this is the volume a person reaches for when a scanner
            // is too loud, and alarm volume belongs to alarms.
            val created = runCatching {
                SoundPool.Builder()
                    .setMaxStreams(STREAMS)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                    .build()
            }.getOrNull() ?: return
            clip = runCatching { created.load(app, id, 1) }.getOrDefault(0)
            pool = created
        }
    }

    /**
     * Called from the READER's thread, on every read.
     *
     * Must not block: time spent here is time the radio is not collecting tags.
     * `SoundPool.play` hands the clip to the mixer and returns, and the rate
     * limit below means it is usually not even reached.
     */
    fun heard(isNew: Boolean) {
        // Only the bench listens to raw reads now.
        //
        // NEW_TAG used to be served from here, on "this EPC is one I have not
        // seen". That question cannot tell a garment from a corrupt read: a bad
        // read arrives as twenty-four valid hex characters that are new every
        // time, so the note never stopped while the count never moved. The
        // operator's note now hangs on [counted] instead, which fires once a
        // read has become a unit somebody can name.
        if (mode != Mode.EVERY_READ) return
        strike()
    }

    /**
     * One unit was counted. The operator's note.
     *
     * Deliberately deaf to foreign tags, corrupt reads and duplicates, because
     * a sound that fires for those says "found one" while the screen says
     * "found nothing" — and on a floor the honest reading of that is a broken
     * reader.
     */
    fun counted() {
        if (mode != Mode.NEW_TAG) return
        strike()
    }

    private fun strike() {
        if (mode == Mode.OFF) return
        val now = System.currentTimeMillis()
        if (now - lastSoundAt < MIN_GAP_MS) return
        lastSoundAt = now
        val player = pool
        if (player != null && clip != 0) {
            runCatching { player.play(clip, 1f, 1f, 1, 0, 1f) }
            return
        }
        // No clip: a generated tone still carries the density, which is the
        // information. It clips under rapid repeats, so it is the fallback.
        synchronized(lock) {
            val generator = tone ?: runCatching {
                ToneGenerator(AudioManager.STREAM_MUSIC, VOLUME)
            }.getOrNull()?.also { tone = it } ?: return
            runCatching { generator.startTone(ToneGenerator.TONE_PROP_BEEP, TONE_MS) }
        }
    }

    /**
     * Give the audio back.
     *
     * A SoundPool and a ToneGenerator each hold a real audio track; leaking one
     * per sweep runs the device out of them and the app goes quiet for the rest
     * of the shift with nothing in the log to say why.
     */
    fun release() {
        synchronized(lock) {
            runCatching { pool?.release() }
            pool = null
            clip = 0
            runCatching { tone?.release() }
            tone = null
        }
    }

    private companion object {
        const val CLIP = "scan_beep"
        const val STREAMS = 10
        const val VOLUME = 80
        const val TONE_MS = 40

        /**
         * The floor on how often a note may start.
         *
         * Chainway's own sample uses 500 ms, which is right for one beep per
         * tag and wrong for hearing read density — it would flatten the very
         * difference EVERY_READ exists to expose. Forty milliseconds is about
         * where an ear stops hearing separate clicks and starts hearing a
         * texture, and a texture still carries the rate.
         */
        const val MIN_GAP_MS = 40L
    }
}
