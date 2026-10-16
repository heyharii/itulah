/// <reference types="vite/client" />

/// The screen chunks each `src/screens/<folder>` needs beyond the entry's own
/// (`vite.screen-preloads.ts`); empty in development.
declare module "virtual:screen-preloads" {
  const table: Readonly<Record<string, readonly string[]>>
  export default table
}
