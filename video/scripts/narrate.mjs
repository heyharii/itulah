// Voices one chapter's narration with Google Chirp 3: HD (Charon, id-ID):
//
//   node scripts/narrate.mjs ch1
//
// Reads src/narration/<chapter>.json, writes public/vo/<chapter>/<id>.mp3 and
// src/narration/<chapter>.durations.json (seconds per line), which the
// chapter reads to give every beat at least its sentence's length. A line is
// only voiced again when its text changed.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const VOICE = "id-ID-Chirp3-HD-Charon"
const here = dirname(fileURLToPath(import.meta.url))
const chapter = process.argv[2]
const lines = JSON.parse(readFileSync(join(here, `../src/narration/${chapter}.json`), "utf8"))
const outDir = join(here, `../public/vo/${chapter}`)
mkdirSync(outDir, { recursive: true })
const durationsFile = join(here, `../src/narration/${chapter}.durations.json`)
const old = existsSync(durationsFile) ? JSON.parse(readFileSync(durationsFile, "utf8")) : {}

/* What the screen shows and what the voice says differ in a few places: the
   bold marks go, "PO" is spelled out, "pcs" is said as English "pieces". */
const spoken = (text) =>
  text
    .replace(/\*\*/g, "")
    .replace(/\bPO\b/g, "P O")
    .replace(/\bHO\b/g, "H O")
    .replace(/\bpcs\b/g, "pieces")
    .replace(/Rp 0\b/g, "nol rupiah")
    .replace(/−(\d)/g, "minus $1")

const project = execFileSync("gcloud", ["config", "get-value", "project"]).toString().trim()
const token = execFileSync("gcloud", ["auth", "print-access-token"]).toString().trim()

const durations = {}
let chars = 0
for (const line of lines) {
  const file = join(outDir, `${line.id}.mp3`)
  const say = spoken(line.text)
  if (old[line.id]?.say === say && existsSync(file)) {
    durations[line.id] = old[line.id]
    continue
  }
  const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": project,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { text: say },
      voice: { languageCode: "id-ID", name: VOICE },
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 44100 },
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(body.error ?? body))
  writeFileSync(file, Buffer.from(body.audioContent, "base64"))
  const seconds = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
      .toString()
      .trim()
  )
  durations[line.id] = { seconds, say }
  chars += say.length
  console.log(`${line.id}  ${seconds.toFixed(2)} s  ${say}`)
}
writeFileSync(durationsFile, JSON.stringify(durations, null, 2) + "\n")
console.log(`${chars} characters voiced`)
