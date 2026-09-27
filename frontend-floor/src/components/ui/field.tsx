import { ChevronDown } from "lucide-react"
import * as React from "react"

import { PickerSheet } from "@/components/ui/picker-sheet"
import { cn } from "@/lib/utils"

/// A labelled input, and the one place a field's chrome is described.
///
/// Inputs are pills like everything else interactive, `{soft-2}` filled, and
/// they take the indigo focus ring the base layer authors — so a form does not
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
  const [open, setOpen] = React.useState(false)
  const chosen = items.find((one) => one.value === value)

  // This app is only ever held in a hand, so the list always comes up from
  // the bottom edge — the sheet the hub opens on a phone (`PickerSheet`) —
  // instead of a panel dropped over the field: rows a thumb can hit, a swipe
  // to put it away, and a search box once the list is long.
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          control,
          "flex items-center py-0 text-left",
          "disabled:opacity-45",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{chosen?.label}</span>
        <ChevronDown className="ml-2 size-5 shrink-0 text-line-ico" />
      </button>
      <PickerSheet
        open={open}
        onOpenChange={setOpen}
        title={label ?? "Pilih"}
        options={items.map((one) => ({ ...one, text: textOf(one.label) }))}
        selected={[value]}
        onPick={onChange}
      />
    </>
  )
}

/// An option's words, for the sheet's search box: `<option>{pool.label} ·
/// {count}</option>` arrives as an array of nodes, and matching the query
/// against the option's value would search shelf ids instead of shelf names.
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement(node))
    return textOf((node.props as { children?: React.ReactNode }).children)
  return ""
}
