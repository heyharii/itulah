/* Studio and CLI settings. The Node APIs ignore this file. */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Config } from "@remotion/cli/config"
import { enableTailwind } from "@remotion/tailwind-v4"

Config.setVideoImageFormat("png")
Config.setOverwriteOutput(true)
Config.overrideBundlerConfig(enableTailwind)

/* macOS keeps ~/Documents private per process, and Chrome's GPU process is
   sandboxed: started from node_modules under ~/Documents it cannot read its
   own icudtl.dat and every render dies with "Target closed". A copy outside
   Documents (scripts/setup-browser.mjs) runs fine. */
const browser = join(
  homedir(),
  "Library/Caches/central-video/chrome-headless-shell-mac-arm64/chrome-headless-shell"
)
if (existsSync(browser)) Config.setBrowserExecutable(browser)
