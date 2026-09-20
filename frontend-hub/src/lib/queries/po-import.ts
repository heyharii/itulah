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
/// This surface is NOT the cloud node and not the DC edge — it is the small
/// ingest service (`services/po-import`) that stands between uploaded
/// documents and PO drafts. It is proxied same-origin under `/po-import` (see
/// `vite.config.ts`) for the same reason every other backend here is: the
/// session cookie is `SameSite=Strict`, and keys live on the server, never in
/// the browser.

export const poImportKeys = {
  all: ["po-import"] as const,
  health: () => ["po-import", "health"] as const,
}

async function poImportFetch<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/po-import${path}`, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      body !== null &&
      body !== undefined &&
      typeof body === "object" &&
      "error" in body
        ? String((body as { error: unknown }).error)
        : `po-import answered ${response.status}`
    throw new Error(message)
  }
  return body as T
}

/// Whether Jev / OpenParser / LiteParse are configured. The screen shows an
/// honest banner about what each upload will and will not get.
export function poImportHealth(signal?: AbortSignal) {
  return poImportFetch<PoImportHealth>("/healthz", { signal })
}

/// Every picked file in one request: the service answers with per-file
/// reports and the grouped PO drafts.
export function ingestPoFiles(files: readonly File[], signal?: AbortSignal) {
  const form = new FormData()
  for (const file of files) form.append("file", file, file.name)
  return poImportFetch<PoImportIngestResponse>("/v1/ingest", {
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
  return poImportFetch<{ draft: PoImportDraft }>("/v1/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft, answers }),
    signal,
  }).then((body) => poImportDraftFromWire(body.draft))
}
