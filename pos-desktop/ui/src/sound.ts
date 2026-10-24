/// The till's own small sounds (owner, 23 Oct 2026: "dibuat suara suara jg
/// biar unik"). Synthesised with Web Audio, so there is no file to load and
/// nothing to fail: a browser that will not play simply stays quiet.
///
/// Short and soft on purpose — a cashier hears these all day. The finger and
/// the welcome are a few times a shift; the paid chime is once a sale; nothing
/// sounds per scanned tag.

let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext()
    if (context.state === "suspended") void context.resume()
    return context
  } catch {
    return null
  }
}

/// One note: a quick attack and an exponential fall, so nothing clicks.
function note(
  frequency: number,
  at: number,
  length: number,
  volume = 0.07,
  shape: OscillatorType = "sine",
): void {
  const ctx = audio()
  if (ctx === null) return
  const start = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = shape
  osc.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + length + 0.02)
}

export const sound = {
  /// A finger on the sensor.
  read: () => note(1760, 0, 0.05, 0.03),
  /// Recognised: two notes up.
  ok: () => {
    note(880, 0, 0.14)
    note(1318.5, 0.09, 0.22)
  },
  /// Not recognised: two notes down, low and soft.
  no: () => {
    note(233, 0, 0.13, 0.09, "triangle")
    note(196, 0.14, 0.2, 0.09, "triangle")
  },
  /// The welcome: C E G C, rising.
  welcome: () => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
      note(frequency, index * 0.075, 0.42, 0.05),
    )
  },
  /// A sale paid: a small bell.
  paid: () => {
    note(1567.98, 0, 0.6, 0.05)
    note(2093, 0.05, 0.7, 0.035)
    note(3135.96, 0.05, 0.35, 0.015)
  },
  /// A code the till does not know.
  error: () => note(155.56, 0, 0.18, 0.1, "triangle"),
}
