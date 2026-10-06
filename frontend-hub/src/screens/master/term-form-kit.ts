import { useCallback, useState } from "react"

/// The non-visual half of what the master-data sheets share — see
/// `term-form.tsx` for the parts that draw.

/// A key held across retries and rotated after a success.
///
/// The point of an idempotency key is that a retry carries the SAME one, so the
/// server replays its first answer instead of writing a second row. Minted
/// inside the mutation it would be a fresh key per click, and a double-clicked
/// save would be two rows with the same label — the one thing the unique index
/// then refuses, leaving somebody staring at a duplicate error they caused by
/// clicking twice.
export function useIdempotencyKey(): {
  readonly key: string
  readonly rotate: () => void
} {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// The server's own sentence about why a write was refused.
///
/// `ApiError` carries the node's message, and the refusal these forms expect
/// most is a duplicate label — where the node names the row that already holds
/// the word. A generic line would throw exactly that away.
export function said(error: unknown): string {
  return error instanceof Error ? error.message : "That did not save."
}

/// `Navy Blue` → `NAVY_BLUE`: the code suggested from a label, upper snake, the
/// shape divisions, tags and colours all use.
export function snake(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/// A code for a term nobody types one for (owner, 2026-10-07): the label in
/// upper snake, and `_2`, `_3` … after it while that is taken. A label with
/// nothing in it to make a code from falls back to `ITEM`. A code is permanent
/// once an article points at it, so it is chosen once, at saving, and shown
/// afterwards as a fact.
export function codeFromLabel(
  label: string,
  taken: Iterable<string>,
  fallback = "ITEM"
): string {
  const used = new Set(taken)
  const base = snake(label) || fallback
  let code = base
  for (let n = 2; used.has(code); n++) code = `${base}_${n}`
  return code
}

/// Nothing is called wrong before it has been touched: a new form used to open
/// red, an error under every empty box. A gap is named once its field has been
/// left, or once Submit has been pressed on a form that is not ready.
export function useReveal(): {
  /// Call from `onSubmit`, before deciding whether to send.
  readonly attempt: () => void
  readonly reveal: (
    touched: boolean,
    problem: string | undefined
  ) => string | undefined
} {
  const [tried, setTried] = useState(false)
  return {
    attempt: () => setTried(true),
    reveal: (touched, problem) => (tried || touched ? problem : undefined),
  }
}

/// Which fields have been left, for the forms that keep their fields in plain
/// state rather than in a form library. Pair with `useReveal`: a gap is named
/// once its field is touched, or once Submit has been pressed.
export function useTouched(): {
  readonly isTouched: (name: string) => boolean
  readonly touch: (name: string) => void
} {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  return {
    isTouched: (name) => seen.has(name),
    touch: (name) =>
      setSeen((current) =>
        current.has(name) ? current : new Set(current).add(name)
      ),
  }
}
