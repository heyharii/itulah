import type {
  PoImportDraft,
  PoImportHealth,
  PoImportIngestResponse,
} from "@/lib/queries/po-import-types"

export type {
  EditableDraft,
  PoImportDraft,
  PoImportDraftLine,
  PoImportFileReport,
  PoImportHealth,
  PoImportIngestResponse,
  PoImportQuestion,
} from "@/lib/queries/po-import-types"

import { poImportDraftFromWire } from "@/lib/queries/po-import-types"

export { poImportDraftFromWire }

/// Reads and writes for the PO import pipeline, and the keys they are held
/// under.
///
/// This surface is the cloud's intake kernel (`backend/src/cloud/intake/po`)
/// over the same-origin `/api`, exactly like every other read and write the
/// hub makes: the session cookie is `SameSite=Strict`, and the extraction
/// keys live on the node, never in the browser.
export const poImportKeys = {
  all: ["po-import"] as const,
  health: () => ["po-import", "health"] as const,
}

async function poImportFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/purchase-orders/import${path}`, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    // The error envelope is the kernel's: `{ error: string }`. Narrowed, not
    // cast — a body without the shape keeps the status-line message.
    let message = `po-import answered ${response.status}`
    if (body !== null && typeof body === "object" && "error" in body) {
      const error = body.error
      if (typeof error === "string" && error !== "") message = error
    }
    throw new Error(message)
  }
  // Typed boundary: every caller names the kernel type it expects.
  return body as T
}

/// Whether Jev / OpenParser / LiteParse are configured. The screen shows an
/// honest banner about what each upload will and will not get.
export function poImportHealth(signal?: AbortSignal) {
  return poImportFetch<PoImportHealth>("/health", { signal })
}

/// Every picked file in one request: the service answers with per-file
/// reports and the grouped PO drafts.
export function ingestPoFiles(files: readonly File[], signal?: AbortSignal) {
  const form = new FormData()
  for (const file of files) form.append("file", file, file.name)
  return poImportFetch<PoImportIngestResponse>("", {
    method: "POST",
    body: form,
    signal,
  }).then((body) => ({
    reports: body.reports,
    drafts: body.drafts.map(poImportDraftFromWire),
  }))
}

/// Merge the wizard's answers into one draft. The service re-judges what
/// changed and answers with the updated draft — whose `questions` list is
/// what is left to ask.
export function validatePoDraft(
  draft: PoImportDraft,
  answers: Readonly<Record<string, { value: string; label?: string | null }>>,
  signal?: AbortSignal
) {
  return poImportFetch<{ draft: PoImportDraft }>("/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft, answers }),
    signal,
  }).then((body) => poImportDraftFromWire(body.draft))
}
