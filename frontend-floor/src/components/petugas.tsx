import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { setPetugas, usePetugas } from "@/lib/petugas"
import { cn } from "@/lib/utils"
import { useSignInOff } from "@/lib/session"

/// "Who is doing this", on a node without sign-in — see `lib/petugas.ts`.
///
/// Renders nothing where sign-in is on. Where it is off it is one line: the
/// name the work will carry, and the control to change it. Open by default
/// while nobody is named, because an unnamed count is a count the next person
/// on this phone cannot verify.
export function NamaPetugas({ className }: { className?: string }) {
  const off = useSignInOff()
  const petugas = usePetugas()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (!off) return null

  if (petugas !== null && !editing) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-inner border border-hairline bg-canvas px-3.5 py-2",
          className,
        )}
      >
        <span className="text-meta text-body">
          Petugas: <span className="font-semibold text-ink">{petugas}</span>
        </span>
        <Button
          variant="quiet"
          onClick={() => {
            setDraft("")
            setEditing(true)
          }}
        >
          Ganti
        </Button>
      </div>
    )
  }

  const save = () => {
    if (draft.trim() === "") return
    setPetugas(draft)
    setEditing(false)
  }

  return (
    <form
      className={cn("flex items-center gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Input
        aria-label="Nama petugas"
        placeholder="Nama Anda"
        value={draft}
        autoFocus={editing}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button type="submit" variant="primary" disabled={draft.trim() === ""}>
        Saya
      </Button>
    </form>
  )
}
