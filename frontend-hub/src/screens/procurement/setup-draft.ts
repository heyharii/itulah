import type { ArticleTab } from "@/screens/procurement/setup-split-model"
import type { Pricing } from "@/screens/procurement/line-pricing-model"

/// The New Articles form, kept as it stands (owner, 2026-10-06): a delivery
/// line half-named is a draft, not a loss. Saved in this browser as the form
/// changes, per delivery line, and given back when that line is opened again;
/// gone once the line has its identity.
const KEY = "central.new-articles.drafts"

export interface SetupDraft {
  readonly tabs: readonly ArticleTab[]
  readonly tabAt: number
  readonly nextTabId: number
  readonly name: string
  readonly division: string
  readonly tags: readonly string[]
  readonly pricing: Pricing
}

function all(): Record<string, SetupDraft> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, SetupDraft>)
      : {}
  } catch {
    return {}
  }
}

export function readSetupDraft(receiptLineId: string): SetupDraft | null {
  const found = all()[receiptLineId]
  return found !== undefined &&
    Array.isArray(found.tabs) &&
    found.tabs.length > 0
    ? found
    : null
}

export function writeSetupDraft(receiptLineId: string, draft: SetupDraft) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...all(), [receiptLineId]: draft })
    )
  } catch {
    // Storage denied: the form simply is not kept.
  }
}

export function clearSetupDraft(receiptLineId: string) {
  try {
    const rest = all()
    delete rest[receiptLineId]
    localStorage.setItem(KEY, JSON.stringify(rest))
  } catch {
    // Nothing kept, nothing to clear.
  }
}
