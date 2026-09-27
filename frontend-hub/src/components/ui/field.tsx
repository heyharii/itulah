import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox"
import { Select as BaseSelect } from "@base-ui/react/select"
import { Check, ChevronDown, Minus } from "lucide-react"
import * as React from "react"

import {
  FieldContext,
  INVALID,
  useFieldAria,
} from "@/components/ui/field-state"
import { PickerSheet } from "@/components/ui/picker-sheet"
import { usePickerSheet } from "@/lib/layout"
import { ITEM, PANEL } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"

/// A labelled input, and the one place a field's chrome is described.
///
/// Inputs are pills like everything else interactive, `{soft-2}` filled, and
/// they take the indigo focus ring the base layer authors — so a form does not
/// have to restate any of it.
///
/// **It also tells the control inside it what state it is in.** A `problem`
/// makes the box red and `aria-invalid`, `required` makes it `aria-required`,
/// and the sentence under it is wired to it with `aria-describedby` — through
/// `FieldContext`, so no form writes any of that by hand again.
export function Field({
  label,
  hint,
  problem,
  aside,
  required,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  /// A short fact ABOUT the question, set beside the label instead of under
  /// the answer.
  ///
  /// Brief §10.2, and it is a real rule rather than a style preference: a
  /// caption under an input is read every time the field is read, and a form
  /// of nine of them becomes a page of nine-point grey. The same words beside
  /// the label are read once and stop being furniture. The `hint` slot is
  /// still there for the one case that genuinely belongs under the answer —
  /// a figure the reader is meant to compare against.
  aside?: React.ReactNode
  /// The server's sentence, or a validator's. Never a code.
  ///
  /// Present — anything but `null`, `undefined`, `false` or `""` — means the
  /// answer is refused, and the control inside is drawn and announced so.
  problem?: React.ReactNode
  /// The form cannot be sent without an answer here.
  ///
  /// A star after the label, in `{bad}`, because that is the mark the owner
  /// already reads as "wajib" — and only the star: a form that also writes
  /// "(optional)" on every other field is marking the same thing twice. So an
  /// unmarked field is optional, and a form that marks its required fields
  /// has to mark ALL of them, or the unmarked one reads as skippable.
  ///
  /// Deliberately `aria-required`, not the native `required` attribute: the
  /// native one makes the browser throw its own bubble on submit, in the
  /// browser's language, over a form that already says what is missing.
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  const invalid =
    problem !== undefined &&
    problem !== null &&
    problem !== false &&
    problem !== ""
  const under = invalid ? `${id}-problem` : hint ? `${id}-hint` : undefined
  const state = React.useMemo(
    () => ({ invalid, required: required === true, describedBy: under }),
    [invalid, required, under]
  )

  return (
    <label className={cn("flex flex-col gap-[0.4375rem]", className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-[0.875rem] font-medium text-text">
          {label}
          {required === true && (
            <>
              <span aria-hidden className="ml-0.5 text-bad">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </span>
        {aside && (
          <span className="shrink-0 truncate rounded-inner bg-soft-2 px-[0.375rem] text-[0.875rem] text-body">
            {aside}
          </span>
        )}
      </span>
      <FieldContext.Provider value={state}>{children}</FieldContext.Provider>
      {invalid ? (
        <span id={under} className="text-[0.875rem] text-bad">
          {problem}
        </span>
      ) : hint ? (
        <span id={under} className="text-[0.875rem] text-mute">
          {hint}
        </span>
      ) : null}
    </label>
  )
}

/// `ComponentPropsWithRef` rather than `InputHTMLAttributes`: React 19 passes
/// `ref` as an ordinary prop, and `<Money>` needs one to put the caret back
/// after it has regrouped the digits.
export function Input({
  className,
  invalid,
  required,
  ...props
}: React.ComponentPropsWithRef<"input"> & {
  /// Refused, outside a `<Field>` — a cell in a table. Inside one, the
  /// field's `problem` says it and this is left alone.
  invalid?: boolean
}) {
  const aria = useFieldAria({
    invalid: invalid ?? ariaFlag(props["aria-invalid"]),
    required,
    describedBy: props["aria-describedby"],
  })
  return (
    <input
      {...props}
      {...aria}
      className={cn(
        "h-10 w-full rounded-inner border border-hairline-2 bg-canvas px-3 text-[0.875rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-strong focus:border-accent",
        "disabled:opacity-50",
        // Read, not typed — a record open for reading shows its answers in
        // the same boxes, without the hover that invites a click.
        "read-only:hover:border-hairline-2",
        INVALID,
        // No spinner on a number box. The little stepper is the operating
        // system's drawing, in the operating system's grey, and it lands on
        // top of the figure in a right-aligned cell — a quantity of 2 read as
        // "2" with a grey box shoved against it. Nobody clicks it: a quantity
        // is typed.
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className
      )}
    />
  )
}

/// `aria-invalid` as a caller may have written it — `true`, `"true"`, or a
/// `false` that must not be mistaken for "no opinion".
function ariaFlag(
  value: React.AriaAttributes["aria-invalid"]
): boolean | undefined {
  if (value === undefined) return undefined
  return value === true || value === "true"
}

/// Multi-line input. The one control that is not a pill — a rounded rectangle,
/// because a pill with three lines of text in it reads as a mistake.
export function Textarea({
  className,
  invalid,
  required,
  ...props
}: React.ComponentPropsWithRef<"textarea"> & { invalid?: boolean }) {
  const aria = useFieldAria({
    invalid: invalid ?? ariaFlag(props["aria-invalid"]),
    required,
    describedBy: props["aria-describedby"],
  })
  return (
    <textarea
      {...props}
      {...aria}
      className={cn(
        "w-full rounded-inner border border-hairline-2 bg-canvas px-3 py-2.5 text-[0.875rem] leading-[1.375rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-strong focus:border-accent",
        // It had none, so a locked note read exactly like one waiting to be
        // written in — the one control on a locked record that looked open.
        "disabled:opacity-50",
        "read-only:hover:border-hairline-2",
        INVALID,
        className
      )}
    />
  )
}

/// A yes/no.
///
/// Base UI's checkbox and not `<input type="checkbox">`, for the same reason as
/// `<Select>` and `<Day>`: the box, its corner radius and the weight of its
/// tick are drawn by the operating system, and `accent-color` only ever
/// coloured somebody else's drawing. A form of six of these looked like this
/// app on a Mac and like a Windows dialogue on a counter machine.
///
/// It also stops the third copy. System wrote one, Finance wrote one, and
/// Commercial inlined a bare `<input>` inside a table cell — three ticks with
/// three different sizes, which is exactly what `finance/parts` predicted in
/// writing when it said this "would be welcome upstairs the day a second
/// module wants them".
///
/// Named `Checkbox` rather than `Check` on purpose: `Check` is the lucide icon,
/// imported by a dozen files here, and two things called `Check` in one import
/// list is a rename waiting to happen.
export function Checkbox({
  label,
  hint,
  checked,
  indeterminate,
  onChange,
  disabled,
  invalid,
  required,
  className,
}: {
  /// Beside the box, and part of its hit area. A cell that has no room for
  /// words passes an `<span className="sr-only">` instead.
  label: React.ReactNode
  /// Why a disabled box is disabled. A control that cannot be used has to say
  /// so ON the page — a tooltip is not an explanation to somebody reading.
  hint?: React.ReactNode
  checked: boolean
  /// Some of the rows under it, not all and not none — the "select all" box
  /// at the head of a table. Drawn as a dash; a press on it ticks everything.
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /// A box that must be ticked and was not — "I have counted the cash".
  invalid?: boolean
  required?: boolean
  className?: string
}) {
  const aria = useFieldAria({ invalid, required })
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* One `<label>` over both, so the words are part of the hit area: a
          `<button>` is labelable, so a click on the text is forwarded to the
          box and toggles it exactly once. */}
      <label
        className={cn(
          "inline-flex items-center gap-2 text-[0.875rem] text-text",
          disabled === true ? "opacity-55" : "cursor-pointer"
        )}
      >
        <BaseCheckbox.Root
          checked={checked}
          indeterminate={indeterminate}
          onCheckedChange={onChange}
          disabled={disabled}
          {...aria}
          className={cn(
            "grid size-3.5 shrink-0 place-items-center rounded-[0.25rem] border border-hairline-strong bg-canvas transition-colors outline-none",
            "hover:border-line",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            "data-checked:border-accent data-checked:bg-accent",
            "data-indeterminate:border-accent data-indeterminate:bg-accent",
            "aria-[invalid=true]:border-bad aria-[invalid=true]:hover:border-bad",
            "data-disabled:cursor-default"
          )}
        >
          <BaseCheckbox.Indicator className="flex text-white">
            {indeterminate === true ? (
              <Minus className="size-2.5" strokeWidth={3} />
            ) : (
              <Check className="size-2.5" strokeWidth={3} />
            )}
          </BaseCheckbox.Indicator>
        </BaseCheckbox.Root>
        {label}
      </label>
      {hint !== undefined && (
        <span className="text-[0.875rem] text-mute">{hint}</span>
      )}
    </span>
  )
}

/// Money, grouped as it is typed.
///
/// Rupiah is written in thousands — 2.000.000 — and a figure typed without the
/// dots is a figure nobody can check: `2000000` and `20000000` are the same
/// shape at a glance, and the difference between them is ten times the budget.
/// So the grouping happens on every keystroke. Base UI's `NumberField` groups
/// on BLUR, which is the wrong moment — by the time you have left the field you
/// have already stopped looking at it — and that is the whole reason this is
/// hand-rolled rather than one more Base UI part.
///
/// **The caller holds digits.** `onChange` hands back `"2000000"`, never
/// `"2.000.000"`, so nothing downstream has to learn about separators: the
/// figure a form sends is the figure it was holding. What is on screen is a
/// rendering of that, the same way `money()` renders one in a table.
///
/// Whole rupiah only. IDR has no minor unit in practice, and letting a
/// fractional rupiah into a posting is the one thing this app must not do.
///
/// A minus is refused unless the caller asks for `signed`. Almost nothing here
/// wants one — a refund and a credit are entered as what they are worth and
/// given their sign by the document they belong to — but a bank balance can
/// genuinely be below zero, and a field that silently swallowed the minus
/// would read as an overdraft entered the wrong way round.
const grouping = new Intl.NumberFormat("id-ID")

/// What a person typed, as the number they meant.
///
/// Everything that is not a digit is dropped rather than refused: a pasted
/// `Rp 2.000.000` is somebody telling us the amount, not making a mistake. A
/// minus survives only at the front, and only where one is allowed.
function digitsOf(text: string, signed: boolean): string {
  const minus = signed && text.trimStart().startsWith("-") ? "-" : ""
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "")
  // A lone "-" is kept, or a signed field could never have one typed into it:
  // the minus would be dropped on the keystroke that entered it.
  return minus + digits
}

/// `BigInt` rather than `Number`, so a figure past 2^53 is grouped correctly
/// instead of silently rounded on the way to the screen.
function groupedOf(value: string): string {
  if (value === "" || value === "-") return value
  return grouping.format(BigInt(value))
}

function digitsBefore(text: string, at: number): number {
  let seen = 0
  for (let i = 0; i < at; i += 1)
    if (text[i] >= "0" && text[i] <= "9") seen += 1
  return seen
}

export function Money({
  value,
  onChange,
  onBlur,
  signed,
  prefix,
  suffix,
  placeholder,
  label,
  disabled,
  autoFocus,
  invalid,
  className,
}: {
  /// Digits, as `onChange` last gave them. `""` is empty, and what empty MEANS
  /// — unlimited, nothing, not yet answered — is the caller's to say in the
  /// placeholder.
  value: string
  onChange: (digits: string) => void
  /// For the form libraries that count a field as touched only once it has
  /// been left.
  onBlur?: () => void
  /// Whether a leading minus is a legal answer. See the note above.
  signed?: boolean
  /// Set before the figure — "Rp".
  prefix?: string
  /// Set after it — "%", "units", "baskets".
  suffix?: string
  placeholder?: string
  label?: string
  disabled?: boolean
  autoFocus?: boolean
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  className?: string
}) {
  const box = React.useRef<HTMLInputElement>(null)
  /// How many digits stood to the left of the caret when the change was made.
  /// The separators move as you type, so a caret remembered as a character
  /// offset lands in the wrong place the moment a dot is inserted behind it —
  /// which is the bug that makes hand-rolled money fields unusable.
  const caret = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    const el = box.current
    const wanted = caret.current
    if (el === null || wanted === null) return
    caret.current = null
    let seen = 0
    let at = 0
    while (at < el.value.length && seen < wanted) {
      if (el.value[at] >= "0" && el.value[at] <= "9") seen += 1
      at += 1
    }
    el.setSelectionRange(at, at)
  })

  const commit = (text: string, at: number) => {
    caret.current = digitsBefore(text, at)
    onChange(digitsOf(text, signed === true))
  }

  return (
    // `className` goes to the box, not to this wrapper, so a caller narrowing
    // the field gets a narrower field — which is what `<Input className>` did
    // at every site this replaced. An affix is positioned against the wrapper,
    // so a narrowed box wants no prefix or suffix.
    <span className="relative flex w-full min-w-0 items-center">
      {prefix !== undefined && (
        <span className="pointer-events-none absolute left-3.5 text-[0.875rem] text-mute">
          {prefix}
        </span>
      )}
      <Input
        ref={box}
        value={groupedOf(value)}
        inputMode="numeric"
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        invalid={invalid}
        onBlur={onBlur}
        onChange={(event) =>
          commit(event.target.value, event.target.selectionStart ?? 0)
        }
        onKeyDown={(event) => {
          // Backspace onto a separator. The dot is ours, not theirs: deleting
          // it would put the same string back on screen and look like a dead
          // key, so take the digit behind it — which is what was aimed at.
          if (event.key !== "Backspace") return
          const el = event.currentTarget
          const at = el.selectionStart ?? 0
          if (at < 2 || at !== el.selectionEnd) return
          if (el.value[at - 1] >= "0" && el.value[at - 1] <= "9") return
          event.preventDefault()
          commit(el.value.slice(0, at - 2) + el.value.slice(at), at - 2)
        }}
        className={cn(
          "tabular-nums",
          prefix !== undefined && "pl-9",
          suffix !== undefined && "pr-14",
          className
        )}
      />
      {suffix !== undefined && (
        <span className="pointer-events-none absolute right-3.5 text-[0.875rem] text-mute">
          {suffix}
        </span>
      )}
    </span>
  )
}

/// A choice from a fixed list.
///
/// Written as `<option>` children — the HTML everybody already knows — and NOT
/// drawn by a native `<select>`, which is the whole point of this file's
/// longest comment.
///
/// A native dropdown hands its panel to the operating system. The same form is
/// therefore a rounded, translucent sheet with a tick down the side on the Mac
/// it was designed on, and a square grey list in a different type size on the
/// Windows machines it is used on — and nothing in this kit can reach either
/// one. `appearance: none` restyles the CLOSED control only; the open panel is
/// not in the page. So every screen in this app was being designed against a
/// picture of itself that half its users never see.
///
/// Base UI's select draws the panel in the document, out of the same `PANEL`
/// and `ITEM` classes as the filter popups, so the list looks the same on every
/// machine and the same as every other list in the app. Two behaviours of the
/// native control are kept on purpose: the panel opens OVER the trigger with
/// the chosen row on top of it, which is what a Mac does and what the
/// screenshot this was built from shows — and that alignment is dropped
/// automatically when the control is opened by touch, where a panel under a
/// thumb is the right shape.
///
/// What is given up is the phone's own wheel picker, which a native `<select>`
/// brings for free. The till kit keeps its own copy of this file and can keep
/// the native control; this one is opened with a mouse.
interface Choice {
  readonly value: string
  readonly label: React.ReactNode
  readonly disabled: boolean
}

/// Read the `<option>` children as data.
///
/// Fragments and arrays are walked through, because most call sites build the
/// list with a `.map()` and some wrap a conditional pair in `<>…</>`. Anything
/// that is not an `<option>` is dropped rather than rendered: there is nowhere
/// in a list of choices for a stray node to go, and rendering it somewhere
/// arbitrary would hide the mistake.
function choices(children: React.ReactNode): Choice[] {
  const found: Choice[] = []

  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children)
        return
      }
      if (child.type !== "option") return
      const option =
        child.props as React.OptionHTMLAttributes<HTMLOptionElement>
      found.push({
        value: String(option.value ?? ""),
        label: option.children,
        disabled: option.disabled === true,
      })
    })
  }

  walk(children)
  return found
}

export function Select({
  className,
  children,
  value,
  onChange,
  disabled,
  placeholder = "Choose…",
  invalid,
  required,
  "aria-label": label,
}: {
  /// The chosen `<option value>`. Controlled, because every call site in this
  /// app already holds the value it is editing.
  value: string
  /// The value itself, not an event. A `<select>`'s `event.target.value` was
  /// only ever a way to reach this string, and there is no DOM select here to
  /// pretend one out of.
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  /// Drawn, muted, while nothing is chosen — `value` is `""` and no option
  /// carries `""`. The trigger was blank there before, and a blank box reads
  /// as a control that failed to load rather than a question not yet answered.
  /// An `<option value="">` still wins: that is a caller who has a word for
  /// "none" and wants it chosen like any other.
  placeholder?: string
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  required?: boolean
  /// When the visible label is a table header rather than a `<Field>`.
  "aria-label"?: string
}) {
  const items = choices(children)
  const sheet = usePickerSheet()
  const [open, setOpen] = React.useState(false)
  const aria = useFieldAria({ invalid, required })
  const unanswered = !items.some((one) => one.value === value)

  // A phone: the same sheet `<PickOne>` opens. The desk's panel overlaps the
  // trigger and its 30px rows were drawn for a pointer.
  if (sheet) {
    const chosen = items.find((one) => one.value === value)
    return (
      <>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen(true)}
          {...aria}
          className={cn(
            "flex h-10 w-full items-center rounded-inner border border-hairline-2 bg-canvas px-3 text-left text-[0.875rem] text-ink disabled:opacity-50",
            INVALID,
            className
          )}
        >
          <span
            className={cn("min-w-0 flex-1 truncate", unanswered && "text-mute")}
          >
            {chosen?.label ?? placeholder}
          </span>
          <ChevronDown className="ml-2 size-3.5 shrink-0 text-line-ico" />
        </button>
        <PickerSheet
          open={open}
          onOpenChange={setOpen}
          title={label ?? "Choose one"}
          options={items}
          selected={[value]}
          onPick={onChange}
        />
      </>
    )
  }

  return (
    <BaseSelect.Root
      // Given as data as well as as children, so the trigger can show the
      // chosen option's own node — "PKWT — fixed term", not "PKWT".
      items={items}
      // `null` is how Base UI spells "nothing chosen", and it is the only
      // value that draws the placeholder.
      value={unanswered ? null : value}
      onValueChange={(next) => onChange(String(next ?? ""))}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={label}
        {...aria}
        className={cn(
          "flex h-10 w-full items-center rounded-inner border border-hairline-2 bg-canvas py-0 pr-3 pl-3 text-left text-[0.875rem] text-ink transition-colors outline-none",
          // The two states `<Input>` and `<PickOne>` already wear, because a
          // form row holding a text box, a typeahead and a select was giving
          // three different answers to "is the pointer on me": a darker
          // border, a darker border, and a grey fill. The fill also made a
          // chosen value look switched off on the way to being changed, and
          // the `hover:border-hairline-2` beside it set the border to what it
          // already was — a state that had been written down but never drawn.
          "hover:border-hairline-strong",
          // And a select that is open or focused says so in the same blue as
          // every other control. It said nothing at all before: `outline-none`
          // with no border rule under it, so tabbing through a form left the
          // one field nobody could see they were on.
          "focus-visible:border-accent data-[popup-open]:border-accent",
          "data-disabled:opacity-50",
          INVALID,
          className
        )}
      >
        <BaseSelect.Value
          placeholder={placeholder}
          className="min-w-0 flex-1 truncate data-[placeholder]:text-mute"
        />
        <BaseSelect.Icon className="ml-2 shrink-0 text-line-ico">
          <ChevronDown className="size-3.5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50">
          {/* `p-1` on the panel and `px-2.5` on a row put an option's text at
              the trigger's own `pl-3.5`, which is what makes the overlapping
              panel land on the word it replaces rather than beside it. */}
          <BaseSelect.Popup
            className={cn(PANEL, "min-w-[var(--anchor-width)]")}
          >
            <BaseSelect.List className="max-h-[var(--available-height)] scroll-py-1 overflow-y-auto">
              {items.map((one) => (
                <BaseSelect.Item
                  key={one.value}
                  value={one.value}
                  disabled={one.disabled}
                  className={cn(
                    ITEM,
                    "justify-between",
                    // A refused option is shown, greyed, with its reason in the
                    // label — a choice that quietly disappears reads as a
                    // choice nobody thought of.
                    "data-disabled:cursor-default data-disabled:text-mute data-disabled:data-[highlighted]:bg-transparent"
                  )}
                >
                  <BaseSelect.ItemText className="truncate">
                    {one.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="shrink-0">
                    <Check className="size-3.5 text-line-ico" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
