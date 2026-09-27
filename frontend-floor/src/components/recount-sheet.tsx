import { useState } from "react"

import { Button } from "@/components/ui/button"
import { CountPad } from "@/components/ui/count-pad"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { Banner } from "@/components/ui/states"
import { count } from "@/lib/format"

/// Setting a line's number outright — the trolley's, the carton's — instead of
/// pressing + forty times.
///
/// What is typed REPLACES the line; it is not added to it (adding is the scan
/// sheet's job, `SkuEntry`). An untouched pad keeps what the line already has,
/// shown faintly, so opening the sheet by accident and pressing the button
/// changes nothing. Zero takes the line off, and the button says so in red
/// before it is pressed.
///
/// Opened from `TallyRow`'s `onCount`. Ambil and Kemas share it, so the two
/// stations set a number the same way.
export function RecountSheet({
  open,
  code,
  name,
  have,
  note,
  where,
  problem,
  onSet,
  onClose,
}: {
  open: boolean
  code: string
  name: string
  /// What the line holds now.
  have: number
  note?: React.ReactNode
  /// Where the line lives, for the words: "troli", "koli".
  where: string
  /// Why the node would refuse this number, if it would — packing is bounded,
  /// picking is not. Setting it disables the button.
  problem?: (quantity: number) => string | null
  onSet: (quantity: number) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState("")
  const quantity = typed === "" ? have : Number(typed)
  const refused = quantity === 0 ? null : (problem?.(quantity) ?? null)

  const close = () => {
    onClose()
    setTyped("")
  }

  const commit = () => {
    if (refused !== null) return
    onSet(quantity)
    close()
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={name}
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <span className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0 font-mono text-[0.6875rem] text-mute">
            {code}
          </span>
          {note}
        </span>

        {refused !== null && <Banner tone="bad">{refused}</Banner>}

        <CountPad
          label={`Jumlah di ${where} untuk ${code}`}
          value={typed}
          onChange={setTyped}
          onEnter={commit}
          placeholder={count(have)}
          unit="potong"
          maxDigits={4}
        />

        <Button
          variant={quantity === 0 ? "danger" : "primary"}
          size="lg"
          block
          disabled={refused !== null}
          onClick={commit}
        >
          {quantity === 0
            ? `Keluarkan dari ${where}`
            : `Simpan ${count(quantity)}`}
        </Button>
      </div>
    </BottomSheet>
  )
}
