import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/cn"

/// The marks this module draws more than once.
///
/// Components only — the vocabularies live next door in `labels.ts`, which has
/// no JSX in it and can therefore be read from a column definition without
/// dragging a component graph along. Splitting them is also what keeps Fast
/// Refresh working on this file: a module that exports a mix of components and
/// plain functions is one React cannot hot-swap.

/// Something that is absent, drawn as absent.
///
/// Its own component because "nothing here" is written thirty times across this
/// module and each spelling is a decision: an em dash for a field that does not
/// apply, a word for a field that is genuinely empty. Grey, always, so a column
/// of them recedes and the rows that DO carry a value are what the eye lands on.
export function Quiet({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="text-ink-4">{children}</span>
}

/// Who a row is about, in the identity column.
///
/// ## Why this takes three fields and not one
///
/// Because the queues do not carry a person, they carry a foreign key.
/// `LeaveRequestView` and `OvertimeOrderView` both identify somebody by
/// `employee_id` alone — no number, no name — so a screen either draws a UUID
/// or resolves it from the workforce list. This draws whichever of the three it
/// was given, in order of how useful it is to read, and it **never invents the
/// missing one**:
///
///   name + number → the name, with the number under it. What a manager wants.
///   number only   → the number, and "Not enrolled yet" under it. A record can
///                   exist before anybody has typed a name into it, and saying
///                   so beats an empty cell, which reads as a loading fault.
///   id only       → the id, and a plain statement that the name was not in
///                   the part of the workforce this caller can read. Not a
///                   blank, and not a guess.
export function Person({
  id,
  code,
  name,
}: {
  /// The key the row actually carries.
  id: string
  code?: string | null
  name?: string | null
}) {
  if (name) {
    return (
      <>
        <span className="text-ink block truncate font-medium" title={name}>
          {name}
        </span>
        {code && (
          <span className="text-label text-ink-4 block truncate font-mono">
            {code}
          </span>
        )}
      </>
    )
  }
  if (code) {
    return (
      <>
        <span className="text-cell text-ink block truncate font-mono">
          {code}
        </span>
        <Block>Not enrolled yet</Block>
      </>
    )
  }
  return (
    <>
      <span
        className="text-label text-ink-2 block truncate font-mono"
        title={id}
      >
        {id}
      </span>
      <Block>Name not in the list you can read</Block>
    </>
  )
}

function Block({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-label text-ink-4 block truncate">{children}</span>
  )
}

/// How long a fixed term has left, and the three cases that are not one case.
///
///   no end date  → "Permanent". PKWTT has no end and never will; a dash here
///                  would read as a missing value somebody should go and fill in.
///   already past → "Ended 12d ago", red. This is not a deadline approaching,
///                  it is somebody turning up to work without a contract, which
///                  is a legal problem rather than a data one.
///   ahead        → the count, amber inside a fortnight.
///
/// The amber threshold is a reading aid and not a rule: nothing is enforced by
/// this colour, and the figure beside it is the fact.
export function Term({ days }: { days: number | null }) {
  if (days === null) return <Quiet>Permanent</Quiet>
  if (days < 0) {
    return (
      <span className="text-bad-ink font-medium tabular-nums">
        Ended {Math.abs(days).toLocaleString("id-ID")}d ago
      </span>
    )
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        days <= 14 ? "text-warn-ink font-medium" : "text-ink-2",
      )}
    >
      {days.toLocaleString("id-ID")} days
    </span>
  )
}

/// A record's fields, inside a sheet.
///
/// A description list rather than a grid of divs, because that is what it is:
/// somebody reading a sheet with a screen reader gets "Posted to, Store 01" as
/// one utterance instead of two unrelated strings.
export function Facts({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-[18px] py-4">
      {children}
    </dl>
  )
}

export function Fact({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  /// Across both columns, for a sentence rather than a value.
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-label text-ink-4">{label}</dt>
      <dd className="text-cell text-ink-2 m-0 mt-0.5">{children}</dd>
    </div>
  )
}

/// A heading inside a sheet, over a list that is not the record itself — the
/// postings behind a person, the slips behind a run.
export function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-line bg-side text-meta text-ink-3 border-y px-[18px] py-1.5 font-medium">
      {children}
    </h2>
  )
}

/// One line of such a list.
export function Line({
  children,
  note,
}: {
  children: React.ReactNode
  /// The reason, the actor, the date — whatever the line is evidence of.
  note?: React.ReactNode
}) {
  return (
    <div className="border-line border-b px-[18px] py-2.5 last:border-b-0">
      <div className="text-cell text-ink-2 flex items-baseline gap-3">
        {children}
      </div>
      {note !== undefined && (
        <div className="text-label text-ink-4 mt-0.5">{note}</div>
      )}
    </div>
  )
}

/// A number that was NOT MEASURED, drawn as one.
///
/// ## This is the most important component in the module
///
/// `CloseReadiness.open_corrections` and `.unrostered_punch_days` are
/// `number | null`, and the server means something precise by the `null`: there
/// is no punch source anywhere in the cloud, so nothing counted them. It is not
/// zero. Zero is a measurement — it says somebody looked and found none — and a
/// month signed off against a tidy row of zeros is a month signed off as clean
/// when half of it was never examined.
///
/// So an unmeasured figure is an em dash, and the reason is on it rather than
/// in a footnote: `title` is what a pointer reveals and what a screen reader
/// reads out of the `<abbr>`. The dotted underline is there so somebody can
/// SEE there is something to hover — a bare dash invites the reader to supply
/// their own explanation, and the one they supply is usually "zero".
export function NotAssessed({ why }: { why: string }) {
  return (
    <abbr
      title={why}
      className="text-ink-4 decoration-line-2 cursor-help no-underline underline-offset-[3px] [text-decoration:underline_dotted]"
    >
      —
    </abbr>
  )
}

/// One figure in a block of them, with what it is under it.
///
/// Not `kit/tiles.tsx`: a tile is a headline figure somebody acts on, drawn
/// large across the top of a list. These are the small counts inside a record —
/// the four things standing between a month and its close — and they have to be
/// able to draw a dash as readily as a number, which a tile's `Figure` cannot.
export function Measure({
  label,
  children,
  note,
  tone,
}: {
  label: string
  children: React.ReactNode
  note?: React.ReactNode
  tone?: "warn" | "ok"
}) {
  return (
    <div className="border-line min-w-0 border-r px-4 py-2.5 last:border-r-0">
      <div className="text-label text-ink-3">{label}</div>
      <div
        className={cn(
          "text-metric mt-0.5 font-semibold tabular-nums",
          tone === "warn" && "text-warn-ink",
          tone === "ok" && "text-ok-ink",
        )}
      >
        {children}
      </div>
      {note !== undefined && (
        <div className="text-meta text-ink-4 mt-0.5">{note}</div>
      )}
    </div>
  )
}

/// The strip such measures sit in.
export function Measures({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line grid shrink-0 grid-cols-2 border-b sm:grid-cols-3 lg:grid-cols-5">
      {children}
    </div>
  )
}

/// A heading over a block inside the page itself rather than inside a sheet.
///
/// `SubHead` above is drawn on the sheet's own ground and is 18px in from the
/// edge, which is the sheet's gutter and not the page's. Two blocks that look
/// alike and sit on different grounds end up a few pixels out of step with
/// everything around them, so the page's version is its own.
export function BandHead({
  children,
  trailing,
}: {
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <div className="border-line bg-side flex shrink-0 items-center gap-3 border-b px-4 py-1.5">
      <h2 className="text-meta text-ink-3 m-0 font-medium">{children}</h2>
      {trailing !== undefined && (
        <span className="text-meta text-ink-4 ml-auto">{trailing}</span>
      )}
    </div>
  )
}

/// The control that moves a screen's window — a week, a month.
///
/// ## Why a stepper and not a date box alone
///
/// Because the question is almost always "and the one before that". A manager
/// checking coverage steps back a week; somebody chasing a close steps back a
/// month. Typing a date to move by one is four interactions for a question that
/// should be one, and a bare box gives no hint that stepping is even possible.
///
/// The box stays, for the jump that is not adjacent. It is a NATIVE
/// `<input type="date">` or `type="month"`: the platform's own picker knows
/// which day is a Sunday and which months have thirty-one days, it is reachable
/// by keyboard, and it is already in the reader's own language and week-start.
/// A hand-built calendar here would be a second implementation of a date, in a
/// module whose entire subject is dates.
///
/// Nothing is held in component state. The value is a URL parameter and
/// `onChange` writes it back, so a week is a link somebody can send.
export function Stepper({
  value,
  onChange,
  kind,
  label,
  back,
  forward,
}: {
  value: string
  onChange: (value: string) => void
  /// `date` for a week's Monday, `month` for a period.
  kind: "date" | "month"
  /// What the control is for, for a reader who has only the input.
  label: string
  /// The value one step back, and one step on. Computed by the CALLER, because
  /// a week steps by seven days and a month by one month and this control has
  /// no business knowing which of those it is looking at.
  back: string
  forward: string
}) {
  return (
    <div className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex items-center border">
      <Step label={`Back one ${kind === "date" ? "week" : "month"}`} onClick={() => onChange(back)}>
        <ChevronLeft className="size-4" />
      </Step>
      <input
        type={kind}
        value={value}
        aria-label={label}
        onChange={(event) => {
          // An empty box — which a native picker permits while it is being
          // cleared — is not a date, and writing it to the URL would blank the
          // screen mid-keystroke. The last good value stands until there is a
          // new one.
          if (event.target.value !== "") onChange(event.target.value)
        }}
        className="text-ctl text-ink-2 border-line h-full min-w-0 border-x bg-transparent px-2 text-center outline-none"
      />
      <Step label={`Forward one ${kind === "date" ? "week" : "month"}`} onClick={() => onChange(forward)}>
        <ChevronRight className="size-4" />
      </Step>
    </div>
  )
}

function Step({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="text-ink-4 hover:bg-hover hover:text-ink grid h-full w-8 shrink-0 place-items-center transition-colors first:rounded-l-[7px] last:rounded-r-[7px]"
    >
      {children}
    </button>
  )
}
