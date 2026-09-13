import { Select as BaseSelect } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/// A labelled input, and the one place a field's chrome is described.
///
/// Inputs are pills like everything else interactive, `{soft-2}` filled, and
/// they take the accent focus ring the base layer authors — so a form does not
/// have to restate any of it. Every control here is 48px: a field on a counter
/// is aimed at with a thumb while somebody is talking to you.
export function Field({
  label,
  hint,
  problem,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  /// The node's sentence, or a validator's. Never a code.
  problem?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-meta font-medium text-text">{label}</span>
      {children}
      {problem !== undefined && problem !== null ? (
        <span className="text-meta text-bad">{problem}</span>
      ) : hint !== undefined ? (
        <span className="text-meta text-mute">{hint}</span>
      ) : null}
    </label>
  )
}

const control =
  "h-12 w-full rounded-inner border border-transparent bg-soft-2 px-4 text-[1rem] text-ink transition-colors outline-none placeholder:text-mute disabled:opacity-45"

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        control,
        // A `{bad}` hairline and a soft same-hue ring — the tint grammar of a
        // status pill, not a glow. The submit button is never turned red; the
        // field already said it.
        invalid === true && "border-bad ring-[3px] ring-bad-bg",
        className,
      )}
      {...props}
    />
  )
}

/// A choice from a fixed list.
///
/// Written as `<option>` children — the HTML everybody already knows — and NOT
/// drawn by a native `<select>`.
///
/// A native dropdown hands its panel to the operating system. The panel is not
/// in the page, so `appearance: none` restyles the closed control and nothing
/// else, and the same form is a rounded sheet on one machine and a square grey
/// list on the next. What that cost here is not vanity: this surface is read
/// across a counter while somebody is waiting, and a list drawn by somebody else is a list this kit cannot make
/// hittable with a thumb.
///
/// Base UI draws the panel in the document instead. Rows are 48px, the same as the fields they belong to, the
/// aligned-over-the-trigger positioning a Mac does is kept for a mouse and
/// dropped automatically when the control is opened by touch, and the panel
/// looks the same on every machine this runs on.
///
/// What is given up is the platform's own wheel picker on a phone. That was
/// the reason this was native, and it stops being a reason the moment the
/// surface runs on a Windows tablet, where the "native" panel is a small grey
/// list drawn for a mouse.

/// The panel and its rows. Local to this kit rather than shared: the row
/// height is the touch decision this file exists to make.
const PANEL =
  "z-50 min-w-[var(--anchor-width)] rounded-inner border border-hairline-2 bg-canvas p-1 shadow-pop outline-none"

const ITEM =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[calc(var(--r-inner)-0.25rem)] min-h-12 px-4 py-2.5 text-[1rem] text-left text-ink outline-none select-none data-[highlighted]:bg-soft-2 data-disabled:cursor-default data-disabled:text-mute data-disabled:data-[highlighted]:bg-transparent"

interface Choice {
  readonly value: string
  readonly label: React.ReactNode
  readonly disabled: boolean
}

/// Read the `<option>` children as data — through fragments and arrays,
/// because most call sites build the list with a `.map()`.
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
  "aria-label": label,
}: {
  value: string
  /// The value itself, not an event: there is no DOM select here to read one
  /// off.
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  "aria-label"?: string
}) {
  const items = choices(children)

  return (
    <BaseSelect.Root
      items={items}
      value={value}
      onValueChange={(next) => onChange(String(next ?? ""))}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          control,
          "flex items-center py-0 text-left",
          "hover:border-hairline-2 hover:bg-soft-3",
          "data-disabled:opacity-45",
          className,
        )}
      >
        <BaseSelect.Value className="min-w-0 flex-1 truncate" />
        <BaseSelect.Icon className="ml-2 shrink-0 text-line-ico">
          <ChevronDown className="size-5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50">
          <BaseSelect.Popup className={PANEL}>
            <BaseSelect.List className="max-h-[var(--available-height)] scroll-py-1 overflow-y-auto">
              {items.map((one) => (
                <BaseSelect.Item
                  key={one.value}
                  value={one.value}
                  disabled={one.disabled}
                  className={ITEM}
                >
                  <BaseSelect.ItemText className="truncate">
                    {one.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="shrink-0">
                    <Check className="size-5" />
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
