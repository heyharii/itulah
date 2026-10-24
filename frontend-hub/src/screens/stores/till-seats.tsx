import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { setTillSeats, storesKeys } from "@/lib/queries/stores"
import { saying } from "@/screens/system/units"

/// "Till seats: 2 · Change" on the Overview's facts — how many drawers the
/// counter has, Till 1 to Till N. Head office decides it: an Admin presses
/// Change and edits the number in place; anyone else just reads it. The same
/// write the Devices tab's seats card made (`setTillSeats`), kept as one line
/// because fewer seats never ends a shift (a drawer still open at a removed
/// seat stays listed until it is closed), so there is nothing to confirm.
export function TillSeatsValue({
  unit,
  seats,
  canManage,
}: {
  unit: string
  seats: number
  canManage: boolean
}) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(seats))
  const count = Number(draft)
  const valid = Number.isInteger(count) && count >= 1 && count <= 50

  const save = useMutation({
    mutationFn: () => setTillSeats(unit, count),
    onSuccess: (detail) => {
      client.setQueryData(storesKeys.detail(unit), detail)
      void client.invalidateQueries({ queryKey: storesKeys.list() })
      setDraft(String(detail.store.tills.seats))
      setEditing(false)
    },
  })

  if (!editing) {
    return (
      <>
        {seats}
        {canManage && (
          <>
            {" · "}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => {
                setDraft(String(seats))
                save.reset()
                setEditing(true)
              }}
            >
              Change
            </button>
          </>
        )}
      </>
    )
  }

  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={50}
          inputMode="numeric"
          autoFocus
          aria-label="Number of POS seats"
          className="w-20"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={!valid || count === seats}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button data-cancel variant="quiet" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </span>
      {save.isError && (
        <span className="text-meta text-bad-fg">{saying(save.error)}</span>
      )}
    </span>
  )
}
