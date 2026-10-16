// Google Cloud Text-to-Speech (Chirp 3: HD) for the narration.
//
//   node scripts/tts.mjs <voice> <out.mp3> "<text>"
//
// Auth is the signed-in gcloud account (`gcloud auth print-access-token`);
// no key is written anywhere. GOOGLE_CLOUD_PROJECT names the billing project.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const [voice, out, text] = process.argv.slice(2)
if (!voice || !out || !text) {
  console.error('usage: node scripts/tts.mjs <voice> <out.mp3> "<text>"')
  process.exit(1)
}
const project =
  process.env.GOOGLE_CLOUD_PROJECT ??
  execFileSync("gcloud", ["config", "get-value", "project"]).toString().trim()
const token = execFileSync("gcloud", ["auth", "print-access-token"]).toString().trim()

const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "x-goog-user-project": project,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    input: { text },
    voice: { languageCode: voice.slice(0, 5), name: voice },
    audioConfig: { audioEncoding: "MP3", sampleRateHertz: 44100 },
  }),
})
const body = await res.json()
if (!res.ok) {
  console.error(JSON.stringify(body.error ?? body))
  process.exit(1)
}
writeFileSync(out, Buffer.from(body.audioContent, "base64"))
console.log(`${out} · ${text.length} characters`)
