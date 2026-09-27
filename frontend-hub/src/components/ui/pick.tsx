import { Combobox } from "@base-ui/react/combobox"
import { Check, ChevronDown, Plus, X } from "lucide-react"
import { useMemo, useState } from "react"

import { HAS_INVALID, INVALID, useFieldAria } from "@/components/ui/field-state"
import { PickerSheet } from "@/components/ui/picker-sheet"
import { usePickerSheet } from "@/lib/layout"
import { Tag } from "@/components/ui/tag"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import { cn } from "@/lib/utils"

/// Choosing from a vocabulary, by typing at it.
///
/// A `<Select>` is the right control for four options and the wrong one for a
/// hundred: the tag table already carries dozens, and a native dropdown makes
/// somebody scroll a list they could have finished typing. These are the two
/// shapes that question comes in — pick one, pick several — over the same Base
/// UI primitive the filter bar uses, with the same popup and item classes, so
/// a list of tags looks the same wherever it is opened.
///
/// Deliberately NOT the filter omnibox. That control edits a *clause* —
/// column, operator, values — and its complexity is all in the operator. These
/// edit a value.

/// One word out of a vocabulary, as it is stored and as it is read.
export interface Choice {
  readonly value: string
  readonly label: string
}

/// The trigger both shapes wear: a field, not a chip.
///
/// It is `<Input>`'s chrome, class for class — `h-9`, the `{soft-2}` fill, the
/// transparent border that only appears on hover — because that is what this
/// comment always claimed and never was. It was a 32px white pill with a
/// hairline round it, standing in the same form row as a 36px grey one, and a
/// supplier box beside a PO number box read as two controls from two
/// different applications.
///
/// `min-h-9` rather than `h-9`: `<PickMany>` grows as chips wrap, and a fixed
/// height would clip the second row. A caller in a table or a toolbar
/// compacts it the way `<Day>` is compacted — `min-h-8 px-2.5
/// text-[0.875rem]` — and twMerge lets those win.
const FIELD = cn(
  "flex min-h-10 w-full items-center gap-1.5 rounded-inner border border-hairline-2 bg-canvas px-3 py-1 text-left text-[0.875rem] transition-colors hover:border-hairline-strong has-[input:focus-visible]:border-accent",
  // Refused: the box itself carries `aria-invalid` on a phone (it is the
  // button), the input inside it does on a desk.
  INVALID,
  HAS_INVALID,
  "has-[[aria-invalid=true]]:has-[input:focus-visible]:border-bad",
  // Locked. On a phone the box is the button; on a desk the input inside is.
  "disabled:opacity-50 has-[input:disabled]:opacity-50 has-[input:disabled]:hover:border-hairline-2"
)

function match(choices: readonly Choice[], query: string): readonly Choice[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return choices
  return choices.filter(
    (one) =>
      one.label.toLowerCase().includes(needle) ||
      one.value.toLowerCase().includes(needle)
  )
}

/// Exactly one, or none.
///
/// `null` is a real answer and stays reachable: an item nobody has classified
/// is a state this catalogue is full of, and a control that can only ever add
/// a division would make "unclassified" a thing you cannot go back to.
export function PickOne({
  choices,
  value,
  onChange,
  placeholder = "Unclassified",
  className,
  label,
  action,
  disabled,
  invalid,
  required,
}: {
  choices: readonly Choice[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  className?: string
  /// Locked: the answer is shown, and cannot be changed or cleared.
  disabled?: boolean
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  /// Also takes away the clearing ×: a required answer cannot be emptied from
  /// the control that is asking for it.
  required?: boolean
  /// For the screen reader. The visible label is usually a table header, which
  /// no assistive technology associates with a control on its own.
  label?: string
  /// A way out of the list, standing at the foot of it: "Create a new
  /// supplier" under the suppliers, for the buyer who has just searched for
  /// one that is not there.
  ///
  /// **In the panel, not beside the field.** A + button next to the box is a
  /// second control somebody has to notice while they are looking somewhere
  /// else — at the list, reading it for a name that is not in it. The moment
  /// the answer is "it is not here" happens INSIDE the panel, and that is
  /// where the way out belongs. It also survives an empty search, which is
  /// exactly when it is wanted.
  ///
  /// Outside `<Combobox.List>`, so a query that matches nothing does not
  /// filter away the one row that answers it.
  action?: {
    readonly label: string
    readonly onSelect: () => void
  }
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => match(choices, query), [choices, query])
  const chosen = choices.find((one) => one.value === value) ?? null
  const sheet = usePickerSheet()
  const aria = useFieldAria({ invalid, required })
  const clearable =
    chosen !== null && disabled !== true && aria["aria-required"] !== true

  // A phone: the field is a button, and the list comes up from the bottom.
  // See `picker-sheet.tsx` for why.
  if (sheet) {
    return (
      <>
        <div className={cn(FIELD, "relative", className)}>
          {/* The whole field is the target, not just the words in it: the
              button's hit area is stretched over the box (`after:inset-0`),
              so a tap on the padding or the chevron opens the list too. It
              was the text alone, and a thumb landing a few pixels off it did
              nothing — the "tap it twice" division picker. */}
          <button
            type="button"
            aria-label={label}
            aria-haspopup="dialog"
            disabled={disabled}
            {...aria}
            onClick={() => setOpen(true)}
            className={cn(
              "min-h-9 min-w-0 flex-1 truncate text-left after:absolute after:inset-0 after:content-['']",
              chosen === null ? "text-mute" : "text-ink"
            )}
          >
            {chosen?.label ?? placeholder}
          </button>
          {clearable && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => onChange(null)}
              className="relative z-10 -mr-1 grid size-9 shrink-0 place-items-center rounded-full text-line-ico"
            >
              <X className="size-3.5" />
            </button>
          )}
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-line-ico"
          />
        </div>
        <PickerSheet
          open={open}
          onOpenChange={setOpen}
          title={label ?? placeholder}
          options={choices}
          selected={value === null ? [] : [value]}
          onPick={(next) => onChange(next)}
          action={action}
          searchable
        />
      </>
    )
  }

  return (
    <Combobox.Root
      items={rows as Choice[]}
      // The first match is lit as you type, so Enter takes it — typing a
      // name and pressing Enter is how a keyboard user finishes a pick.
      autoHighlight
      // Already filtered above, against the code as well as the label — the
      // built-in matcher only sees what `itemToStringLabel` returns.
      filter={null}
      value={chosen}
      onValueChange={(next) => {
        onChange((next as Choice | null)?.value ?? null)
        setQuery("")
      }}
      // What is chosen while the panel is shut, what is being typed while it
      // is open. Showing the chosen label as the input's PLACEHOLDER instead
      // was the obvious shortcut and it lies: a placeholder is drawn in the
      // muted colour that means "nothing here yet", so a line filed under Kids
      // read exactly like a line nobody had filed.
      inputValue={open ? query : (chosen?.label ?? "")}
      onInputValueChange={(next) => open && setQuery(next)}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Opening starts a fresh search rather than pre-filling the box with
        // what is already chosen — which would show one row and hide the
        // vocabulary somebody opened the list to see.
        if (next) setQuery("")
      }}
      itemToStringLabel={(one) => (one ? (one as Choice).label : "")}
      modal={false}
      disabled={disabled}
    >
      <Combobox.InputGroup className={cn(FIELD, className)}>
        <Combobox.Input
          aria-label={label}
          {...aria}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        {/* Clearing is a decision, so it gets its own control rather than
            being something you discover by emptying the box. Only drawn when
            there is something to clear. */}
        {clearable && (
          <button
            type="button"
            aria-label="Clear"
            className="shrink-0 rounded-full p-0.5 text-line-ico hover:bg-soft-2 hover:text-ink"
            onClick={(event) => {
              event.stopPropagation()
              onChange(null)
            }}
          >
            <X className="size-3" />
          </button>
        )}
        <Combobox.Trigger
          aria-label="Open"
          className="shrink-0 text-line-ico hover:text-ink"
        >
          <ChevronDown className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-[var(--anchor-width)] min-w-[13rem]"
        >
          <Combobox.Popup className={cn(POPUP, "w-full")}>
            <Combobox.List>
              <Combobox.Empty className="px-2.5 py-3 text-center text-meta text-mute">
                Nothing matches.
              </Combobox.Empty>
              {rows.map((one) => (
                <Combobox.Item
                  key={one.value}
                  value={one}
                  className={cn(ITEM, "justify-between")}
                >
                  {one.label}
                  {one.value === value && (
                    <Check className="size-3.5 text-line-ico" />
                  )}
                </Combobox.Item>
              ))}
            </Combobox.List>

            {action !== undefined && (
              <>
                {/* A rule above it, because this is not one more of the
                    things being chosen between — it is what to do when none
                    of them is the answer. */}
                <div className="mx-1 my-1 border-t border-hairline" />
                <button
                  type="button"
                  className={cn(ITEM, "font-medium hover:bg-soft-2")}
                  // The input keeps the caret: a mousedown that blurs it
                  // closes the panel before the click ever lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setOpen(false)
                    setQuery("")
                    action.onSelect()
                  }}
                >
                  <Plus className="size-3.5 text-line-ico" />
                  {action.label}
                </button>
              </>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/// Several, held as chips inside the field.
///
/// The panel stays open on a pick, which is the whole difference from
/// `PickOne`: choosing one tag says nothing about whether the next one is
/// wanted, and a list that closes after every tick makes adding three tags
/// three round trips through the same dropdown.
export function PickMany({
  choices,
  values,
  onChange,
  placeholder = "None",
  className,
  label,
  leading,
  disabled,
  invalid,
  required,
}: {
  choices: readonly Choice[]
  values: readonly string[]
  onChange: (values: readonly string[]) => void
  placeholder?: string
  className?: string
  label?: string
  /// Something drawn before each word, in the chips and in the list.
  ///
  /// For colour, which is the one vocabulary in this app that is RECOGNISED
  /// rather than read: "the navy one" is how somebody describes a garment they
  /// are holding, and a column of ticked words throws that away.
  leading?: (value: string) => React.ReactNode
  /// Locked: the chips are shown and none can be added or removed.
  disabled?: boolean
  /// Refused, outside a `<Field>`. Inside one the field says it.
  invalid?: boolean
  /// At least one is wanted.
  required?: boolean
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => match(choices, query), [choices, query])
  const chosen = useMemo(
    () => values.map((one) => choices.find((c) => c.value === one) ?? null),
    [values, choices]
  )

  const toggle = (value: string) =>
    onChange(
      values.includes(value)
        ? values.filter((one) => one !== value)
        : [...values, value]
    )
  const sheet = usePickerSheet()
  const aria = useFieldAria({ invalid, required })

  if (sheet) {
    return (
      <>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          disabled={disabled}
          {...aria}
          onClick={() => setOpen(true)}
          className={cn(FIELD, "flex-wrap", className)}
        >
          {values.length === 0 && (
            <span className="min-h-9 flex-1 content-center text-mute">
              {placeholder}
            </span>
          )}
          {values.map((value) => {
            const one = choices.find((c) => c.value === value)
            return (
              <Tag key={value} className="gap-1">
                {leading?.(value)}
                {one?.label ?? value}
              </Tag>
            )
          })}
          <ChevronDown
            aria-hidden
            className="ml-auto size-3.5 shrink-0 text-line-ico"
          />
        </button>
        <PickerSheet
          open={open}
          onOpenChange={setOpen}
          title={label ?? placeholder}
          options={choices.map((one) => ({
            ...one,
            leading: leading?.(one.value),
          }))}
          selected={values}
          multiple
          onPick={toggle}
          searchable
        />
      </>
    )
  }

  return (
    <Combobox.Root
      items={rows as Choice[]}
      filter={null}
      multiple
      // Type "basic", press Enter, it is on: the first match is lit as the
      // query changes, and Enter takes what is lit. Without it nothing was
      // highlighted until an arrow key, and Enter did nothing at all.
      autoHighlight
      value={chosen.filter((one) => one !== null) as Choice[]}
      onValueChange={(next) => {
        onChange((next as Choice[]).map((one) => one.value))
        setQuery("")
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(next, details) => {
        // A pick is not an exit — see the class comment. Base UI closes on
        // `item-press` because a combobox that chooses one thing is finished
        // the moment it is chosen; this one usually is not.
        if (!next && details.reason === "item-press") return
        setOpen(next)
      }}
      itemToStringLabel={(one) => (one ? (one as Choice).label : "")}
      modal={false}
      disabled={disabled}
    >
      <Combobox.InputGroup className={cn(FIELD, "flex-wrap", className)}>
        {values.map((value) => {
          const one = choices.find((c) => c.value === value)
          return (
            <Tag key={value} className="gap-1">
              {leading?.(value)}
              {one?.label ?? value}
              {disabled !== true && (
                <button
                  type="button"
                  aria-label={`Remove ${one?.label ?? value}`}
                  className="-mr-0.5 rounded-full text-line-ico hover:text-ink"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle(value)
                  }}
                >
                  <X className="size-2.5" />
                </button>
              )}
            </Tag>
          )
        })}
        <Combobox.Input
          aria-label={label}
          {...aria}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[3rem] flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        <Combobox.Trigger
          aria-label="Open"
          className="shrink-0 text-line-ico hover:text-ink"
        >
          <ChevronDown className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-[var(--anchor-width)] min-w-[13rem]"
        >
          <Combobox.Popup className={cn(POPUP, "w-full")}>
            <Combobox.List>
              <Combobox.Empty className="px-2.5 py-3 text-center text-meta text-mute">
                Nothing matches.
              </Combobox.Empty>
              {rows.map((one) => (
                <Combobox.Item
                  key={one.value}
                  value={one}
                  className={cn(ITEM, "justify-between")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {leading?.(one.value)}
                    {one.label}
                  </span>
                  {values.includes(one.value) && (
                    <Check className="size-3.5 text-line-ico" />
                  )}
                </Combobox.Item>
              ))}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
