import { Fragment } from "react"

/// No F-keys anywhere in the till (client, 28 Oct 2026): Shift and a digit of
/// the main row do what F2…F9 did (⇧2 Cek … ⇧9 Tunda), Shift+0 is Struk, and
/// Bayar is Enter. Named by `event.code`, see `shortcuts.ts`.
/// [keycap, the name `useShortcuts` and `isKey` take].
export const CHECK_KEY = ["⇧2", "Shift+2"] as const
export const DRAWER_KEY = ["⇧3", "Shift+3"] as const
export const CLOSE_KEY = ["⇧4", "Shift+4"] as const
export const MEMBER_KEY = ["⇧5", "Shift+5"] as const
export const BAGS_KEY = ["⇧6", "Shift+6"] as const
export const CANCEL_KEY = ["⇧7", "Shift+7"] as const
export const RETURN_KEY = ["⇧8", "Shift+8"] as const
export const HOLD_KEY = ["⇧9", "Shift+9"] as const
export const RECEIPTS_KEY = ["⇧0", "Shift+0"] as const

/// 7Soft's toolbar: each key a keycap over its word, in the keyboard's own
/// order and groups, so a cashier who never touches the mouse reads the row the
/// way the keys lie under her fingers. Numpad + and − are New and Remove.
///
/// A tile is a button too, and it does exactly what its key does: `till.tsx`
/// hands both the same functions, so a key and its tile can never disagree.

export type KeyId =
  | "new"
  | "remove"
  | "check"
  | "drawer"
  | "close"
  | "member"
  | "bags"
  | "cancel"
  | "return"
  | "hold"
  | "receipts"
  | "pay"

/// [keycap, word, id, aria-keyshortcuts]. A gap is drawn before the first key of
/// each group: ⇧2, ⇧5 and ⇧9. Kantong (⇧6) and Bayar (Enter) are not on the row:
/// they sit together in the floating card at the foot of the sale list
/// (client, 23 Oct 2026) and still answer their keys. ⇧0 is Struk, found by its
/// number only (28 Oct 2026); there is no Void, no Diskon and no Tukar poin:
/// the node's promotions show on their lines and on the struk, and points are
/// spent in Bayar.
const KEYS: readonly (readonly [string, string, KeyId, string])[] = [
  ["+", "Tambah", "new", "Add"],
  ["−", "Kurangi", "remove", "Subtract"],
  [CHECK_KEY[0], "Cek", "check", CHECK_KEY[1]],
  [DRAWER_KEY[0], "Laci", "drawer", DRAWER_KEY[1]],
  [CLOSE_KEY[0], "Tutup kasir", "close", CLOSE_KEY[1]],
  [MEMBER_KEY[0], "Member", "member", MEMBER_KEY[1]],
  [CANCEL_KEY[0], "Batal", "cancel", CANCEL_KEY[1]],
  [RETURN_KEY[0], "Return", "return", RETURN_KEY[1]],
  [HOLD_KEY[0], "Tunda", "hold", HOLD_KEY[1]],
  // No Struk on the bar (Hari, 29 Oct 2026): a struk is found inside Return.
]

const GROUP_STARTS: ReadonlySet<KeyId> = new Set(["check", "member", "hold"])

/// Cancel is the one that undoes; Pay is the one that finishes.
const TONE: Partial<Record<KeyId, string>> = {
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
