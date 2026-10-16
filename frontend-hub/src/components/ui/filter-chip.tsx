import { Menu } from "@base-ui/react/menu"
import { Check, X } from "lucide-react"
import { useMemo, type ReactNode } from "react"

import {
  ITEM,
  POPUP,
  POSITIONER,
  retarget,
  type FilterOption,
} from "@/lib/filter-chrome"
import {
  arity,
  operatorLabel,
  operatorSections,
  operatorSymbol,
  operatorsFor,
  type Filter,
  type FilterField,
  type Operator,
} from "@/lib/filters"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// The pieces a filter chip is made of, shared by the two bars that draw one.
///
/// There are two ways to narrow a list in this app and there should only ever
/// be one chip. `<FilterBar>` is the mouse-driven bar over a table — pick a
/// column from a menu, an operator from a second menu, a value from a third
/// surface. `<FilterOmnibox>` is the typed one: a single box that offers
/// columns as you type and becomes the value editor once you pick one. What a
/// clause LOOKS like is the same either way, so it is drawn here once.
///
/// The class constants and the two functions that decide what a chip says live
/// next door in `lib/filter-chrome`, so this file exports components only.

/// The operator's symbol, set as a key.
///
/// Same geometry as the command palette's shortcut keys, because it is the
/// same idea: a token you recognise by shape rather than read. `=` and `not in`
/// are what somebody scans the menu for once they know what they want; the
/// prose beside it is what they read the first time.
export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-[5px] border border-hairline-2 bg-canvas px-1.5 py-px font-mono text-[0.9375rem] leading-[1.4] text-body">
      {children}
    </kbd>
  )
}

/* -------------------------------------------------------------------------- */

/// Every operator the field offers, under a heading per family.
///
/// Sectioned because a flat list of twenty is a list nobody reads past the
/// sixth row, and the four or five families are the shape somebody already has
/// in their head: the comparisons together, the text tests together, the two
/// emptiness questions at the end. A field offering one family gets no heading
/// at all — a heading over the only section is furniture.
export function OperatorMenu({
  field,
  operator,
  onChange,
  children,
  className,
}: {
  field: FilterField
  operator: Operator
  onChange: (next: Operator) => void
  /// The trigger. The chip passes its middle segment.
  children: ReactNode
  className?: string
}) {
  const sections = useMemo(
    () => operatorSections(operatorsFor(field.spec)),
    [field.spec]
  )

  return (
    <Menu.Root>
      <Menu.Trigger className={className}>{children}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className={POSITIONER}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className={cn(POPUP, "min-w-[15rem]")}>
            {sections.map((section) => (
              <Menu.Group key={section.group}>
                {sections.length > 1 && (
                  <Menu.GroupLabel className="px-2.5 pt-2 pb-1 text-[0.9375rem] font-semibold tracking-wide text-mute uppercase">
                    {section.label}
                  </Menu.GroupLabel>
                )}
                {section.operators.map((one) => (
                  <Menu.Item
                    key={one}
                    onClick={() => onChange(one)}
                    className={cn(ITEM, "justify-between")}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Check
                        className={cn(
                          "size-3.5 shrink-0 text-ink",
                          // Held rather than hidden, so the rows do not shift
                          // sideways as the tick moves down the list.
                          one === operator ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{operatorLabel(one)}</span>
                    </span>
                    <Keycap>{operatorSymbol(one)}</Keycap>
                  </Menu.Item>
                ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* -------------------------------------------------------------------------- */

/// One clause, read left to right as **column · operator · value**.
///
/// Every part of the sentence is the control that changes that part. That is
/// the whole idea the facet rail this replaces did not have: the operator is
/// visible and editable, so "supplier is any of" and "supplier is none of" are
/// the same chip with one word changed rather than two separate features, one
/// of which was never built.
///
/// The value segment is passed in as `children`, because that is the one part
/// the two bars genuinely disagree about: over a table it opens a popover of
/// its own, in the omnibox it hands the clause back to the one input.
export function FilterChip({
  field,
  filter,
  onChange,
  onRemove,
  children,
}: {
  field: FilterField
  filter: Filter
  onChange: (next: Filter) => void
  onRemove: () => void
  children?: ReactNode
}) {
  return (
    // `max-w-full`: the chip is as wide as its sentence, and its sentence can
    // be a supplier's full legal name. In a row it wrapped and in the panel's
    // 27.5rem column it would simply have hung over the edge, taking the
    // remove button with it — so the chip gives way at the container's width
    // and the value segment inside it truncates.
    <span className="inline-flex h-8 max-w-full items-stretch overflow-hidden rounded-full border border-hairline-2 bg-canvas text-meta">
      <span
        title={field.label}
        className="flex max-w-[10rem] shrink-0 items-center truncate px-2.5 font-medium text-ink"
      >
        {field.label}
      </span>

      <OperatorMenu
        field={field}
        operator={filter.operator}
        onChange={(operator) => onChange(retarget(filter, operator))}
        className="flex shrink-0 items-center border-x border-hairline bg-soft px-2 font-mono text-[0.9375rem] text-body transition-colors hover:text-ink"
      >
        {operatorSymbol(filter.operator)}
      </OperatorMenu>

      {arity(filter.operator) !== "none" && children}

      <button
        type="button"
        aria-label={`Remove the ${field.label} filter`}
        onClick={onRemove}
        className="flex shrink-0 items-center border-l border-hairline px-2 text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </span>
  )
}

/* -------------------------------------------------------------------------- */

/// What an option row says: a box or a dot, whatever the field sets beside it,
/// the label, and its count.
///
/// Separated from the button below because the omnibox does not own its rows —
/// the combobox does, and it is the combobox's own element that carries
/// `data-highlighted`. Putting the row's classes on anything inside that
/// element makes the keyboard highlight invisible, which is the difference
/// between a list you can drive and a list you have to click.
export function OptionRowContent({
  option,
  field,
  checked,
  single,
}: {
  option: FilterOption
  field: FilterField
  checked: boolean
  /// A single-value operator draws a radio rather than a checkbox — the shape
  /// is the promise that picking a second one replaces the first.
  single: boolean
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors",
            single && "rounded-full",
            checked
              ? "border-accent bg-accent text-on-dark"
              : "border-hairline-strong"
          )}
        >
          {checked && <Check className="size-2.5" />}
        </span>
        {field.spec.leading?.(option.value)}
        <span className="truncate">{option.label}</span>
      </span>
      <span className="shrink-0 pl-2 text-mute tabular-nums">
        {count(option.rows)}
      </span>
    </>
  )
}

/// The same row as a button, for the bar that owns its own rows.
export function OptionRow({
  option,
  field,
  checked,
  single,
  onToggle,
  className,
}: {
  option: FilterOption
  field: FilterField
  checked: boolean
  single: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(ITEM, "justify-between hover:bg-soft-2", className)}
    >
      <OptionRowContent
        option={option}
        field={field}
        checked={checked}
        single={single}
      />
    </button>
  )
}
