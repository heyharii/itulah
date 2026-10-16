import { Check, Plus, X } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Field, Input, Money, Select } from "@/components/ui/field"
import { Banner } from "@/components/ui/states"
import { dateText } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { useRecordExpenses, useRecordTopUps } from "@/lib/queries/expenses"
import { useShopPeople } from "@/lib/queries/shop-people"
import { commandKey } from "@/lib/till"
import { minorFrom } from "@/screens/money/format"
import {
  BKK_FIRST_KIND,
  BKM_FIRST_KIND,
  KINDS,
  reasonOf,
  type VoucherKind,
} from "@/screens/money/petty-book"
import {
  BackLink,
  NotaPicker,
  TotalPanel,
  TotalRow,
  VoucherHeading,
  type Photo,
} from "@/screens/money/petty-parts"
import { useKeepNota } from "@/screens/money/petty-receipts"
import type { PettyCashPosition } from "@itulah/contract"
import { money, units } from "@itulah/contract/money"

/// A new BKM or BKK, on a page of its own — the hub's cash document
/// (`frontend-hub/src/screens/finance/cash-documents.tsx`): one box with the
/// fields on the left and the total on the right, then the lines under it.
///
/// **Save is always pressable.** Pressing it with something missing does not
/// refuse quietly: the fields that are missing turn red, the first of them takes
/// the focus, and nothing is sent. What the node would refuse anyway — more than
/// the tin holds, a code above the line — is caught here first so it reads as a
/// red field and not as a banner after the wait.
///
/// What the node takes, and so what this page can do today:
///   - a BKK is one expense per line, all to the one payee, in one of the nine
///     kinds of cost; a line above Finance's line needs Finance's code, and one
///     code covers one line;
///   - a BKM is a top-up from head office, counted with a second person who
///     signs with their password; the other kinds are listed and not pressable;
///   - the date is the instant it is saved, the photo stays on this device, and
///     there is no voucher number until the book numbers it.
///
/// A phone has no header buttons: Save is the dock's one round button, and Back
/// is the link over the heading.

interface LineDraft {
  readonly uid: string
  readonly kind: string
  readonly what: string
  /// Digits, as the `<Money>` field gives them.
  readonly amount: string
}

const blankLine = (kind: string): LineDraft => ({
  uid: crypto.randomUUID(),
  kind,
  what: "",
  amount: "",
})

/// Read, not typed — the voucher number and the date, drawn like a field.
const READ_ONLY =
  "flex h-11 items-center justify-between gap-2 rounded-inner border border-hairline bg-soft px-3.5 text-control text-body max-md:h-[2.9375rem]"

export function VoucherForm({
  kind,
  position,
  no,
  onBack,
  onSaved,
}: {
  kind: VoucherKind
  position: PettyCashPosition
  /// The number it will most likely carry.
  no: string
  onBack: () => void
  /// Told where the voucher's first record is, and what to say about it.
  onSaved: (id: string, said: string) => void
}) {
  const phone = useLayout() === "phone"
  const people = useShopPeople()
  const keepNota = useKeepNota()
  const expenses = useRecordExpenses()
  const topUps = useRecordTopUps()
  const out = kind === "BKK"

  const [party, setParty] = useState("")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [code, setCode] = useState("")
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [witness, setWitness] = useState("")
  const [password, setPassword] = useState("")
  const [lines, setLines] = useState<readonly LineDraft[]>(() => [
    blankLine(out ? BKK_FIRST_KIND : BKM_FIRST_KIND),
  ])
  const [tried, setTried] = useState(false)
  // One key per line, minted when the line is first sent and held for every
  // press after it: a retry after a refusal half way must find the lines that
  // were saved as they were, not save them again.
  const keys = useRef(new Map<string, string>())
  const keyOf = (uid: string) => {
    const held = keys.current.get(uid)
    if (held !== undefined) return held
    const minted = commandKey(out ? "expense" : "petty-topup")
    keys.current.set(uid, minted)
    return minted
  }

  const pending = expenses.isPending || topUps.isPending
  const error = out ? expenses.error : topUps.error

  const amounts = lines.map((line) => minorFrom(line.amount) ?? 0)
  const total = amounts.reduce((sum, minor) => sum + minor, 0)
  const balance = position.balance_minor
  const after = balance + (out ? -total : total)
  // The node asks for Finance's code per expense, so it is lines above the line
  // that count, not the voucher's total.
  const dear = out
    ? amounts.filter((minor) => minor > position.code_above_minor).length
    : 0
  const me = people.me?.login ?? ""

  /// What is missing or refused, by field. Looked at only once Save has been
  /// pressed.
  const problems: Record<string, string> = {}
  lines.forEach((line, index) => {
    if (line.what.trim() === "") problems[`what${index}`] = "Say what it was"
    if (amounts[index] <= 0) problems[`amount${index}`] = "Enter an amount"
  })
  if (out) {
    if (party.trim() === "") problems.party = "Enter who was paid."
    if (photo === null) problems.photo = "Take a photo of the nota"
    if (dear > 1) problems.code = "One code covers one line."
    else if (dear === 1 && !/^[0-9]{6}$/.test(code.trim()))
      problems.code = `Ask Finance for a code above ${money(position.code_above_minor)}`
    if (total > balance) problems.balance = `Petty cash has ${money(balance)}`
  } else {
    if (witness.trim() === "") problems.witness = "Say who counted it with you."
    else if (me !== "" && witness.trim().toLowerCase() === me.toLowerCase())
      problems.witness = "Someone else counts it with you."
    if (password === "") problems.password = "They sign with their password."
  }
  const bad = (key: string) => tried && problems[key] !== undefined
  const said = (key: string) => (tried ? problems[key] : undefined)
  const stuck = tried && Object.keys(problems).length > 0

  const change = (uid: string, patch: Partial<LineDraft>) =>
    setLines((was) =>
      was.map((line) => (line.uid === uid ? { ...line, ...patch } : line)),
    )

  const finish = (ids: readonly string[], extra: string) =>
    onSaved(ids[0], `Saved · ${money(total)}.${extra}`)

  const save = () => {
    setTried(true)
    if (Object.keys(problems).length > 0) {
      // The first red field takes the focus — not on a phone, where focus
      // raises the keyboard over the very page that is pointing at the problem.
      if (!phone)
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>("[data-voucher] [aria-invalid=true]")
            ?.focus(),
        )
      return
    }
    if (pending) return
    if (out) {
      expenses.mutate(
        {
          payee: party.trim(),
          lines: lines.map((line, index) => ({
            key: keyOf(line.uid),
            category: line.kind,
            amountMinor: amounts[index],
            reason: reasonOf(
              line.what,
              index === 0 ? { reference, note } : undefined,
            ),
            approvalCode:
              amounts[index] > position.code_above_minor ? code.trim() : null,
          })),
        },
        {
          onSuccess: async (saved) => {
            let extra = ""
            if (photo !== null) {
              try {
                await keepNota(saved.ids[0], photo.url)
              } catch {
                extra = " The photo could not be kept on this device."
              }
            }
            finish(saved.ids, extra)
          },
        },
      )
    } else {
      topUps.mutate(
        {
          reference,
          supervisor: { username: witness.trim(), password },
          lines: lines.map((line, index) => ({
            key: keyOf(line.uid),
            amountMinor: amounts[index],
            note: reasonOf(line.what, index === 0 ? { note } : undefined),
          })),
        },
        { onSuccess: (saved) => finish(saved.ids, "") },
      )
    }
  }

  const saveLabel = pending ? "Saving…" : `Save ${kind}`

  return (
    <div data-voucher>
      <BackLink onClick={onBack}>Petty cash</BackLink>
      <VoucherHeading kind={kind} title={`New ${kind}`} no={no}>
        <Button onClick={onBack} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} pending={pending}>
          {saveLabel}
        </Button>
      </VoucherHeading>
      <Fab label={saveLabel} icon={Check} onClick={save} disabled={pending} />

      {error !== null && (
        <Banner tone="bad" className="mb-4">
          {error.message}
        </Banner>
      )}

      <Card className="grid lg:grid-cols-[minmax(0,1fr)_18.75rem]">
        <div className="grid content-start gap-4 p-5 sm:grid-cols-2">
          <Field label="Voucher no">
            <div className={READ_ONLY}>
              <span className="font-mono text-id">{no}</span>
              <em className="text-[0.875rem] text-mute not-italic">auto</em>
            </div>
          </Field>
          <Field label="Date">
            <div className={READ_ONLY}>
              <span>
                {dateText(new Date(), {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <em className="text-[0.875rem] text-mute not-italic">today</em>
            </div>
          </Field>
          <Field
            label={out ? "Paid to" : "Received from"}
            problem={said("party")}
          >
            {out ? (
              <Input
                value={party}
                placeholder="Shop or person"
                onChange={(event) => setParty(event.target.value)}
              />
            ) : (
              <div className={READ_ONLY}>
                <span>Head office</span>
              </div>
            )}
          </Field>
          <Field label="Reference">
            <Input
              className="font-mono"
              value={reference}
              placeholder="Nota or HO voucher no."
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field label="Note" className="sm:col-span-2">
            <Input
              value={note}
              placeholder={`Printed on the ${kind}`}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {out ? (
            <>
              <div className="sm:col-span-2">
                <NotaPicker
                  photo={photo}
                  problem={said("photo")}
                  onPhoto={setPhoto}
                />
              </div>
              {dear > 0 && (
                <Field
                  label="Finance code"
                  className="sm:col-span-2"
                  problem={said("code")}
                >
                  <Input
                    className="font-mono"
                    inputMode="numeric"
                    // A code, not a quantity: typed, with its leading zeros.
                    keyboard
                    autoComplete="off"
                    maxLength={6}
                    value={code}
                    placeholder={`From Finance, above ${money(position.code_above_minor)}`}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/[^0-9]/g, ""))
                    }
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Counted with" problem={said("witness")}>
                <Input
                  autoComplete="off"
                  value={witness}
                  onChange={(event) => setWitness(event.target.value)}
                />
              </Field>
              <Field label="Their password" problem={said("password")}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        <TotalPanel
          label={out ? "Total paid" : "Total received"}
          totalMinor={total}
        >
          <TotalRow label="Other lines">{units(total)}</TotalRow>
          <TotalRow label="Petty cash now">{units(balance)}</TotalRow>
          <TotalRow label="After" bad={out && after < 0}>
            {units(after)}
          </TotalRow>
          {bad("balance") && (
            <span className="mt-1.5 block text-[0.875rem] text-bad">
              {problems.balance}
            </span>
          )}
        </TotalPanel>
      </Card>

      <div className="mt-6 mb-2 flex">
        <span className="border-b-2 border-ink pb-1.5 text-control font-medium text-ink">
          Other lines
          <em className="ml-1.5 font-normal text-mute not-italic tabular-nums">
            {
              lines.filter(
                (line, index) => line.what.trim() !== "" || amounts[index] > 0,
              ).length
            }
          </em>
        </span>
      </div>
      <Card>
        <div className="hidden h-10 grid-cols-[minmax(0,15rem)_minmax(0,1fr)_11rem_2.75rem] items-center gap-2.5 border-b border-hairline bg-soft pr-3 pl-4 text-eyebrow font-medium text-body md:grid">
          <span>Account</span>
          <span>Note</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {lines.map((line, index) => (
          <div
            key={line.uid}
            className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2.5 border-b border-hairline p-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_11rem_2.75rem] md:py-2 md:pr-3 md:pl-4"
          >
            <div className="max-md:col-start-1 max-md:row-start-1">
              <Select
                aria-label="Account"
                value={line.kind}
                onChange={(next) => change(line.uid, { kind: next })}
              >
                {KINDS[kind].map((one) => (
                  <option key={one.code} value={one.code} disabled={!one.saves}>
                    {one.saves ? one.word : `${one.word} · Soon`}
                  </option>
                ))}
              </Select>
            </div>
            <div className="max-md:col-span-2">
              <Input
                aria-label="Note"
                value={line.what}
                invalid={bad(`what${index}`)}
                placeholder={out ? "Galon 4 pcs" : "Petty cash for the month"}
                onChange={(event) =>
                  change(line.uid, { what: event.target.value })
                }
              />
            </div>
            <div className="max-md:col-span-2">
              <Money
                label="Amount"
                prefix="Rp"
                className="text-right tabular-nums"
                value={line.amount}
                invalid={bad(`amount${index}`)}
                onChange={(next) => change(line.uid, { amount: next })}
              />
            </div>
            <Button
              size="icon"
              variant="quiet"
              aria-label="Remove line"
              disabled={lines.length === 1}
              className="max-md:col-start-2 max-md:row-start-1"
              onClick={() =>
                setLines((was) => was.filter((one) => one.uid !== line.uid))
              }
            >
              <X />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-soft/50 py-1.5 pr-4 pl-2">
          <Button
            size="sm"
            variant="quiet"
            onClick={() =>
              setLines((was) => [
                ...was,
                blankLine(out ? BKK_FIRST_KIND : BKM_FIRST_KIND),
              ])
            }
          >
            <Plus />
            Add a line
          </Button>
          <b className="font-semibold text-ink tabular-nums">{money(total)}</b>
        </div>
      </Card>

      {stuck && (
        <p className="mt-3 text-right text-meta text-bad-fg">
          Fix the red fields
        </p>
      )}
    </div>
  )
}
