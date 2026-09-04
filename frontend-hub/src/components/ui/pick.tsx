import { Combobox } from "@base-ui/react/combobox"
import { Check, ChevronDown, X } from "lucide-react"
import { useMemo, useState } from "react"

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
/// They sit in table cells and in forms beside `<Input>`, so they take the
/// same height and the same resting colour. A chip would read as a filter, and
/// these are not filtering anything.
const FIELD =
  "flex min-h-8 w-full items-center gap-1.5 rounded-full border border-hairline-2 bg-canvas px-2.5 py-1 text-left text-[0.78125rem] transition-colors hover:bg-soft-2 has-[input:focus-visible]:border-line has-[input:focus-visible]:bg-canvas"

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
}: {
  choices: readonly Choice[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  className?: string
  /// For the screen reader. The visible label is usually a table header, which
  /// no assistive technology associates with a control on its own.
  label?: string
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => match(choices, query), [choices, query])
  const chosen = choices.find((one) => one.value === value) ?? null

  return (
    <Combobox.Root
      items={rows as Choice[]}
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
    >
      <Combobox.InputGroup className={cn(FIELD, className)}>
        <Combobox.Input
          aria-label={label}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
        />
        {/* Clearing is a decision, so it gets its own control rather than
            being something you discover by emptying the box. Only drawn when
            there is something to clear. */}
        {chosen !== null && (
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

  return (
    <Combobox.Root
      items={rows as Choice[]}
      filter={null}
      multiple
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
    >
      <Combobox.InputGroup className={cn(FIELD, "flex-wrap", className)}>
        {values.map((value) => {
          const one = choices.find((c) => c.value === value)
          return (
            <Tag key={value} className="gap-1">
              {leading?.(value)}
              {one?.label ?? value}
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
            </Tag>
          )
        })}
        <Combobox.Input
          aria-label={label}
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
