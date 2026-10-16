import type { Plugin } from "vite"

/// The screen chunks a page needs, named in the document's response headers.
///
/// Routes here are built in code (`src/routes.tsx`), so Start's own manifest
/// knows only the root's files: the screen a URL opens — its folder's chunk
/// and what that chunk imports — was discovered by the browser only after the
/// entry script had run, one round trip after the HTML. This plugin records,
/// from the client build, which files each screen module (and each folder's
/// map, `src/screens/<folder>/index`) needs beyond the entry's own, and serves that table to the server build as
/// `virtual:screen-preloads`; a route sends it as `Link: rel=modulepreload`
/// (`routes.tsx`), so the browser fetches the screen alongside the entry.
///
/// Build only: in development the table is empty and nothing is sent.
const ID = "virtual:screen-preloads"
const RESOLVED = "\0" + ID

export function screenPreloads(): Plugin {
  let table: Record<string, string[]> = {}
  return {
    name: "hub-screen-preloads",
    resolveId(id) {
      return id === ID ? RESOLVED : undefined
    },
    load(id) {
      if (id !== RESOLVED) return
      // The client environment is built first (Start builds client, then
      // server), so the server's copy carries the client's table.
      return `export default ${JSON.stringify(table)}`
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return
      const chunks = new Map(
        Object.values(bundle)
          .filter((item) => item.type === "chunk")
          .map((chunk) => [chunk.fileName, chunk])
      )
      const entry = [...chunks.values()].find((chunk) => chunk.isEntry)
      // Everything the entry already brings (and Start already preloads).
      const shared = new Set<string>()
      const walk = (name: string, into: Set<string>) => {
        if (into.has(name) || shared.has(name)) return
        into.add(name)
        for (const next of chunks.get(name)?.imports ?? []) walk(next, into)
      }
      if (entry !== undefined) walk(entry.fileName, shared)
      // Keyed by the module's path under `src/screens/`, without its
      // extension: `master/index` (a folder's map), `master/articles` (a
      // screen, `lazyScreen`'s first argument).
      const next: Record<string, string[]> = {}
      for (const chunk of chunks.values()) {
        const match = chunk.facadeModuleId?.match(
          /\/src\/screens\/(.+)\.tsx?$/
        )
        if (match === null || match === undefined) continue
        const files = new Set<string>()
        walk(chunk.fileName, files)
        next[match[1]] = [...files].map((file) => `/${file}`)
      }
      table = next
    },
  }
}
