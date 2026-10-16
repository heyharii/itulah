import { Dialog } from "@base-ui/react/dialog"
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input, Money, Select } from "@/components/ui/field"
import { hrKeys, readMonth, type StoreScope } from "@/lib/queries/hr"
import {
  netOf,
  saveLines,
  signedMoney,
  usableComponents,
  type LineDraft,
  type PayLine,
  type Sign,
} from "@/lib/queries/payroll"
import { cn } from "@/lib/utils"
import { describeCentre } from "@/screens/hr/centre"
import { money } from "@itulah/contract/money"
import type { PayComponentView, PayrollAdjustmentRow } from "@itulah/contract"

/// Whose month the Adjust dialog is open on. `seq` is new on every opening,
/// so the form starts again from the lines as they stand rather than from what
/// was typed the last time.
export interface AdjustTarget {
  readonly seq: number
  readonly employeeId: string
  readonly name: string
  /// The person's total as HO has it, the shop's current lines included.
  readonly total: number | null
  /// The shop's lines as they stand.
  readonly lines: readonly PayLine[]
}

/// "Adjust" — a centred dialog, not a sheet: it is one short form about one
/// card, and the card should still be in sight around it.
///
///   Adjust
///   Siti Rahma · October 2026
///   [+] [Insentif penjualan        ] [Rp    150.000] [×]
///   [−] [Selisih kas               ] [Rp     45.000] [×]
///   + Add a line
///   ┌ Total now ─────── Adjustment ─────── After adjustment ┐
///   └ —                 +Rp 105.000                       — ┘
///                                           [Cancel] [Save]
///
/// Each line is an addition or a deduction with its own name and total. At
/// the centre a line is a one-off under one of HO's `PER_OCCASION` components
/// (`lib/queries/payroll.ts`): the sign picks the direction, the name travels
/// as the reason, and the component is named under the line — chosen when HO
/// offers more than one for that direction, said when it offers one, because
/// it is what the payslip will print. The centre keeps one line per
/// component, so "Add a line" stops when every component has one.
///
/// The three figures are the person's total before the shop's lines, the
/// lines, and the two together. The total is HO's and not relayed (`total` is
/// `null`), so two of the three are dashes until it is; the adjustment is
/// always real.
///
/// Always mounted, opened and closed by `open`, so it grows in and fades out
/// rather than appearing: a dialog mounted already open has nothing to
/// transition from.
export function AdjustDialog({
  open,
  onClose,
  onSaved,
  scope,
  period,
  target,
  catalogue,
}: {
  open: boolean
  onClose: () => void
  onSaved: (employeeId: string) => void
  scope: StoreScope
  period: string
  target: AdjustTarget | null
  /// HO's components: `undefined` while being read, an `Error` when refused.
  catalogue: readonly PayComponentView[] | Error | undefined
}) {
  const client = useQueryClient()
  const popup = useRef<HTMLDivElement>(null)
  const firstName = useRef<HTMLInputElement>(null)
  // Here rather than in the form, so a press outside cannot close the dialog
  // under a save that is on its way.
  const save = useMutation({
    mutationFn: (input: Save) =>
      saveLines({
        place: scope.unit_id,
        period,
        employeeId: input.employeeId,
        lines: input.lines,
      }),
    onSuccess: (rows, input) => {
      client.setQueryData(hrKeys.adjustments(scope.unit_id, period), rows)
      onSaved(input.employeeId)
    },
    // A refusal half way has still done the half before it: read the month
    // back so the card behind the dialog shows what the centre now holds.
    onError: () =>
      client.invalidateQueries({
        queryKey: hrKeys.adjustments(scope.unit_id, period),
      }),
  })
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !save.isPending) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[var(--scrim)] transition-opacity duration-(--t-pop) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          ref={popup}
          // A finger gets the dialog, not a keyboard over it; a mouse gets the
          // first name, ready to type.
          initialFocus={() =>
            window.matchMedia("(pointer: coarse)").matches
              ? popup.current
              : (firstName.current ?? true)
          }
          className={cn(
            "@container fixed left-1/2 z-40 flex max-h-[calc(100dvh-2rem)] w-[min(35rem,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-shell bg-canvas p-5 shadow-float outline-none",
            // Centred on a desk. On a phone it hangs from the top, so the
            // number pad rising from the bottom leaves the line in sight.
            "top-1/2 -translate-y-1/2 max-md:top-[calc(env(safe-area-inset-top,0px)+0.75rem)] max-md:translate-y-0",
            // Grows out of the middle from a touch short of full size, and
            // leaves faster than it came. Reduced motion keeps the fade.
            "origin-center transition-[scale,opacity] duration-(--t-panel) ease-(--ease-out)",
            "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
            "motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100",
          )}
        >
          {target !== null && (
            <AdjustForm
              key={target.seq}
              period={period}
              target={target}
              catalogue={catalogue}
              firstName={firstName}
              save={save}
              onClose={onClose}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// The dialog's body: the lines, the figures, and the two buttons.
function AdjustForm({
  period,
  target,
  catalogue,
  firstName,
  save,
  onClose,
}: {
  period: string
  target: AdjustTarget
  catalogue: readonly PayComponentView[] | Error | undefined
  firstName: React.RefObject<HTMLInputElement | null>
  save: UseMutationResult<PayrollAdjustmentRow[], Error, Save>
  onClose: () => void
}) {
  const minted = useRef(0)
  const mint = () => `line-${(minted.current += 1)}`
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    target.lines.length > 0
      ? target.lines.map((line) => ({
          key: mint(),
          id: line.id,
          sign: line.sign,
          code: line.code,
          label: line.label,
          name: line.name,
          amount: String(line.amountMinor),
        }))
      : [blank(mint(), 1)],
  )
  const [focus, setFocus] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const ready = Array.isArray(catalogue)
  const components = ready ? catalogue : []
  const plus = usableComponents(components, 1)
  const minus = usableComponents(components, -1)
  const offered = (sign: Sign) => (sign > 0 ? plus : minus)
  const codes = resolve(drafts, offered)
  const free = (sign: Sign) =>
    offered(sign).some((one) => !codes.includes(one.code))
  const canAdd = ready && (free(1) || free(-1))
  const delta = netOf(
    drafts.map((draft) => ({
      sign: draft.sign,
      amountMinor: Number(draft.amount === "" ? "0" : draft.amount),
    })),
  )
  const before = target.total === null ? null : target.total - netOf(target.lines)

  // The save's own answer, and only for this opening: a refusal from the
  // last person's dialog is not this one's.
  const mine = save.variables?.seq === target.seq
  const pending = mine && save.isPending

  const change = (at: number, patch: Partial<Draft>) => {
    setProblem(null)
    setDrafts((was) =>
      was.map((draft, index) =>
        index === at ? { ...draft, ...patch } : draft,
      ),
    )
  }

  const submit = () => {
    if (pending || !ready) return
    // A line left wholly blank is not a line.
    const kept = drafts
      .map((draft, at) => ({ draft, code: codes[at] ?? "" }))
      .filter(({ draft }) => draft.name.trim() !== "" || draft.amount !== "")
    if (
      kept.some(
        ({ draft }) =>
          draft.name.trim() === "" || Number(draft.amount || "0") <= 0,
      )
    ) {
      setProblem("Give each line a name and a total")
      return
    }
    if (kept.some(({ code }) => code === "")) {
      setProblem("HO has not set up store adjustments yet")
      return
    }
    const chosen = kept.map(({ code }) => code)
    const twice = chosen.find((code, at) => chosen.indexOf(code) !== at)
    if (twice !== undefined) {
      setProblem(`${labelOf(twice, components, drafts)} is on two lines`)
      return
    }
    if (kept.length === 0 && target.lines.length === 0) {
      onClose()
      return
    }
    save.mutate({
      seq: target.seq,
      employeeId: target.employeeId,
      lines: kept.map(({ draft, code }) => ({
        id: draft.id,
        code,
        name: draft.name,
        amountMinor: Number(draft.amount),
      })),
    })
  }

  const said =
    problem ??
    (catalogue instanceof Error
      ? describeCentre(catalogue, "HO's pay components")
      : mine && save.error !== null
        ? describeCentre(save.error)
        : null)

  return (
    <div
      className="flex min-h-0 flex-col gap-3.5"
      onKeyDown={(event) => {
        // Enter in a box saves, as the prototype's does. Not on a button: a
        // button's own Enter is its press.
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault()
          submit()
        }
      }}
    >
      <div className="flex flex-col gap-0.5">
        <Dialog.Title className="text-[1.125rem] leading-6 font-semibold text-ink">
          Adjust
        </Dialog.Title>
        <Dialog.Description className="text-[0.875rem] text-mute">
          {target.name} · {readMonth(period)}
        </Dialog.Description>
      </div>

      <div className="-mx-1 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-0.5 md:max-h-[16.25rem]">
        {drafts.map((draft, at) => {
          const options = optionsOf(draft, offered(draft.sign))
          return (
            <div key={draft.key} className="flex items-start gap-2">
              <button
                type="button"
                aria-label={
                  draft.sign > 0
                    ? "Addition, change to deduction"
                    : "Deduction, change to addition"
                }
                // Only where HO has somewhere for the other direction to go.
                disabled={!ready || offered(flip(draft.sign)).length === 0}
                onClick={() => change(at, { sign: flip(draft.sign), code: "" })}
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-[0.625rem] text-[1.25rem] leading-none font-bold transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-95 disabled:active:scale-100",
                  draft.sign > 0 ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg",
                )}
              >
                {draft.sign > 0 ? "+" : "−"}
              </button>
              <div className="grid min-w-0 flex-1 gap-2 @min-[30rem]:grid-cols-[minmax(0,1fr)_8.75rem]">
                <Input
                  ref={at === 0 ? firstName : undefined}
                  autoFocus={draft.key === focus}
                  aria-label="Name"
                  maxLength={120}
                  value={draft.name}
                  placeholder={
                    draft.sign > 0 ? "Insentif penjualan" : "Selisih kas"
                  }
                  onChange={(event) => change(at, { name: event.target.value })}
                  className="h-11"
                />
                <Money
                  label="Total"
                  prefix="Rp"
                  value={draft.amount}
                  onChange={(digits) => change(at, { amount: digits })}
                  className="h-11 text-right"
                />
                {options.length > 1 ? (
                  <div className="@min-[30rem]:col-span-2">
                    <Select
                      aria-label="Component"
                      value={codes[at] ?? ""}
                      onChange={(next) => {
                        const picked = options.find((one) => one.code === next)
                        change(at, { code: next, label: picked?.label ?? "" })
                      }}
                      className="h-9 text-[0.875rem]"
                    >
                      {options.map((one) => (
                        <option key={one.code} value={one.code}>
                          {one.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : options.length === 1 ? (
                  <span className="truncate text-[0.875rem] text-mute @min-[30rem]:col-span-2">
                    {options[0]?.label}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Remove"
                disabled={drafts.length === 1}
                onClick={() => {
                  setProblem(null)
                  setDrafts((was) => was.filter((_, index) => index !== at))
                }}
                className="mt-1 grid size-9 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="-mt-1 flex items-center gap-3">
        <Button
          variant="quiet"
          disabled={!canAdd}
          onClick={() => {
            const next = blank(mint(), free(1) ? 1 : -1)
            setProblem(null)
            setFocus(next.key)
            setDrafts((was) => [...was, next])
          }}
          className="-ml-2.5"
        >
          <Plus />
          Add a line
        </Button>
        {ready && !canAdd && plus.length + minus.length > 0 && (
          <span className="text-[0.875rem] text-mute">
            One line per component
          </span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-soft px-3.5 py-3 tabular-nums">
        <Figure term="Total now" align="start">
          {before === null ? "—" : money(before)}
        </Figure>
        <Figure term="Adjustment" align="center">
          <span
            className={
              delta > 0 ? "text-ok-fg" : delta < 0 ? "text-bad-fg" : undefined
            }
          >
            {signedMoney(delta)}
          </span>
        </Figure>
        <Figure term="After adjustment" align="end">
          {before === null ? "—" : money(before + delta)}
        </Figure>
      </dl>

      <p
        aria-live="polite"
        className="-my-1.5 min-h-5 text-[0.875rem] text-bad-fg"
      >
        {said}
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={pending}
          disabled={!ready}
          onClick={submit}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

/// One press of Save: whose lines, as which opening of the dialog.
interface Save {
  readonly seq: number
  readonly employeeId: string
  readonly lines: readonly LineDraft[]
}

/// A line as the dialog holds it. `amount` is digits, as `<Money>` gives them.
/// `code` is `""` until the line has one of its own; `label` is that
/// component's name, kept for one HO has since taken out of the list.
interface Draft {
  readonly key: string
  readonly id: string | null
  readonly sign: Sign
  readonly code: string
  readonly label: string
  readonly name: string
  readonly amount: string
}

function blank(key: string, sign: Sign): Draft {
  return { key, id: null, sign, code: "", label: "", name: "", amount: "" }
}

function flip(sign: Sign): Sign {
  return sign > 0 ? -1 : 1
}

/// The components a line may be under: HO's for its direction, and the one it
/// was filed under if HO has since dropped it — a line that was read is never
/// moved to another component behind the shop's back.
function optionsOf(
  draft: Draft,
  offered: readonly PayComponentView[],
): { code: string; label: string }[] {
  const options = offered.map((one) => ({ code: one.code, label: one.label }))
  if (draft.code !== "" && !options.some((one) => one.code === draft.code)) {
    options.unshift({ code: draft.code, label: draft.label })
  }
  return options
}

/// The component each line is under: its own when it has one that fits its
/// direction; else the first of its direction that no other line holds. Two
/// passes, so a new line above an old one does not take the old one's.
function resolve(
  drafts: readonly Draft[],
  offered: (sign: Sign) => readonly PayComponentView[],
): string[] {
  const owns = drafts.map((draft) =>
    optionsOf(draft, offered(draft.sign)).some((one) => one.code === draft.code)
      ? draft.code
      : null,
  )
  const taken = new Set(owns.filter((code): code is string => code !== null))
  return drafts.map((draft, at) => {
    const own = owns[at]
    if (own !== null && own !== undefined) return own
    const options = optionsOf(draft, offered(draft.sign))
    const code =
      options.find((one) => !taken.has(one.code))?.code ??
      options[0]?.code ??
      ""
    if (code !== "") taken.add(code)
    return code
  })
}

function labelOf(
  code: string,
  components: readonly PayComponentView[],
  drafts: readonly Draft[],
): string {
  return (
    components.find((one) => one.code === code)?.label ??
    drafts.find((one) => one.code === code)?.label ??
    code
  )
}

/// One of the three figures under the lines.
function Figure({
  term,
  align,
  children,
}: {
  term: string
  align: "start" | "center" | "end"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        align === "center"
          ? "items-center text-center"
          : align === "end"
            ? "items-end text-right"
            : "items-start",
      )}
    >
      <dt className="text-[0.875rem] text-mute">{term}</dt>
      <dd className="text-[1.125rem] leading-6 font-semibold whitespace-nowrap text-ink @max-[26rem]:text-[0.9375rem]">
        {children}
      </dd>
    </div>
  )
}
