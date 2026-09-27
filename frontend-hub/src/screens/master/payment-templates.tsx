import type {
  PaymentTermBasis,
  PaymentTermRow,
  PaymentTermsBook,
  PaymentTermsTemplateRow,
} from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count } from "@/lib/format"
import {
  createPaymentTerm,
  createPaymentTermsTemplate,
  paymentTermsBook,
  paymentTermsKeys,
  updatePaymentTerm,
  updatePaymentTermsTemplate,
} from "@/lib/queries/payment-terms"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"

/// Payment templates — the arrangements a bill is scheduled with.
///
/// Moved here on the owner's decision: terms are no longer chosen on the
/// supplier form or in the order composer (Finance handles payment), so the
/// arrangements are kept as master data, on this screen and nowhere else.
///
/// Two lists, because a template is unreadable without its terms. A TERM is a
/// named offset from the bill ("Net 30" — thirty days after the bill); a
/// TEMPLATE is a set of terms with portions ("40% advance, 60% before
/// dispatch") whose portions add up to the whole bill. The server holds that
/// sum with a deferred trigger (0201); this screen refuses to Save until it
/// holds, so nobody has to submit to find out.
///
/// Retire, never delete — the master lifecycle of `docs/product-master.md`.
/// A supplier's standing arrangement points at a template by its code, and a
/// code that vanished would be an arrangement nobody can read back.
///
/// Every piece of text on this screen is 14px or larger, by the owner's rule
/// for it. That is why the shared `Field` (12px labels) and `PageHeader`'s
/// `sub` are not used here, and why pills, banners and buttons are sized up.

const T14 = "text-[0.875rem]"

// ---------------------------------------------------------------------------
// Reading a term the way a person says it

const BASIS_OPTIONS: readonly { value: PaymentTermBasis; label: string }[] = [
  { value: "DAYS_AFTER_BILL", label: "Days after the bill" },
  {
    value: "DAYS_AFTER_BILL_MONTH_END",
    label: "Days after the bill's month end",
  },
  {
    value: "MONTHS_AFTER_BILL_MONTH_END",
    label: "Months after the bill's month end",
  },
]

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/// "30 days after the bill", "On the bill date", "At the bill's month end".
function describeDue(basis: PaymentTermBasis, offset: number): string {
  switch (basis) {
    case "DAYS_AFTER_BILL":
      return offset === 0
        ? "On the bill date"
        : `${plural(offset, "day", "days")} after the bill`
    case "DAYS_AFTER_BILL_MONTH_END":
      return offset === 0
        ? "At the bill's month end"
        : `${plural(offset, "day", "days")} after the bill's month end`
    case "MONTHS_AFTER_BILL_MONTH_END":
      return offset === 0
        ? "At the bill's month end"
        : `${plural(offset, "month", "months")} after the bill's month end`
  }
}

/// 4000 → "40%", 3333 → "33.33%".
function percent(bps: number): string {
  const value = bps / 100
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0$/, "")}%`
}

/// "40", "33.33" → basis points, or null when it is not a portion.
function toBps(raw: string): number | null {
  const text = raw.trim().replace(",", ".")
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null
  const bps = Math.round(Number(text) * 100)
  return bps > 0 && bps <= 10000 ? bps : null
}

/// `Net 60` → `NET_60`, the rule every master code here follows.
function snake(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

const CODE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/

function byOrder<T extends { display_order: number; label: string }>(
  rows: readonly T[]
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.display_order - b.display_order ||
      a.label.localeCompare(b.label, "id-ID", { sensitivity: "base" })
  )
}

/// The server's own sentence about why a write was refused — the 409 from the
/// "a template is the whole bill" trigger reads as a sentence, and "Could not
/// save" would throw it away.
function said(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The server could not be reached."
}

/// A key held across retries and rotated after a success, so a double-clicked
/// Save replays the first answer instead of writing twice. The same hook
/// `colours.tsx` carries, for the reason it gives.
function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID())
  const rotate = useCallback(() => setKey(crypto.randomUUID()), [])
  return { key, rotate }
}

/// A labelled control at 14px. The shared `Field` sets its label at 12px.
function Labelled({
  label,
  problem,
  aside,
  children,
  className,
}: {
  label: React.ReactNode
  problem?: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className={cn(T14, "font-medium text-text")}>{label}</span>
        {aside && <span className={cn(T14, "text-mute")}>{aside}</span>}
      </span>
      {children}
      {problem && <span className={cn(T14, "text-bad")}>{problem}</span>}
    </label>
  )
}

function Status({ active }: { active: boolean }) {
  return active ? (
    <Pill tone="ok" className={cn(T14, "h-7")}>
      Active
    </Pill>
  ) : (
    <Pill tone="neutral" className={cn(T14, "h-7")}>
      Cancelled
    </Pill>
  )
}

/// The bill as one bar, cut into its instalments. Read before the words: a
/// 40/60 split and a 50/50 split look different at a glance.
function PortionBar({
  portions,
  className,
}: {
  portions: readonly number[]
  className?: string
}) {
  const total = portions.reduce((sum, one) => sum + one, 0)
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-soft-2",
        className
      )}
    >
      {portions.map((bps, index) => (
        <span
          key={index}
          className={cn(
            "h-full rounded-full transition-[width] duration-200 ease-out",
            index % 2 === 0 ? "bg-accent" : "bg-accent/45"
          )}
          style={{
            width: `${(Math.min(bps, 10000) / Math.max(total, 10000)) * 100}%`,
          }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

type Editing =
  | { kind: "template"; code: string | null }
  | { kind: "term"; code: string | null }
  | null

export function PaymentTemplates() {
  const [editing, setEditing] = useState<Editing>(null)
  const [showRetired, setShowRetired] = useState(false)

  const book = useQuery({
    queryKey: paymentTermsKeys.book(),
    queryFn: ({ signal }) => paymentTermsBook(signal),
  })

  const close = useCallback(() => setEditing(null), [])

  return (
    <PageContent>
      <PageHeader
        title="Payment templates"
        actions={
          <>
            <Button
              className={T14}
              onClick={() => setEditing({ kind: "term", code: null })}
            >
              New term
            </Button>
            <Button
              variant="primary"
              className={T14}
              onClick={() => setEditing({ kind: "template", code: null })}
            >
              New template
            </Button>
          </>
        }
      />
      <p className={cn(T14, "-mt-2 mb-5 max-w-[46rem] text-body")}>
        The arrangements a supplier bill is scheduled with. A template splits
        the bill into instalments that add up to 100%; each instalment falls due
        on a term. Nothing here is deleted — cancel what is no longer offered
        and it stays readable on everything that already carries it.
      </p>

      {queryState(book, {
        loading: "Reading the payment terms…",
        render: (data) => (
          <BookView
            book={data}
            showRetired={showRetired}
            onShowRetired={setShowRetired}
            onOpen={setEditing}
          />
        ),
      })}

      {book.data && (
        <>
          <TemplateSheet
            open={editing?.kind === "template"}
            template={
              editing?.kind === "template" && editing.code !== null
                ? (book.data.templates.find((t) => t.code === editing.code) ??
                  null)
                : null
            }
            book={book.data}
            onClose={close}
          />
          <TermSheet
            open={editing?.kind === "term"}
            term={
              editing?.kind === "term" && editing.code !== null
                ? (book.data.terms.find((t) => t.code === editing.code) ?? null)
                : null
            }
            book={book.data}
            onClose={close}
          />
        </>
      )}
    </PageContent>
  )
}

function BookView({
  book,
  showRetired,
  onShowRetired,
  onOpen,
}: {
  book: PaymentTermsBook
  showRetired: boolean
  onShowRetired: (next: boolean) => void
  onOpen: (next: Editing) => void
}) {
  const templates = useMemo(() => byOrder(book.templates), [book.templates])
  const terms = useMemo(() => byOrder(book.terms), [book.terms])
  const retiredCount =
    templates.filter((t) => !t.active).length +
    terms.filter((t) => !t.active).length
  const shownTemplates = showRetired
    ? templates
    : templates.filter((t) => t.active)
  const shownTerms = showRetired ? terms : terms.filter((t) => t.active)

  // Which templates schedule each term — the one fact a term's row needs from
  // the other list, and the reason a term in use cannot be retired.
  const heldBy = useMemo(() => {
    const map = new Map<string, PaymentTermsTemplateRow[]>()
    for (const template of book.templates) {
      for (const line of template.lines) {
        const list = map.get(line.term_code) ?? []
        if (!list.includes(template)) list.push(template)
        map.set(line.term_code, list)
      }
    }
    return map
  }, [book.templates])

  return (
    <div className="flex flex-col gap-7">
      <div className={cn(T14, "flex flex-wrap items-center gap-3 text-body")}>
        <span>
          <b className="font-medium text-ink">
            {count(templates.filter((t) => t.active).length)}
          </b>{" "}
          active templates ·{" "}
          <b className="font-medium text-ink">
            {count(terms.filter((t) => t.active).length)}
          </b>{" "}
          active terms
        </span>
        {retiredCount > 0 && (
          <Button
            variant="quiet"
            className={T14}
            onClick={() => onShowRetired(!showRetired)}
          >
            {showRetired
              ? "Hide cancelled"
              : `Show ${plural(retiredCount, "cancelled", "cancelled")}`}
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[1rem] font-semibold text-ink">Templates</h2>
        {shownTemplates.length === 0 ? (
          <Card>
            <EmptyState
              action={
                <Button
                  variant="primary"
                  className={T14}
                  onClick={() => onOpen({ kind: "template", code: null })}
                >
                  New template
                </Button>
              }
            >
              <span className={T14}>
                No payment template yet, so a bill has nothing to be scheduled
                with.
              </span>
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {shownTemplates.map((template) => (
              <button
                key={template.code}
                type="button"
                onClick={() =>
                  onOpen({ kind: "template", code: template.code })
                }
                className={cn(
                  "flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-4 text-left shadow-soft transition-[border-color,transform] duration-150 ease-out hover:border-hairline-strong active:scale-[0.99]",
                  !template.active && "opacity-70"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[1rem] font-semibold text-ink">
                      {template.label}
                    </div>
                    <div className={cn(T14, "font-mono text-mute")}>
                      {template.code}
                    </div>
                  </div>
                  <Status active={template.active} />
                </div>
                <PortionBar
                  portions={template.lines.map((line) => line.portion_bps)}
                />
                <ol className="flex flex-col gap-1.5">
                  {template.lines.map((line) => (
                    <li
                      key={line.seq}
                      className={cn(T14, "flex items-baseline gap-3")}
                    >
                      <span className="w-16 shrink-0 font-semibold text-ink tabular-nums">
                        {percent(line.portion_bps)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-ink">{line.term_label}</span>
                        <span className="text-body">
                          {" · "}
                          {describeDue(line.basis, line.offset_value)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[1rem] font-semibold text-ink">Terms</h2>
        <Card className="overflow-hidden">
          {shownTerms.length === 0 ? (
            <EmptyState>
              <span className={T14}>No payment term yet.</span>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-hairline">
              {shownTerms.map((term) => {
                const holders = heldBy.get(term.code) ?? []
                return (
                  <li key={term.code}>
                    <button
                      type="button"
                      onClick={() => onOpen({ kind: "term", code: term.code })}
                      className={cn(
                        T14,
                        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-soft-2 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,12rem)_auto]",
                        !term.active && "opacity-70"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">
                          {term.label}
                        </span>
                        <span className="block truncate font-mono text-mute">
                          {term.code}
                        </span>
                      </span>
                      <span className="col-start-1 text-text md:col-start-auto">
                        {describeDue(term.basis, term.offset_value)}
                      </span>
                      <span className="col-start-1 truncate text-body md:col-start-auto">
                        {holders.length === 0
                          ? "In no template"
                          : `In ${plural(holders.length, "template", "templates")}`}
                      </span>
                      <span className="col-start-2 row-span-3 row-start-1 md:col-start-auto md:row-span-1 md:row-start-auto">
                        <Status active={term.active} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The template sheet

interface LineDraft {
  /// Stable React key: lines are reordered and removed, so the index is not.
  id: string
  term: string
  portion: string
}

function TemplateSheet({
  open,
  template,
  book,
  onClose,
}: {
  open: boolean
  template: PaymentTermsTemplateRow | null
  book: PaymentTermsBook
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={template?.label ?? "New template"}
      badge={template ? <Status active={template.active} /> : undefined}
    >
      {open && (
        // Keyed so moving between templates starts a draft on the one in
        // front of you rather than editing it through the last one's values.
        <TemplateForm
          key={template?.code ?? "new"}
          template={template}
          book={book}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}

function TemplateForm({
  template,
  book,
  onDone,
}: {
  template: PaymentTermsTemplateRow | null
  book: PaymentTermsBook
  onDone: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [label, setLabel] = useState(template?.label ?? "")
  const [code, setCode] = useState(template?.code ?? "")
  const [codeTyped, setCodeTyped] = useState(false)
  const [order, setOrder] = useState(String(template?.display_order ?? ""))
  const [lines, setLines] = useState<LineDraft[]>(() =>
    template && template.lines.length > 0
      ? template.lines.map((line) => ({
          id: crypto.randomUUID(),
          term: line.term_code,
          portion: String(line.portion_bps / 100),
        }))
      : [{ id: crypto.randomUUID(), term: "", portion: "100" }]
  )

  const liveTerms = useMemo(
    () => byOrder(book.terms.filter((term) => term.active)),
    [book.terms]
  )
  const termByCode = useMemo(
    () => new Map(book.terms.map((term) => [term.code, term])),
    [book.terms]
  )

  const portions = lines.map((line) => toBps(line.portion))
  const total = portions.reduce<number>((sum, one) => sum + (one ?? 0), 0)
  const remaining = 10000 - total

  // Everything that keeps Save switched off, each in a sentence.
  const problems = (() => {
    const found: {
      label?: string
      code?: string
      order?: string
      lines: Record<string, string>
      total?: string
    } = { lines: {} }
    if (label.trim() === "") found.label = "A template needs a name."
    if (template === null) {
      const c = code.trim()
      if (c === "") found.code = "A code is needed; suppliers point at it."
      else if (!CODE.test(c))
        found.code = "Upper snake — ADV40_NET30, not “adv 40”."
      else if (book.templates.some((t) => t.code === c))
        found.code = `${c} is already taken.`
    }
    if (order.trim() !== "" && !/^\d+$/.test(order.trim()))
      found.order = "A whole number, 0 or more."
    const seen = new Set<string>()
    lines.forEach((line, index) => {
      if (line.term === "") {
        found.lines[line.id] = "Choose a term."
      } else if (seen.has(line.term)) {
        found.lines[line.id] =
          "This term is already an instalment — add the portions together."
      } else if (termByCode.get(line.term)?.active === false) {
        found.lines[line.id] = "This term is cancelled; choose another."
      } else if (portions[index] === null) {
        found.lines[line.id] = "More than 0% and at most 100%."
      }
      seen.add(line.term)
    })
    if (total !== 10000)
      found.total =
        remaining > 0
          ? `${percent(remaining)} of the bill is not scheduled yet.`
          : `${percent(-remaining)} more than the whole bill.`
    return found
  })()
  const blocked =
    problems.label !== undefined ||
    problems.code !== undefined ||
    problems.order !== undefined ||
    problems.total !== undefined ||
    Object.keys(problems.lines).length > 0

  const payloadLines = lines.map((line, index) => ({
    term_code: line.term,
    portion_bps: portions[index] ?? 0,
  }))
  const linesChanged =
    template === null ||
    template.lines.length !== payloadLines.length ||
    template.lines.some(
      (line, index) =>
        line.term_code !== payloadLines[index]?.term_code ||
        line.portion_bps !== payloadLines[index]?.portion_bps
    )

  const save = useMutation({
    mutationFn: () => {
      const displayOrder = order.trim() === "" ? null : Number(order.trim())
      return template === null
        ? createPaymentTermsTemplate(
            {
              code: code.trim(),
              label: label.trim(),
              display_order: displayOrder,
              lines: payloadLines,
            },
            idempotency.key
          )
        : updatePaymentTermsTemplate(
            template.code,
            {
              label: label.trim(),
              display_order: displayOrder ?? template.display_order,
              // Only when they changed: the server replaces them whole, and an
              // unchanged set would be a rewrite that says nothing.
              ...(linesChanged ? { lines: payloadLines } : {}),
            },
            template.version,
            idempotency.key
          )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: paymentTermsKeys.book() })
      idempotency.rotate()
      onDone()
    },
  })

  const lifecycle = useMutation({
    mutationFn: (active: boolean) =>
      updatePaymentTermsTemplate(
        template?.code ?? "",
        { active },
        template?.version ?? 0,
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: paymentTermsKeys.book() })
      idempotency.rotate()
    },
  })

  const setLine = (id: string, patch: Partial<LineDraft>) =>
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line))
    )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!blocked) save.mutate()
      }}
      className="flex flex-col gap-4"
    >
      {save.isError && (
        <Banner tone="bad" className={T14}>
          {said(save.error)}
        </Banner>
      )}

      <Labelled label="Name" problem={problems.label}>
        <Input
          value={label}
          onChange={(event) => {
            setLabel(event.target.value)
            if (template === null && !codeTyped)
              setCode(snake(event.target.value))
          }}
          placeholder="40% advance, 60% at 30 days"
        />
      </Labelled>

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Labelled
          label="Code"
          problem={problems.code}
          aside={template ? "Fixed" : undefined}
        >
          <Input
            value={code}
            disabled={template !== null}
            onChange={(event) => {
              setCodeTyped(true)
              setCode(event.target.value)
            }}
            className="font-mono"
            placeholder="ADV40_NET30"
          />
        </Labelled>
        <Labelled label="Order" problem={problems.order}>
          <Input
            type="number"
            min={0}
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            placeholder="Last"
          />
        </Labelled>
      </div>

      <div className="flex flex-col gap-3 border-t border-hairline pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-card-title font-semibold text-ink">
            Instalments
          </h3>
          <span
            className={cn(
              T14,
              "font-medium tabular-nums transition-colors",
              total === 10000 ? "text-ok-fg" : "text-warn-fg"
            )}
          >
            {percent(total)} of 100%
          </span>
        </div>

        <PortionBar portions={portions.map((one) => one ?? 0)} />

        {liveTerms.length === 0 && (
          <Banner tone="warn" className={T14}>
            There is no active term to schedule with. Add a term first.
          </Banner>
        )}

        <ol className="flex flex-col gap-3">
          {lines.map((line, index) => {
            const term = termByCode.get(line.term)
            return (
              <li
                key={line.id}
                className="flex flex-col gap-1.5 rounded-inner bg-soft-2 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn(T14, "font-medium text-text")}>
                    Instalment {index + 1}
                  </span>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon"
                      aria-label={`Remove instalment ${index + 1}`}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((one) => one.id !== line.id)
                        )
                      }
                    >
                      <X />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                  <Select
                    aria-label={`Term for instalment ${index + 1}`}
                    value={line.term}
                    onChange={(next) => setLine(line.id, { term: next })}
                  >
                    <option value="">Choose a term</option>
                    {/* A retired term already on the template is shown so
                        the draft reads true; it cannot be saved. */}
                    {term && !term.active && (
                      <option value={term.code} disabled>
                        {term.label} (retired)
                      </option>
                    )}
                    {liveTerms.map((one) => (
                      <option key={one.code} value={one.code}>
                        {one.label}
                      </option>
                    ))}
                  </Select>
                  <div className="relative">
                    <Input
                      inputMode="decimal"
                      aria-label={`Portion of instalment ${index + 1}, percent`}
                      value={line.portion}
                      onChange={(event) =>
                        setLine(line.id, { portion: event.target.value })
                      }
                      className="pr-7 text-right tabular-nums"
                    />
                    <span
                      className={cn(
                        T14,
                        "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-mute"
                      )}
                    >
                      %
                    </span>
                  </div>
                </div>
                {term && (
                  <span className={cn(T14, "text-body")}>
                    {describeDue(term.basis, term.offset_value)}
                  </span>
                )}
                {problems.lines[line.id] && (
                  <span className={cn(T14, "text-bad")}>
                    {problems.lines[line.id]}
                  </span>
                )}
              </li>
            )
          })}
        </ol>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="soft"
            className={T14}
            disabled={liveTerms.length === 0}
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  term: "",
                  // The new line takes what is left, which is nearly always
                  // what somebody adding the last instalment means.
                  portion: remaining > 0 ? String(remaining / 100) : "",
                },
              ])
            }
          >
            <Plus /> Add instalment
          </Button>
          {problems.total && (
            <span className={cn(T14, "text-warn-fg")}>{problems.total}</span>
          )}
        </div>
      </div>

      <Button
        type="submit"
        variant="primary"
        className={T14}
        disabled={blocked || save.isPending}
      >
        {save.isPending
          ? "Saving…"
          : template === null
            ? "Add template"
            : "Save"}
      </Button>

      {template && (
        <div className="mt-2 flex flex-col gap-3 border-t border-hairline pt-4">
          <h3 className="text-card-title font-semibold text-ink">
            {template.active ? "Cancel" : "Reactivate"}
          </h3>
          <p className={cn(T14, "text-body")}>
            {template.active
              ? "A cancelled template is no longer offered for new arrangements. Suppliers and bills that already carry it keep it, and it can be reactivated at any time."
              : "Reactivating offers this template again. Every term it schedules has to be active."}
          </p>
          {lifecycle.isError && (
            <Banner tone="bad" className={T14}>
              {said(lifecycle.error)}
            </Banner>
          )}
          <Button
            type="button"
            className={cn(T14, "self-start")}
            disabled={lifecycle.isPending}
            onClick={() => lifecycle.mutate(!template.active)}
          >
            {lifecycle.isPending
              ? "Saving…"
              : template.active
                ? "Cancel template"
                : "Reactivate template"}
          </Button>
        </div>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// The term sheet

function TermSheet({
  open,
  term,
  book,
  onClose,
}: {
  open: boolean
  term: PaymentTermRow | null
  book: PaymentTermsBook
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={term?.label ?? "New term"}
      badge={term ? <Status active={term.active} /> : undefined}
    >
      {open && (
        <TermForm
          key={term?.code ?? "new"}
          term={term}
          book={book}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}

function TermForm({
  term,
  book,
  onDone,
}: {
  term: PaymentTermRow | null
  book: PaymentTermsBook
  onDone: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [label, setLabel] = useState(term?.label ?? "")
  const [code, setCode] = useState(term?.code ?? "")
  const [codeTyped, setCodeTyped] = useState(false)
  const [basis, setBasis] = useState<PaymentTermBasis>(
    term?.basis ?? "DAYS_AFTER_BILL"
  )
  const [offset, setOffset] = useState(String(term?.offset_value ?? 30))
  const [order, setOrder] = useState(String(term?.display_order ?? ""))

  const offsetValue = /^\d+$/.test(offset.trim()) ? Number(offset.trim()) : null
  const unit = basis === "MONTHS_AFTER_BILL_MONTH_END" ? "Months" : "Days"

  // The active templates that schedule this term. Retiring it while they do
  // is refused — they would name something no picker offers.
  const holders = term
    ? book.templates.filter(
        (template) =>
          template.active &&
          template.lines.some((line) => line.term_code === term.code)
      )
    : []

  const problems: {
    label?: string
    code?: string
    offset?: string
    order?: string
  } = {}
  if (label.trim() === "") problems.label = "A term needs a name."
  if (term === null) {
    const c = code.trim()
    if (c === "") problems.code = "A code is needed; templates point at it."
    else if (!CODE.test(c))
      problems.code = "Upper snake — NET_60, not “net 60”."
    else if (book.terms.some((t) => t.code === c))
      problems.code = `${c} is already taken.`
  }
  if (offsetValue === null) problems.offset = "A whole number, 0 or more."
  if (order.trim() !== "" && !/^\d+$/.test(order.trim()))
    problems.order = "A whole number, 0 or more."
  const blocked = Object.values(problems).some((one) => one !== undefined)

  const save = useMutation({
    mutationFn: () => {
      const displayOrder = order.trim() === "" ? null : Number(order.trim())
      return term === null
        ? createPaymentTerm(
            {
              code: code.trim(),
              label: label.trim(),
              basis,
              offset_value: offsetValue ?? 0,
              display_order: displayOrder,
            },
            idempotency.key
          )
        : updatePaymentTerm(
            term.code,
            {
              label: label.trim(),
              basis,
              offset_value: offsetValue ?? term.offset_value,
              display_order: displayOrder ?? term.display_order,
            },
            term.version,
            idempotency.key
          )
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: paymentTermsKeys.book() })
      idempotency.rotate()
      onDone()
    },
  })

  const lifecycle = useMutation({
    mutationFn: (active: boolean) =>
      updatePaymentTerm(
        term?.code ?? "",
        { active },
        term?.version ?? 0,
        idempotency.key
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: paymentTermsKeys.book() })
      idempotency.rotate()
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!blocked) save.mutate()
      }}
      className="flex flex-col gap-4"
    >
      {save.isError && (
        <Banner tone="bad" className={T14}>
          {said(save.error)}
        </Banner>
      )}

      <Labelled label="Name" problem={problems.label}>
        <Input
          value={label}
          onChange={(event) => {
            setLabel(event.target.value)
            if (term === null && !codeTyped) setCode(snake(event.target.value))
          }}
          placeholder="Net 60"
        />
      </Labelled>

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Labelled
          label="Code"
          problem={problems.code}
          aside={term ? "Fixed" : undefined}
        >
          <Input
            value={code}
            disabled={term !== null}
            onChange={(event) => {
              setCodeTyped(true)
              setCode(event.target.value)
            }}
            className="font-mono"
            placeholder="NET_60"
          />
        </Labelled>
        <Labelled label="Order" problem={problems.order}>
          <Input
            type="number"
            min={0}
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            placeholder="Last"
          />
        </Labelled>
      </div>

      <Labelled label="Counted from">
        <Select
          aria-label="Counted from"
          value={basis}
          onChange={(next) => setBasis(next as PaymentTermBasis)}
        >
          {BASIS_OPTIONS.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </Select>
      </Labelled>

      <Labelled label={unit} problem={problems.offset}>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={offset}
          onChange={(event) => setOffset(event.target.value)}
          className="tabular-nums"
        />
      </Labelled>

      <div
        className={cn(T14, "rounded-inner bg-soft-2 px-3.5 py-2.5 text-text")}
      >
        Falls due:{" "}
        <b className="font-medium text-ink">
          {offsetValue === null
            ? "—"
            : describeDue(basis, offsetValue).toLowerCase()}
        </b>
        {term && holders.length > 0 && (
          <span className="mt-1 block text-body">
            Changing it moves every bill raised from now on under{" "}
            {holders.map((one) => one.label).join(", ")}. Bills already raised
            keep their dates.
          </span>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        className={T14}
        disabled={blocked || save.isPending}
      >
        {save.isPending ? "Saving…" : term === null ? "Add term" : "Save"}
      </Button>

      {term && (
        <div className="mt-2 flex flex-col gap-3 border-t border-hairline pt-4">
          <h3 className="text-card-title font-semibold text-ink">
            {term.active ? "Cancel" : "Reactivate"}
          </h3>
          <p className={cn(T14, "text-body")}>
            {!term.active
              ? "Reactivating offers this term again when a template is written."
              : holders.length > 0
                ? `Scheduled by ${holders.map((one) => one.label).join(", ")}. Cancel those templates, or change their instalments, before cancelling this term.`
                : "A cancelled term can no longer be put on a template. Nothing is deleted, and it can be reactivated at any time."}
          </p>
          {lifecycle.isError && (
            <Banner tone="bad" className={T14}>
              {said(lifecycle.error)}
            </Banner>
          )}
          <Button
            type="button"
            className={cn(T14, "self-start")}
            disabled={
              lifecycle.isPending || (term.active && holders.length > 0)
            }
            onClick={() => lifecycle.mutate(!term.active)}
          >
            {lifecycle.isPending
              ? "Saving…"
              : term.active
                ? "Cancel term"
                : "Reactivate term"}
          </Button>
        </div>
      )}
    </form>
  )
}
