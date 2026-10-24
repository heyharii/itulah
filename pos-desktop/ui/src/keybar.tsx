import { Fragment } from "react"

/// 7Soft's toolbar: each key a keycap over its word, in the keyboard's own
/// order and groups, so a cashier who never touches the mouse reads the row the
/// way the keys lie under her fingers. Numpad + and − are New and Remove.
///
/// A tile is a button too, and it does exactly what its key does: `till.tsx`
/// hands both the same functions, so a key and its tile can never disagree.

export type KeyId =
  | "new"
  | "remove"
  | "void"
  | "check"
  | "drawer"
  | "close"
  | "member"
  | "bags"
  | "cancel"
  | "return"
  | "hold"
  | "pay"

/// [keycap, word, id, aria-keyshortcuts]. A gap is drawn before the first key of
/// each group: F1, F5 and F9. Kantong (F6) and Bayar (F12) are not on the row:
/// they sit together in the floating card at the foot of the sale list
/// (client, 23 Oct 2026) and still answer their keys. There is no F10 Diskon and
/// no F11 Tukar poin (24 Oct 2026): the node's promotions show on their lines
/// and on the struk, and points are spent in Bayar.
const KEYS: readonly (readonly [string, string, KeyId, string])[] = [
  ["+", "Tambah", "new", "Add"],
  ["−", "Kurangi", "remove", "Subtract"],
  ["F1", "Void", "void", "F1"],
  ["F2", "Cek", "check", "F2"],
  ["F3", "Laci", "drawer", "F3"],
  ["F4", "Tutup kasir", "close", "F4"],
  ["F5", "Member", "member", "F5"],
  ["F7", "Batal", "cancel", "F7"],
  ["F8", "Return", "return", "F8"],
  ["F9", "Tunda", "hold", "F9"],
]

const GROUP_STARTS: ReadonlySet<KeyId> = new Set(["void", "member", "hold"])

/// Void and Cancel are the two that undo; Pay is the one that finishes.
const TONE: Partial<Record<KeyId, string>> = {
  void: " bad",
  cancel: " bad",
  pay: " go",
}

export function KeyBar({
  onKey,
  off,
  on = {},
  count = {},
}: {
  onKey: (id: KeyId) => void
  /// Keys that mean nothing right now (an empty basket has nothing to remove).
  off: Partial<Record<KeyId, boolean>>
  /// Keys whose panel is open.
  on?: Partial<Record<KeyId, boolean>>
  /// A small number on a tile — how many baskets are held.
  count?: Partial<Record<KeyId, number>>
}) {
  return (
    <div className="t-keys7" role="toolbar" aria-label="Tombol">
      {KEYS.map(([cap, word, id, shortcut]) => {
        const many = count[id] ?? 0
        return (
          <Fragment key={id}>
            {GROUP_STARTS.has(id) && <span className="k7-gap" />}
            <button
              type="button"
              className={`k7${TONE[id] ?? ""}${on[id] === true ? " on" : ""}`}
              disabled={off[id] === true}
              aria-keyshortcuts={shortcut}
              aria-pressed={on[id] === undefined ? undefined : on[id] === true}
              onClick={() => onKey(id)}
            >
              <span className="k7-k" aria-hidden="true">
                {cap}
              </span>
              <span className="k7-l">{word}</span>
              {many > 0 && <span className="k7-n">{many}</span>}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
