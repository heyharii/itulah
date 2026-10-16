// The film draws the hub with the hub's own design tokens. This copies
// frontend-hub/src/styles/index.css into src/hub.css without its three
// imports (Tailwind and the two fonts), which src/index.css makes itself,
// so the tokens resolve against this package's node_modules.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, "../../frontend-hub/src/styles/index.css")
const css = readFileSync(source, "utf8")
  .split("\n")
  .filter((line) => !/^@import /.test(line))
  .join("\n")
writeFileSync(
  join(here, "../src/hub.css"),
  `/* Generated from frontend-hub/src/styles/index.css — do not edit. */\n${css}`
)
console.log("hub.css synced")
