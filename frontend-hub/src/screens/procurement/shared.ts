import { useCallback, useState } from "react"

import { useIdentity } from "@/lib/session"
import type { VocabularyTerm } from "@itulah/contract"

/// Helpers the procurement screens share. Non-components only, so the screens
/// beside it stay fast-refreshable.

/// Who is doing this.
///
/// Four purchasing writes name their actor in the body rather than taking it
/// from the session — `decided_by`, `closed_by`, `issued_by`, `created_by` —
/// because the server records them as facts about a decision and not about a
/// request. The screen therefore has to say who, and the only honest answer is
/// the signed-in user. Empty until `/auth/me` has answered, which is why the
/// buttons that need it are disabled while it is.
export function useActor(): string {
  const identity = useIdentity()
  return identity.data?.username ?? ""
}

/// A key generated once and held across retries, then rotated after a success.
///
/// The point of an idempotency key is that a retry carries the SAME one — the
/// server replays its first answer instead of writing twice — so it must not be
/// regenerated on every render or every click. Rotating after a success is what
/// makes the next, genuinely different write a new one rather than a replay of
/// the last.
export function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// `KAUS_KAKI` → "Kaus Kaki", using the vocabulary the server sent.
///
/// Falls back to the code rather than to a blank: an unknown code is a screen
/// showing something the vocabulary has not caught up with, and hiding it would
/// make the row look unclassified when it is not.
export function termLabel(
  terms: readonly VocabularyTerm[] | undefined,
  code: string | null | undefined
): string {
  if (!code) return "—"
  return terms?.find((term) => term.code === code)?.label ?? code
}

/// `03` → "M", using the size table the server sent.
///
/// Falls back to the code, like `termLabel` does and for the same reason. It
/// replaces a hardcoded map transcribed from the `size_code` seed, which was
/// correct on the day it was written and silently read `21` for anything added
/// after it.
export function sizeLabel(
  sizes: readonly VocabularyTerm[] | undefined,
  code: string
): string {
  return sizes?.find((term) => term.code === code)?.label ?? code
}

/// "XS–XXL", or the one size when there is only one.
///
/// The ends rather than the whole list: something carrying eight sizes would
/// spend a card's width saying what its two ends already say. The server sends
/// size codes in size order, so the ends are the first and the last rather
/// than a sort every caller has to redo.
export function sizeSpan(
  sizes: readonly VocabularyTerm[] | undefined,
  codes: readonly string[]
): string {
  if (codes.length === 0) return "—"
  if (codes.length === 1) return sizeLabel(sizes, codes[0])
  return `${sizeLabel(sizes, codes[0])}–${sizeLabel(sizes, codes[codes.length - 1])}`
}

/// Toggle one value in a facet selection.
///
/// A facet is a set: a buyer looking at kids and footwear is looking at both,
/// not at the intersection of the two, which is empty.
export function toggle(
  values: readonly string[],
  value: string
): readonly string[] {
  return values.includes(value)
    ? values.filter((each) => each !== value)
    : [...values, value]
}
