import { Delete } from "lucide-react"

import { cn } from "@/lib/utils"

/// **Nothing in this app imports this.** It came over with the kit from
/// `frontend-store-new`, where a cashier keys an amount; no station here types
/// a number big enough to need a pad — a tally is `components/tally.tsx`, which
/// counts by tag. Kept in step with the design system so it is not a trap if a
/// screen ever wants it, but do not read the money talk below as a description
/// of this app.
///
/// The amount keypad.
///
/// A till types money, and a phone's own keyboard is the wrong instrument for
/// it: it covers half the screen — including the total somebody is counting
/// change against — and its digits are laid out for a thumb typing words, not
/// for a hand that knows where the 7 is. So the amount is keyed here, on a grid
/// whose keys are 56px and whose layout is a calculator's, and the total stays
/// visible above it the whole time.
///
/// It works in **major units** and hands the caller minor ones. Nobody at a
/// counter types "150000" thinking in the smallest currency unit; they type the
/// number on the note.
export function Numpad({
  onDigit,
  onBackspace,
  onQuick,
  quick,
  className,
}: {
  onDigit: (digit: string) => void
  onBackspace: () => void
  /// The notes a shopper actually hands over. One tap instead of six.
  ///
  /// Deliberately the soft fill while the digits below are white: they sit in
  /// the same grid and do different things, and a cashier reaching for
  /// "50.000" should never land on a "5".
  quick?: readonly { readonly label: string; readonly minor: number }[]
  onQuick?: (minor: number) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {quick !== undefined && quick.length > 0 && onQuick !== undefined && (
        <div className="grid grid-cols-4 gap-2">
          {quick.map((note) => (
            <button
              key={note.label}
              type="button"
              onClick={() => onQuick(note.minor)}
              className="pressable h-11 rounded-inner bg-soft-2 text-cell font-medium text-text tabular-nums"
            >
              {note.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0"].map(
          (key) => (
            <Key key={key} onPress={() => onDigit(key)}>
              {key}
            </Key>
          ),
        )}
        <Key onPress={onBackspace} aria-label="Delete the last digit">
          <Delete className="size-5 text-line-ico" />
        </Key>
      </div>
    </div>
  )
}

function Key({
  onPress,
  children,
  ...props
}: {
  onPress: () => void
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onPress}
      // A key is WHITE with a hairline and a whisper shadow, not a grey fill —
      // the same recipe as `Button variant="ghost"`, and the same one the POS
      // prototype draws its pad with. A grid of grey fills reads as one
      // surface with lines scored into it; white keys with an edge read as
      // twelve separate things to hit, which is what the hand is looking for.
      className="pressable grid h-14 place-items-center rounded-inner border border-hairline-2 bg-canvas text-[1.25rem] font-medium text-ink tabular-nums shadow-soft active:bg-soft-2"
      {...props}
    >
      {children}
    </button>
  )
}
