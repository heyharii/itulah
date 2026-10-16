import { warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { glossaryQuery } from "@/lib/queries/assistant"

/// What the Assistant asks first, before the screen is open (`lib/prefetch.ts`).
/// Only the glossary: the chat itself (`/assistant`) reads the capabilities
/// the shell's assistant panel reads with a plain `useQuery`, and the chat list
/// and the brief's prompts are asides that must not fail the page, so none of
/// them is started on the server.
export const prefetch: PrefetchMap = {
  "/assistant/glossary": (client) => warmQuery(client, glossaryQuery()),
}
