// Copies Remotion's headless Chrome out of ~/Documents (see remotion.config.ts).
// Run once after `npx remotion browser ensure`.
import { cpSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const from = join(
  here,
  "../node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64"
)
const to = join(homedir(), "Library/Caches/central-video/chrome-headless-shell-mac-arm64")
if (!existsSync(from)) {
  console.error("Run `npx remotion browser ensure` first.")
  process.exit(1)
}
cpSync(from, to, { recursive: true })
console.log(`headless Chrome copied to ${to}`)
