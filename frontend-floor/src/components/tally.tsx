import { Minus, Plus, X } from "lucide-react"

import { cn } from "@/lib/utils"

/// One line of what is in hand: what it is, how many, and the keys that change
/// that.
///
/// Picking and packing both build a tally, but they do **not** agree about what
/// the number means, so this row judges nothing on its own. It draws what it is
/// told to draw:
///
///   - a picker types a SKU and a number, and the racks answer with what they
///     have. Nothing is over or under — "asked for 300, found 200" is a
///     statement about the racks, and `edge/sqlite.rs` records it as one.
///   - a packer is bounded: the node refuses a carton asking for more than is
///     standing in the picking area, and refuses a piece with no allotment for
///     that shop at all.
///
/// So the caller passes a `note` — the pill that says what this line's number
/// means at this station — and a `tone` that says whether it is a problem.
export function TallyRow({
  name,
  code,
  have,
  note,
  tone = "normal",
  onLess,
  onMore,
  onRemove,
}: {
  name: string
  code: string
  have: number
  /// What the number means here: "diminta 12", "bisa dikemas 3", "tidak diminta
  /// toko". Pass `null` for a line that needs no explanation.
  note?: React.ReactNode
  /// `bad` outlines the card — used where the node would refuse what is typed.
  tone?: "normal" | "ok" | "bad"
  onLess: () => void
  onMore: () => void
  /// Taking the whole line off the sheet. A picker who typed 40 against the
  /// wrong SKU should not have to press minus forty times.
  onRemove?: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-card border bg-canvas px-3 py-2.5 shadow-soft",
        tone === "bad"
          ? "border-bad"
          : tone === "ok"
            ? "border-ok"
            : "border-hairline",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{name}</span>
        {/* Wraps rather than truncates, and the code is what must never be the
            thing that gives way: it is the identity somebody checks against the
            tag in their hand, and `000000…` is not one. Vertical space on a
            phone list is cheap; a half-printed SKU is a mis-pick. */}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 font-mono text-[0.65625rem] text-mute">
            {code}
          </span>
          {note}
        </span>
      </span>

      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={onLess}
          disabled={have === 0}
          aria-label={`Kurangi ${code}`}
          className="pressable grid size-11 place-items-center rounded-inner bg-soft-2 text-line-ico disabled:opacity-40"
        >
          <Minus className="size-[1.125rem]" />
        </button>
        <span className="w-8 text-center text-[1.0625rem] font-semibold text-ink tabular-nums">
          {have}
        </span>
        <button
          type="button"
          onClick={onMore}
          aria-label={`Tambah ${code}`}
          className="pressable grid size-11 place-items-center rounded-inner bg-cta text-cta-fg"
        >
          <Plus className="size-[1.125rem]" />
        </button>
        {onRemove !== undefined && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Hapus ${code} dari daftar`}
            className="pressable grid size-11 place-items-center rounded-inner text-line-ico"
          >
            <X className="size-[1.125rem]" />
          </button>
        )}
      </span>
    </div>
  )
}
