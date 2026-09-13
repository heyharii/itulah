import { Check } from "lucide-react"

import { cn } from "@/lib/cn"

/// The controls this module needs and `kit/field.tsx` does not carry yet.
///
/// `kit/field.tsx` has a search box and a facet checkbox, because Finance and
/// People only read. Procurement is the first module that WRITES — a supplier,
/// a catalogue item, an order — so the controls a form is made of are written
/// here, in the module that needs them, rather than added to the shared kit on
/// the strength of one caller. They are candidates for promotion the moment a
/// second module wants one; every value in them is already a token, so
/// promotion is a move rather than a rewrite.
///
/// **There is no form library, and none is added.** A form here is a set of
/// fields whose values live where the screen keeps them — in the URL for
/// anything worth linking to or surviving a reload, on the server for anything
/// that is a draft. A library's job is validation, dirty tracking and submit
/// orchestration; the validation that matters is the server's (it refuses an
/// unknown tag code rather than dropping it), the dirty tracking is the
/// difference between the draft and the record, and the submit is one
/// `useMutation`. What is left is markup.

/// A field's label and the control under it.
///
/// The label is a real `<label>` wrapping its control, so a click on the word
/// lands in the box and a screen reader announces the two together. `hint` is
/// for the sentence that stops somebody filling a field in wrongly, and it goes
/// UNDER the control rather than above it: read before the box it is an
/// instruction nobody follows, read after it is an answer to the question they
/// have just formed.
export function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string
  hint?: React.ReactNode
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", wide && "col-span-2")}>
      <span className="text-label text-ink-3">{label}</span>
      {children}
      {hint !== undefined && (
        <span className="text-label text-ink-4">{hint}</span>
      )}
    </label>
  )
}

/// Two columns of fields. A form of ten fields down a rail is a form somebody
/// scrolls; the same ten in two columns is a form somebody reads.
export function Fields({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-[18px] py-4">
      {children}
    </div>
  )
}

const BOX =
  "h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn text-ctl text-ink placeholder:text-ink-4 focus:border-blue w-full min-w-0 border px-2.5 outline-none"

export function Text({
  value,
  onChange,
  placeholder,
  mono,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /// For a code somebody reads character by character — a supplier's own item
  /// number, a PO number. Proportional type makes `0293433029` a shape rather
  /// than a sequence.
  mono?: boolean
  disabled?: boolean
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(BOX, mono && "font-mono", disabled && "bg-field text-ink-3")}
    />
  )
}

/// Whole rupiah or whole pieces, held as TEXT.
///
/// A half-typed number is a state a person passes through, and parsing on every
/// keystroke turns an emptied box into an order for zero and a `1` on the way
/// to `150` into an order for one. The string is what is edited; `whole()` in
/// `labels.ts` is what reads it, once, at the moment it is used.
///
/// `inputMode="numeric"` rather than `type="number"`: a number input answers the
/// scroll wheel, which on a long form silently changes the figure under
/// somebody's cursor while they are scrolling past it.
export function Numeric({
  value,
  onChange,
  placeholder,
  unit,
  align = "right",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /// `Rp`, `pcs` — drawn inside the box so the figure stays right-aligned
  /// against its neighbours down a column.
  unit?: string
  align?: "left" | "right"
}) {
  return (
    <span className="h-ctl rounded-ctl border-line-2 bg-canvas shadow-btn focus-within:border-blue flex min-w-0 items-center gap-1.5 border px-2.5">
      {unit && <span className="text-label text-ink-4 shrink-0">{unit}</span>}
      <input
        value={value}
        inputMode="numeric"
        onChange={(event) =>
          onChange(event.target.value.replace(/[^0-9]/g, ""))
        }
        placeholder={placeholder}
        className={cn(
          "text-ctl text-ink placeholder:text-ink-4 min-w-0 flex-1 bg-transparent tabular-nums outline-none",
          align === "right" && "text-right",
        )}
      />
    </span>
  )
}

export interface Choice {
  readonly value: string
  readonly label: string
  /// A colour the DATA carries — a swatch beside a colour's name.
  readonly dot?: string | null
}

/// One of a closed set.
///
/// A native `<select>`, deliberately. A custom listbox is four keyboard
/// behaviours, a focus trap and a scroll container to get right, and it buys
/// nothing a form of eight fields can use — while the native one is what a
/// phone turns into a wheel and what a keyboard reaches by typing the first
/// letter.
export function PickOne({
  value,
  onChange,
  choices,
  empty = "Not chosen",
  disabled,
}: {
  value: string | null
  onChange: (value: string | null) => void
  choices: readonly Choice[]
  /// What "no choice" reads as. Present on purpose: unclassified is a real
  /// state for a supplier item — see `readinessOf` — and a picker with no way
  /// back to it is a picker that cannot undo a mistake.
  empty?: string
  disabled?: boolean
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
      className={cn(BOX, "appearance-none", disabled && "bg-field text-ink-3")}
    >
      <option value="">{empty}</option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}

/// Several of a closed set, as chips that toggle.
///
/// Chips rather than a multi-select, because the answer has to be READABLE
/// after it is given: a multi-select shows two of six choices and a scrollbar,
/// and the thing somebody is checking is which tags an item carries.
export function PickMany({
  values,
  onChange,
  choices,
  emptyNote,
}: {
  values: readonly string[]
  onChange: (values: readonly string[]) => void
  choices: readonly Choice[]
  /// What it means to pick none. Worth saying: on an update, an empty list
  /// REPLACES rather than leaves alone — see `UpdateSupplierItemRequest`.
  emptyNote?: React.ReactNode
}) {
  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const on = values.includes(choice.value)
          return (
            <button
              key={choice.value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on
                    ? values.filter((each) => each !== choice.value)
                    : [...values, choice.value],
                )
              }
              className={cn(
                "rounded-tag text-ctl inline-flex h-[25px] items-center gap-1.5 border px-[9px] font-medium whitespace-nowrap transition-colors",
                on
                  ? "border-blue/40 bg-blue-soft text-blue"
                  : "border-line-2 bg-canvas text-ink-3 hover:bg-hover hover:text-ink",
              )}
            >
              {choice.dot !== undefined && (
                <span
                  aria-hidden
                  className="border-line-2 size-[11px] shrink-0 rounded-full border"
                  style={
                    choice.dot === null ? undefined : { background: choice.dot }
                  }
                />
              )}
              {choice.label}
              {on && <Check className="size-3 shrink-0 stroke-[2.5]" />}
            </button>
          )
        })}
      </span>
      {values.length === 0 && emptyNote !== undefined && (
        <span className="text-label text-ink-4">{emptyNote}</span>
      )}
    </span>
  )
}
