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

/// A keystroke must not cost a read and a rewrite of the whole draft map, and
/// the map is one localStorage entry, so writes are held briefly and land
/// together. The hold is short — a quick close must not lose the form — and
/// the flush is bound to the two events that fire when that happens.
const WRITE_AFTER_MS = 300

const pending = new Map<string, SetupDraft>()
let timer: number | undefined
let closeBound = false

function flush(): void {
  clearTimeout(timer)
  timer = undefined
  if (pending.size === 0) return
  const writes = [...pending]
  pending.clear()
  try {
    const drafts = all()
    for (const [receiptLineId, draft] of writes)
      drafts[receiptLineId] = draft
    localStorage.setItem(KEY, JSON.stringify(drafts))
  } catch {
    // Storage denied: the form simply is not kept.
  }
}

function bindFlushOnClose(): void {
  if (closeBound) return
  closeBound = true
  // `pagehide` is the one a phone or a closed tab actually fires;
  // `beforeunload` covers the desktop's own habit. Either way the held draft
  // lands before the page is gone.
  window.addEventListener("pagehide", flush)
  window.addEventListener("beforeunload", flush)
}

export function writeSetupDraft(receiptLineId: string, draft: SetupDraft) {
  pending.set(receiptLineId, draft)
  bindFlushOnClose()
  // `window.setTimeout`, not bare `setTimeout`: the browser's number handle
  // is what `timer` holds, and `clearTimeout` takes either.
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(flush, WRITE_AFTER_MS)
}

export function clearSetupDraft(receiptLineId: string) {
  // A clear outruns the debounce, and takes any held write for the line with
  // it — a draft cleared because the line got its identity must not be
  // resurrected by a keystroke still waiting to land.
  pending.delete(receiptLineId)
  try {
    const rest = all()
    delete rest[receiptLineId]
    localStorage.setItem(KEY, JSON.stringify(rest))
  } catch {
    // Nothing kept, nothing to clear.
  }
}
