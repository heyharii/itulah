import { Select as BaseSelect } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/// A labelled input, and the one place a field's chrome is described.
///
/// Inputs are pills like everything else interactive, `{soft-2}` filled, and
/// they take the indigo focus ring the base layer authors — so a form does not
/// have to restate any of it.
///
/// **They are 44px, not the hub's 36.** Everything on this surface is pressed
/// with a thumb in a glove, so the touch floor is the default rather than
/// something every form has to remember. A smaller height passed by a caller
/// still wins — `twMerge` resolves it — which is how the two controls that sit
/// inside a dense row stay dense.
export function Field({
  label,
  hint,
  problem,
  children,
  className,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  /// The server's sentence, or a validator's. Never a code.
  problem?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[0.78125rem] font-medium text-text">{label}</span>
      {children}
      {problem ? (
        <span className="text-[0.71875rem] text-bad">{problem}</span>
      ) : hint ? (
        <span className="text-[0.71875rem] text-mute">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-tap w-full rounded-full border border-transparent bg-soft-2 px-4 text-[0.84375rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-2 hover:bg-soft-3",
        "disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/// Multi-line input. The one control that is not a pill — a rounded rectangle,
/// because a pill with three lines of text in it reads as a mistake.
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-inner border border-hairline-2 bg-canvas px-3.5 py-2.5 text-[0.84375rem] text-ink transition-colors outline-none",
        "placeholder:text-mute hover:border-hairline-strong",
        className
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
/// on a handheld in a warehouse aisle and on the desk beside it, and a list drawn by somebody else is a list this kit cannot make
/// legible in a glove.
///
/// Base UI draws the panel in the document instead. Rows are 44px like every other control in this file, the
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
  "z-50 min-w-[var(--anchor-width)] rounded-inner border border-hairline bg-canvas p-1 shadow-pop outline-none"

const ITEM =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-[calc(var(--r-inner)-0.25rem)] min-h-tap px-3.5 py-2 text-[0.84375rem] text-left text-ink outline-none select-none data-[highlighted]:bg-soft-2 data-disabled:cursor-default data-disabled:text-mute data-disabled:data-[highlighted]:bg-transparent"

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
          "flex h-tap w-full items-center rounded-full border border-transparent bg-soft-2 py-0 pr-4 pl-4 text-left text-[0.84375rem] text-ink transition-colors outline-none",
          "hover:border-hairline-2 hover:bg-soft-3",
          "data-disabled:opacity-50",
          className
        )}
      >
        <BaseSelect.Value className="min-w-0 flex-1 truncate" />
        <BaseSelect.Icon className="ml-2 shrink-0 text-line-ico">
          <ChevronDown className="size-4" />
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
                    <Check className="size-4" />
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
