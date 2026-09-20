package id.itulah.pindai.core

import id.itulah.pindai.BuildConfig

import java.io.File

/**
 * A way to run an experiment without touching the screen.
 *
 * # Why this exists
 *
 * Every Gen2X measurement attempted on this handheld failed the same way: a
 * control scrolled out of reach, a tap that missed in silence, a sweep measured
 * against a radio that had been told nothing. Hours went into driving a
 * settings screen rather than into the reader. An instrument you have to fight
 * is not an instrument.
 *
 * So the bench takes its orders from a FILE in the app's own directory:
 *
 * ```
 * echo "session 1" > /tmp/cmd && adb push /tmp/cmd \
 *   /sdcard/Android/data/id.itulah.pindai/files/lab-cmd.txt
 * adb pull /sdcard/Android/data/id.itulah.pindai/files/lab.log
 * ```
 *
 * # Why a file and not a broadcast
 *
 * A broadcast receiver would be quicker to write and is how this was first
 * attempted — and it would have been an exported component that lets anything
 * on the device reconfigure the radio. A file the app reads from its own
 * sandbox is not a surface anyone can call: it needs shell access to the
 * device, other apps cannot write there under scoped storage, and the app is
 * the one that chooses to look.
 *
 * It is still a bench facility. [enabled] is what keeps it out of a shop.
 */
class Lab(private val dir: File?, private val run: (String) -> Unit) {

    private var lastSeen = 0L

    /** Off unless somebody deliberately drops a command file in. */
    /**
     * Open only on a bench build.
     *
     * The directory test alone was never a gate — the app's own external files
     * directory always exists, so this was true on every device including one
     * handed to a shop. The channel reconfigures the radio and rewrites what
     * counts as a product from a file any app with storage access can drop in.
     */
    val enabled: Boolean get() = BuildConfig.BENCH && dir != null

    /** Anything the bench has been told, and what came back. */
    fun log(line: String) {
        val target = dir ?: return
        runCatching { File(target, LOG).appendText(line + "\n") }
    }

    /**
     * Take the next command, if one has been left since the last look.
     *
     * The file is deleted once read, so a command runs exactly once however
     * often this is polled.
     */
    fun poll() {
        val target = dir ?: return
        val file = File(target, CMD)
        if (!file.exists()) return
        val stamp = file.lastModified()
        if (stamp == lastSeen) return
        lastSeen = stamp
        val command = runCatching { file.readText().trim() }.getOrNull().orEmpty()
        runCatching { file.delete() }
        if (command.isEmpty()) return
        log("> $command")
        runCatching { run(command) }.onFailure { log("  THREW ${it.message}") }
    }

    private companion object {
        const val CMD = "lab-cmd.txt"
        const val LOG = "lab.log"
    }
}
