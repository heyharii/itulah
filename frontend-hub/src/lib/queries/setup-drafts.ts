import { ApiError } from "@itulah/contract/client"
import { node } from "@/lib/api"
import type { SetupDraft } from "@/screens/procurement/setup-draft"

/// The New Articles form, kept on the server per delivery line (0956), so a
/// delivery half-named at one desk can be finished at another. One shared draft
/// per line and the last save wins. The server never reads it: `payload` is the
/// form exactly as the screen saved it.
export interface SetupDraftMeta {
  readonly receipt_line_id: string
  readonly saved_by: string
  readonly saved_at: string
}

export interface ServerSetupDraft extends SetupDraftMeta {
  readonly payload: SetupDraft
}

export const setupDraftKeys = {
  all: ["setup-drafts"] as const,
  list: () => ["setup-drafts", "list"] as const,
  line: (receiptLineId: string) =>
    ["setup-drafts", "line", receiptLineId] as const,
}

/// Which lines have a draft, without the drafts: it only marks waiting rows.
export function listSetupDrafts(signal?: AbortSignal) {
  return node.get<SetupDraftMeta[]>("/api/v1/article-setups/drafts", {
    signal,
  })
}

/// Null when the line has none: that is the usual answer, not a failure.
export async function getSetupDraft(
  receiptLineId: string,
  signal?: AbortSignal
): Promise<ServerSetupDraft | null> {
  try {
    return await node.get<ServerSetupDraft>(
      `/api/v1/article-setups/drafts/${encodeURIComponent(receiptLineId)}`,
      { signal }
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export function saveSetupDraft(receiptLineId: string, payload: SetupDraft) {
  return node.put<ServerSetupDraft>(
    `/api/v1/article-setups/drafts/${encodeURIComponent(receiptLineId)}`,
    { payload }
  )
}

export function deleteSetupDraft(receiptLineId: string) {
  return node.delete<void>(
    `/api/v1/article-setups/drafts/${encodeURIComponent(receiptLineId)}`
  )
}
