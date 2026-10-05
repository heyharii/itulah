/// Which till this build is. One codebase, two editions:
///
/// - **desktop** — the Tauri window at the counter. Everything: the Chainway
///   R3, fingerprints and PINs (the pairing secret), the USB printer, the
///   drawer, the customer display, joining a node, peripherals.
/// - **web** — the same till in a browser tab, linked from the shop app and
///   served beside the node (`web.ts`). Only what a browser can honestly do:
///   sign in with a password, sell, pay, return and void with a supervisor's
///   password, shifts, and receipts on a network printer the node prints to.
///
/// Chosen at build time (`npm run dev:web`, `npm run build:web` →
/// `vite --mode web`), not guessed from whether a bridge happens to exist, so
/// a web till never draws a button that can only ever refuse.
export type Edition = "desktop" | "web"

export const edition: Edition = import.meta.env.MODE === "web" ? "web" : "desktop"

export const isWeb = edition === "web"
