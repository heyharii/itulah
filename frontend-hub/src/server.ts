import { FastResponse } from "srvx"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"

/// The server entry: Start's own, with one change for Node.
///
/// Nitro serves the built hub through srvx, and srvx's `FastResponse` turns
/// into a Node response without the copy the standard Web `Response` needs —
/// the hosting guide measures about 5% more pages a second for it. Nothing
/// else differs from the entry Start would use without this file.
globalThis.Response = FastResponse

export default createServerEntry({
  fetch(request, opts) {
    return handler.fetch(request, opts)
  },
})
