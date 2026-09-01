import { Delete } from "lucide-react"

import { cn } from "@/lib/utils"

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
              className="pressable h-11 rounded-full bg-soft-2 text-[0.84375rem] font-medium text-text tabular-nums"
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
      className="pressable grid h-14 place-items-center rounded-inner bg-soft-2 text-[1.25rem] font-medium text-ink tabular-nums"
      {...props}
    >
      {children}
    </button>
  )
}
