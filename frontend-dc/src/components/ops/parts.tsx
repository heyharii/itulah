import { useState } from "react"

import { Pill } from "@/components/shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { clock } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { Session } from "@itulah/contract"

/// A titled block. Everything on these screens is one of these, so that a
/// handheld reads as a stack of tasks and a monitor as a grid of them without
/// either being a special case.
export function Panel({
  title,
  meta,
  className,
  children,
}: {
  title: React.ReactNode
  meta?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card size="sm" className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="truncate font-heading text-sm font-medium">{title}</h2>
        {meta !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
        )}
      </div>
      {children}
    </Card>
  )
}

/// One row in a list of things, tall enough to hit while holding a carton.
export function Row({
  onClick,
  selected,
  className,
  children,
}: {
  onClick?: () => void
  selected?: boolean
  className?: string
  children: React.ReactNode
}) {
  const shared = cn(
    "relative flex min-h-(--tap) w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0",
    // A bar down the left edge as well as a tint. The tint alone is a couple
    // of percent of lightness apart from the card, which is invisible on a
    // warehouse screen at arm's length in daylight.
    selected === true &&
      "bg-accent before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary",
    className
  )
  if (onClick === undefined) {
    return <div className={shared}>{children}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={selected === true}
      className={cn(shared, "transition-colors hover:bg-accent/60")}
    >
      {children}
    </button>
  )
}

/// The identifying half of a row: a code somebody reads out loud, and the
/// sentence under it that says what it is.
export function RowText({
  code,
  children,
}: {
  code: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-mono text-[13.5px] font-medium">
        {code}
      </span>
      {children !== undefined && (
        <span className="block truncate text-xs text-muted-foreground">
          {children}
        </span>
      )}
    </span>
  )
}

/// The number at the end of a row, with the word that says what it counts.
export function RowNumber({
  value,
  label,
  tone,
}: {
  value: React.ReactNode
  label?: string
  tone?: "muted" | "bad"
}) {
  return (
    <span className="shrink-0 text-right">
      <span
        className={cn(
          "block font-mono text-base leading-tight font-medium tabular-nums",
          tone === "muted" && "text-muted-foreground",
          tone === "bad" && "text-destructive"
        )}
      >
        {value}
      </span>
      {label !== undefined && (
        <span className="block text-[10.5px] text-muted-foreground">
          {label}
        </span>
      )}
    </span>
  )
}

/// A scan box. Enter submits, because a scanner types the code and presses it.
export function ScanField({
  placeholder,
  action,
  pending,
  onSubmit,
  children,
}: {
  placeholder: string
  action: string
  pending?: boolean
  onSubmit: (value: string) => void
  /// Anything that has to sit beside the box — a destination, a printer.
  children?: React.ReactNode
}) {
  const [value, setValue] = useState("")
  const submit = () => {
    const trimmed = value.trim()
    if (trimmed === "") {
      return
    }
    onSubmit(trimmed)
    // Cleared immediately so the next scan lands in an empty box. A scanner
    // fires faster than a person can select-all.
    setValue("")
  }
  return (
    <div className="flex flex-wrap gap-2 border-t px-4 py-3">
      {children}
      <Input
        value={value}
        placeholder={placeholder}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="h-(--tap) min-w-40 flex-1 font-mono"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            submit()
          }
        }}
      />
      <Button
        className="h-(--tap) px-5"
        disabled={pending === true}
        onClick={submit}
      >
        {pending === true ? "…" : action}
      </Button>
    </div>
  )
}

/// What went wrong, in the server's own words.
export function Problem({ error }: { error: unknown }) {
  if (error === null || error === undefined) {
    return null
  }
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error)
  return (
    <p role="alert" className="px-4 py-2.5 text-xs text-destructive">
      {message}
    </p>
  )
}

/// The round somebody is working in, if they have opened one.
///
/// A session is never required. Both `pick-sessions` and `packing-sessions`
/// exist to gather work into a round that can be reported on, and the writes
/// underneath them are accepted with or without one — so this offers to open
/// a round rather than standing in the way of the goods.
export function SessionBar({
  kind,
  sessions,
  activeId,
  onOpen,
  onClose,
  onSelect,
  pending,
  children,
}: {
  kind: string
  sessions: readonly Session[]
  activeId: string | null
  onOpen: () => void
  onClose: (sessionId: string) => void
  onSelect: (sessionId: string | null) => void
  pending: boolean
  /// Numbers belonging to the selected round.
  children?: React.ReactNode
}) {
  const open = sessions.filter((session) => session.closed_at === null)
  const active = open.find((session) => session.session_id === activeId) ?? null

  return (
    <Panel
      title={`${kind} session`}
      meta={
        active === null ? (
          "none open"
        ) : (
          <Pill tone="good">{active.status.toLowerCase()}</Pill>
        )
      }
    >
      {active === null ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-xs text-muted-foreground">
            Work is recorded either way. A round only adds a number to report it
            under.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-(--tap)"
              disabled={pending}
              onClick={onOpen}
            >
              Open {kind.toLowerCase()} session
            </Button>
            {open.map((session) => (
              <Button
                key={session.session_id}
                variant="outline"
                className="h-(--tap) font-mono text-xs"
                onClick={() => onSelect(session.session_id)}
              >
                Join {session.session_id.slice(0, 8)} · {session.actor_id}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px] font-medium">
                {active.session_id}
              </p>
              <p className="text-xs text-muted-foreground">
                {active.actor_id} · since {clock(active.started_at)}
              </p>
            </div>
            {children}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-(--tap)"
              disabled={pending}
              onClick={() => onClose(active.session_id)}
            >
              Close session
            </Button>
            <Button
              variant="ghost"
              className="h-(--tap)"
              onClick={() => onSelect(null)}
            >
              Work without it
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

/// A native picker, deliberately.
///
/// A styled listbox is nicer on a desktop and worse everywhere this surface
/// actually runs: the platform's own wheel is bigger, works with a glove, and
/// does not need the page to be scrolled to see the options.
export function NativeSelect({
  value,
  onChange,
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={cn(
        "h-(--tap) rounded-4xl border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

/// A button for something that cannot be taken back.
///
/// Sealing a carton, sending a truck, saying the tags are on the goods: each
/// is a fact about the physical world that the system will not let anybody
/// edit afterwards. The dialog exists to say *what* becomes final, not merely
/// to ask "are you sure" — a confirmation that carries no information is one
/// people learn to click through.
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  variant = "default",
  className,
  disabled,
  onConfirm,
}: {
  label: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel: string
  variant?: "default" | "secondary" | "outline" | "destructive"
  className?: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant={variant}
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={variant === "outline" ? "default" : variant}
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
