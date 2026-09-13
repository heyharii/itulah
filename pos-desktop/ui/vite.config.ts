import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Tauri points its dev window here; a strict port means a second copy of the
  // dev server cannot quietly take 5411 and leave the window on a stale build.
  server: { port: 5410, strictPort: true },
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
      // 96-bit tags: the retail-private header, the BCD SKU and the serial.
      // This is a mirror of `backend/src/cloud/domain/identity.rs`, and one
      // mirror is already one more than is safe — so this app points at the
      // existing TypeScript one instead of carrying a third. It belongs in
      // `frontend-contract` next to the other generated wire shapes; moving it
      // there is the fix, and this alias is what makes that a one-line change.
      "@epc": path.resolve(here, "../../frontend-store-new/src/lib/epc.ts"),
      // The shape of everything on the wire is generated from Rust by
      // `make contract`. Aliased rather than depended on, the same way every
      // other frontend in this repo reaches it.
      "@itulah/contract/money": path.resolve(
        here,
        "../../frontend-contract/src/money/index.ts",
      ),
      "@itulah/contract": path.resolve(
        here,
        "../../frontend-contract/src/index.ts",
      ),
    },
  },
})
