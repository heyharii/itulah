import { Check, Plus, X } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import type { NewStore, SetupStore } from "@/lib/queries/setup"
import { nextCodes, timezoneOf } from "@/screens/setup/names"

/// A store not yet opened: a row in the list somebody is typing into.
///
/// `manager` is required — the owner's decision, 2026-09-27: every store gets
/// a manager the moment it is opened, invited by the same link the rest of
/// the team is. A row with no manager is not sent; see `storesReady`.
export interface DraftStore {
  readonly key: string
  readonly name: string
  readonly city: string
  readonly manager: string
}

export function draftStore(name = "", city = "", manager = ""): DraftStore {
  return { key: crypto.randomUUID(), name, city, manager }
}

/// The rows that will actually be sent — a row with no name is a row
/// somebody pressed Enter into and has not typed in yet.
export function storesToOpen(rows: readonly DraftStore[]): NewStore[] {
  return rows
    .filter((row) => row.name.trim() !== "")
    .map((row) => ({
      name: row.name.trim(),
      city: row.city.trim(),
      manager: { name: row.manager.trim() },
    }))
}

/// Whether every row worth sending has a manager. The button that opens the
/// stores stays disabled until this is true — the server refuses a store
/// with no manager (422), and a form that let the request go anyway would
/// only be relaying that refusal a beat later.
export function storesReady(rows: readonly DraftStore[]): boolean {
  const named = rows.filter((row) => row.name.trim() !== "")
  return named.length > 0 && named.every((row) => row.manager.trim() !== "")
}

/// A row worth sending that has no manager yet — what marks the field red.
function missingManager(row: DraftStore): boolean {
  return row.name.trim() !== "" && row.manager.trim() === ""
}

/// Stores, as a list of lines rather than a form per store.
///
/// The question is "which shops do you have", and the answer somebody already
/// holds is a column of names in a spreadsheet. So the list takes that column
/// the way it arrives: pasted in one go (a name, and the city in the next
/// cell), typed one per line with Enter, or read from a CSV. One store or
/// thirty is the same gesture, which is why there is no single/bulk switch.
///
/// Only a name and a city. The city is there because it settles the clock
/// the store keeps and tells two shops of the same name apart; the street
/// address is asked for before the first delivery, not here.
///
/// Used twice: in the setup wizard, and in the Open store sheet over Locations.
export function StoreList({
  existing,
  showExisting = true,
  rows,
  onChange,
}: {
  /// Stores already opened, which the new codes follow. `null` while that is
  /// not known — the rows then say "new" rather than guess a code another
  /// store already has.
  existing: readonly SetupStore[] | null
  /// Draw them above the new rows, locked — the wizard does, so going back a
  /// step shows what was opened. The sheet over Lokasi does not: the list
  /// behind it already shows them, and fourteen rows would push the one being
  /// typed off the bottom.
  showExisting?: boolean
  rows: readonly DraftStore[]
  onChange: (rows: DraftStore[]) => void
}) {
  const codes =
    existing === null ? rows.map(() => "new") : nextCodes(existing, rows.length)
  const inputs = useRef(new Map<string, HTMLInputElement>())
  /// The row to put the caret in once the list has re-rendered with it. A ref
  /// and not state: it is a thing to do after a render, not something to draw.
  const focusNext = useRef<string | null>(null)

  useEffect(() => {
    if (focusNext.current === null) return
    inputs.current.get(focusNext.current)?.focus()
    focusNext.current = null
  })

  const set = (index: number, patch: Partial<DraftStore>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  const insert = (at: number) => {
    const row = draftStore()
    focusNext.current = row.key
    onChange([...rows.slice(0, at), row, ...rows.slice(at)])
  }

  const remove = (index: number) => {
    const rest = rows.filter((_, at) => at !== index)
    const next = rest.length === 0 ? [draftStore()] : rest
    focusNext.current = next[Math.max(0, index - 1)].key
    onChange(next)
  }

  /// A block of lines lands as that many rows, where it was pasted. The row
  /// pasted into is replaced when it was empty and kept when it was not.
  const paste = (index: number, parsed: DraftStore[]) => {
    const keep = rows[index].name.trim() !== "" ? [rows[index]] : []
    const next = [
      ...rows.slice(0, index),
      ...keep,
      ...parsed,
      ...rows.slice(index + 1),
    ]
    focusNext.current = parsed[parsed.length - 1].key
    onChange(next)
  }

  const readFile = async (file: File) => {
    const parsed = parseLines(await file.text())
    if (parsed.length === 0) return
    const kept = rows.filter((row) => row.name.trim() !== "")
    onChange([...kept, ...parsed])
  }

  return (
    <div>
      <div className="overflow-hidden rounded-card border border-hairline-2 bg-canvas shadow-soft">
        {(showExisting ? (existing ?? []) : []).map((store) => (
          <div
            key={store.unit_code}
            className="flex h-12 items-center gap-2.5 border-b border-hairline bg-soft pr-3 pl-3.5"
          >
            <span className="w-12 shrink-0 font-mono text-id text-mute">
              {store.unit_code}
            </span>
            <span className="min-w-0 flex-1 truncate text-cell text-body">
              {store.name}
            </span>
            <span className="w-32 shrink-0 truncate border-l border-hairline pl-3 text-cell text-mute">
              {store.city || "—"}
            </span>
            <span className="w-10 shrink-0 font-mono text-id text-mute">
              {store.timezone}
            </span>
            <span className="w-36 shrink-0 border-l border-hairline pl-3" />
            <Check
              className="size-4 shrink-0 text-ok"
              aria-label="Already open"
            />
          </div>
        ))}
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="group flex h-12 animate-[assistant-rise_var(--t-panel)_var(--ease-out)_both] items-center gap-2.5 border-b border-hairline pr-1.5 pl-3.5"
          >
            <span className="w-12 shrink-0 font-mono text-id text-mute">
              {codes[index]}
            </span>
            <input
              ref={(element) => {
                if (element) inputs.current.set(row.key, element)
                else inputs.current.delete(row.key)
              }}
              value={row.name}
              aria-label={`Store name ${codes[index]}`}
              onChange={(event) => set(index, { name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  insert(index + 1)
                } else if (
                  event.key === "Backspace" &&
                  row.name === "" &&
                  row.city === "" &&
                  row.manager === "" &&
                  rows.length > 1
                ) {
                  event.preventDefault()
                  remove(index)
                }
              }}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text")
                // One plain line is an ordinary paste into the box; several
                // lines, or cells separated by a tab, are a spreadsheet.
                if (!/\n|\t/.test(text.trim())) return
                const parsed = parseLines(text)
                if (parsed.length === 0) return
                event.preventDefault()
                paste(index, parsed)
              }}
              className="h-10 min-w-0 flex-1 bg-transparent text-card-title text-ink outline-none placeholder:text-faint"
            />
            <input
              value={row.city}
              aria-label={`City ${codes[index]}`}
              onChange={(event) => set(index, { city: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  insert(index + 1)
                }
              }}
              className="h-10 w-32 shrink-0 border-l border-hairline bg-transparent pl-3 text-cell text-text outline-none placeholder:text-faint"
            />
            <span className="w-10 shrink-0 font-mono text-id text-mute">
              {row.city.trim() === "" ? "" : timezoneOf(row.city)}
            </span>
            <input
              value={row.manager}
              aria-label={`Manager ${codes[index]}`}
              aria-invalid={missingManager(row) ? true : undefined}
              onChange={(event) => set(index, { manager: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  insert(index + 1)
                }
              }}
              className="h-10 w-36 shrink-0 border-l border-hairline bg-transparent pl-3 text-cell text-text outline-none placeholder:text-faint aria-[invalid=true]:bg-bad-bg/50 aria-[invalid=true]:placeholder:text-bad-fg"
            />
            <Button
              variant="quiet"
              size="icon"
              aria-label={`Remove ${row.name || codes[index]}`}
              onClick={() => remove(index)}
              className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
            >
              <X />
            </Button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => insert(rows.length)}
          className="flex h-12 w-full items-center gap-2 bg-soft px-3.5 text-cell font-medium text-body transition-colors hover:bg-soft-2 hover:text-ink"
        >
          <Plus className="size-4 text-line-ico" />
          Add store
        </button>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-mute">
        <kbd className="rounded-[0.3125rem] border border-b-2 border-hairline-2 bg-canvas px-1.5 font-mono text-id text-body">
          Enter
        </kbd>
        new row · paste from Excel (name, city, manager) ·
        <label className="cursor-pointer text-body underline decoration-hairline-strong underline-offset-[3px] hover:text-ink">
          import CSV
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readFile(file)
              event.target.value = ""
            }}
          />
        </label>
      </p>
    </div>
  )
}

/// Lines of "name, city, manager" — from a spreadsheet's clipboard (tab
/// between the cells) or a CSV (comma). A first line that reads like a
/// heading is not a store called "Nama". The third cell is new: a pasted
/// list from before the manager was required lands with that column blank,
/// same as a typed row does, and the red field says so.
function parseLines(text: string): DraftStore[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line.split(/\t|,|;/).map((cell) => cell.trim().replace(/^"|"$/g, ""))
    )
    .filter((cells) => cells[0] !== undefined && cells[0] !== "")
  const body =
    lines.length > 0 && /^(nama|name|toko)$/i.test(lines[0][0])
      ? lines.slice(1)
      : lines
  return body.map(([name, city = "", manager = ""]) =>
    draftStore(name, city, manager)
  )
}
