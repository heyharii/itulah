/// Which till this build is. One codebase, three editions:
///
/// - **desktop** — the Tauri window at the counter. Everything: the Chainway
///   R3, fingerprints and PINs (the pairing secret), the USB printer, the
///   drawer, the customer display, joining a node, peripherals.
/// - **web** — the same till in a browser tab, linked from the shop app and
///   served beside the node (`web.ts`). Only what a browser can honestly do:
///   sign in with a password, sell, pay, return and void with a supervisor's
///   password, shifts, and receipts on a network printer the node prints to.
/// - **gudang** — Central Gudang, the warehouse PC in the store's back room
///   (client, 25 Oct 2026): the desktop shell and its hardware, joined to the
///   node as a `WAREHOUSE` (`joining.ts`), signing people in as the till does,
///   and then the warehouse screen (`gudang/app.tsx`) instead of a till — no
///   shift, no drawer, no customer display. The node refuses it every selling
///   call.
///
/// Chosen at build time (`npm run dev:web`, `npm run build:web` →
/// `vite --mode web`; `dev:gudang`, `build:gudang` → `vite --mode gudang`),
/// not guessed from whether a bridge happens to exist, so a web till never
/// draws a button that can only ever refuse.
export type Edition = "desktop" | "web" | "gudang"

export const edition: Edition =
  import.meta.env.MODE === "web"
    ? "web"
    : import.meta.env.MODE === "gudang"
      ? "gudang"
      : "desktop"

export const isWeb = edition === "web"

export const isGudang = edition === "gudang"
