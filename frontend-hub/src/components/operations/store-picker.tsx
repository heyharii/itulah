import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { dc } from "@/lib/api"
import { keys } from "@/lib/operations/keys"
import { useSheet } from "@/lib/sheets"

/// "Which shop?" — asked identically by three screens, so asked once here.
///
/// An edge node has **no list of destinations**. Allotments are authored at
/// the centre and this DC only ever learns a shop's id by having packed for
/// it, so the answer is a typed id with the shops it recognises offered as
/// chips beside it. A closed dropdown would make a shop's first ever carton
/// impossible.
///
/// Two details that are the whole reason this is a component rather than three
/// inline inputs:
///
///  - **The text is local until it is submitted.** The chosen shop lives in
///    the URL (`?store=`), and writing it on every keystroke would be one
///    router navigation per character — twelve history-adjacent updates to
///    type one store id.
///  - **The field follows the URL.** A chip, a pasted link and the command
///    palette all set `?store=` from outside this input; `key={value}`
///    remounts it so it shows what the screen is actually reading, rather than
///    whatever was typed into it last.
export function StorePicker({
  title = "Which shop",
  hint,
}: {
  title?: string
  hint?: React.ReactNode
}) {
  const store = useSheet("store")
  const chosen = store.value ?? null

  // The shops this node has actually packed for. A cached read the packing
  // screens already hold, so this costs nothing on a warm tab.
  const boxes = useQuery({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })
  const known = Array.from(
    new Set((boxes.data ?? []).map((box) => box.destination_store_id))
  ).sort()

  return (
    <Card className="mb-[1.125rem] overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {chosen && <Pill tone="accent">{chosen}</Pill>}
      </CardHeader>

      <Entry
        // Remount when the URL changes from outside, so the field never
        // disagrees with the screen it sits above.
        key={chosen ?? ""}
        initial={chosen ?? ""}
        onChoose={(value) =>
          value === "" ? store.close() : store.replace(value)
        }
      />

      {hint && <p className="px-4 pb-3 text-[0.875rem] text-mute">{hint}</p>}

      {known.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-hairline px-4 py-3">
          {known.map((shop) => (
            <button
              key={shop}
              type="button"
              onClick={() => store.replace(shop)}
              className={`min-h-[2.25rem] rounded-full px-3 font-mono text-[0.875rem] transition-colors ${
                shop === chosen
                  ? "bg-accent-bg text-accent"
                  : "bg-soft-2 text-body hover:bg-soft-3 hover:text-ink"
              }`}
            >
              {shop}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

function Entry({
  initial,
  onChoose,
}: {
  initial: string
  onChoose: (value: string) => void
}) {
  const [typed, setTyped] = useState(initial)
  return (
    <form
      className="flex gap-2 border-t border-hairline px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        onChoose(typed.trim())
      }}
    >
      <Input
        className="flex-1 font-mono"
        placeholder="Store id"
        aria-label="Destination store"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        // A gun scans a store id and presses Enter; blur covers a thumb that
        // taps straight to the next control instead.
        onBlur={() => onChoose(typed.trim())}
      />
      <Button type="submit" variant="soft">
        Use it
      </Button>
    </form>
  )
}
