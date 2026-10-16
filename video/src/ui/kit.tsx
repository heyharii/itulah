/* The hub's controls, drawn for the film.

   Each one is the hub component's look, lifted from its classes
   (frontend-hub/src/components/ui/*), with the behaviour taken out: a film
   frame is a picture of a state, so every control here takes the state it is
   in — typed text, pressed, focused — as a prop, and the scene decides it from
   the frame number. */
import type { CSSProperties, ReactNode } from "react"
import { Check, ChevronDown, X } from "lucide-react"

export const cn = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ")

/* ── Button ─────────────────────────────────────────────────────────── */

type Variant = "primary" | "ghost" | "soft" | "tint" | "quiet" | "danger"

const VARIANT: Record<Variant, string> = {
  primary: "bg-cta text-cta-fg [&_svg]:text-cta-fg",
  ghost:
    "border border-hairline-2 bg-canvas text-text shadow-soft [&_svg]:text-line-ico",
  soft: "bg-soft-2 text-text [&_svg]:text-line-ico",
  tint: "bg-accent-bg font-semibold text-accent [&_svg]:text-accent",
  quiet: "text-body [&_svg]:text-line-ico",
  danger: "bg-bad-bg text-bad-fg",
}

export function Button({
  variant = "ghost",
  size = "default",
  pressed = 1,
  hover = false,
  disabled = false,
  children,
  className,
  style,
}: {
  variant?: Variant
  size?: "default" | "sm"
  /** The press scale this frame, from `press()`. */
  pressed?: number
  /** The pointer is over it: the hub's hover fill. */
  hover?: boolean
  disabled?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const hoverFill =
    hover && !disabled
      ? variant === "primary"
        ? "bg-cta-hover"
        : variant === "ghost" || variant === "soft"
          ? "bg-soft-2 text-ink"
          : ""
      : ""
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-inner font-medium whitespace-nowrap [&_svg]:shrink-0",
        size === "default"
          ? "h-control px-2.5 text-control [&_svg]:size-4"
          : "h-[1.75rem] px-2 text-meta [&_svg]:size-3.5",
        VARIANT[variant],
        hoverFill,
        disabled && "opacity-50",
        className
      )}
      style={{ scale: String(pressed), ...style }}
    >
      {children}
    </span>
  )
}

/* ── Fields ─────────────────────────────────────────────────────────── */

export function Label({
  children,
  required,
}: {
  children: ReactNode
  required?: boolean
}) {
  return (
    <div className="mb-2 text-[0.9375rem] leading-5 font-medium text-ink">
      {children}
      {required && <span className="ml-0.5 text-bad">*</span>}
    </div>
  )
}

/** A text box: 44px, the hub's form field. `caret` draws the typing caret. */
export function Input({
  value,
  placeholder,
  focused,
  caret,
  prefix,
  suffix,
  align = "left",
  className,
  mono,
}: {
  value?: string
  placeholder?: string
  focused?: boolean
  caret?: boolean
  prefix?: string
  suffix?: ReactNode
  align?: "left" | "right" | "center"
  className?: string
  mono?: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-11 items-center gap-2 rounded-inner border bg-canvas px-3 text-[0.9375rem]",
        focused
          ? "border-accent shadow-[0_0_0_3px_rgb(37_99_235/12%)]"
          : "border-hairline-2",
        className
      )}
    >
      {prefix && <span className="text-mute">{prefix}</span>}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
          mono && "font-mono"
        )}
      >
        {value ? (
          <span className="truncate text-ink tabular-nums">{value}</span>
        ) : (
          !caret && <span className="text-faint">{placeholder}</span>
        )}
        {caret && <span className="ml-px inline-block h-5 w-[1.5px] bg-ink" />}
      </span>
      {suffix && <span className="shrink-0 text-mute">{suffix}</span>}
    </div>
  )
}

export function Select({
  value,
  placeholder,
  focused,
  className,
}: {
  value?: string
  placeholder?: string
  focused?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-11 items-center justify-between gap-2 rounded-inner border bg-canvas px-3 text-[0.9375rem]",
        focused
          ? "border-accent shadow-[0_0_0_3px_rgb(37_99_235/12%)]"
          : "border-hairline-2",
        className
      )}
    >
      <span className={value ? "truncate text-ink" : "text-faint"}>
        {value ?? placeholder}
      </span>
      <ChevronDown className="size-4 text-line-ico" />
    </div>
  )
}

/* ── Words, tags, chips ─────────────────────────────────────────────── */

export type Tone = "ok" | "info" | "warn" | "bad" | "done" | "neutral"

const WORD: Record<Tone, string> = {
  ok: "text-ok-fg",
  info: "text-info-fg",
  warn: "text-warn-fg",
  bad: "text-bad-fg",
  done: "text-text",
  neutral: "text-mute",
}

/** A PO's status in a list: the coloured word (`PO_STATUS`, shared.ts:196). */
export function StatusWord({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("text-[0.9375rem]", WORD[tone])}>{children}</span>
}

/** The amber mono tag beside a return's supplier ("Over Delivery"). */
export function Tag({
  children,
  tone = "warn",
}: {
  children: ReactNode
  tone?: "warn" | "bad"
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-[6px] px-2 font-mono text-[0.875rem]",
        tone === "warn" ? "bg-warn-bg text-warn-fg" : "bg-bad-bg text-bad-fg"
      )}
    >
      {children}
    </span>
  )
}

/** The Difference chip of the Review Count (count-review.tsx:884-897). */
export function Diff({ value, style }: { value: number; style?: CSSProperties }) {
  if (value === 0)
    return (
      <span
        className="inline-flex items-center gap-1.5 py-1 text-[0.9375rem] font-medium text-ok-fg"
        style={style}
      >
        <Check className="size-4" /> Matches
      </span>
    )
  return (
    <span
      className="inline-flex items-center rounded-inner bg-bad-bg px-2.5 py-1 text-[0.9375rem] font-medium text-bad-fg tabular-nums"
      style={style}
    >
      {value > 0 ? `+${value} pcs` : `−${-value} pcs`}
    </span>
  )
}

/* ── The rubber stamp (purchase-orders.tsx:386) ─────────────────────── */

export function Stamp({
  children,
  date,
  tone,
  style,
}: {
  children: ReactNode
  date: string
  tone: "done" | "bad" | "neutral"
  style?: CSSProperties
}) {
  const color =
    tone === "bad" ? "text-bad-fg" : tone === "neutral" ? "text-mute" : "text-ink"
  return (
    <span
      className={cn(
        "pointer-events-none inline-block rounded-[6px] border-[3px] border-double border-current px-2.5 py-0.5 text-center text-[0.875rem] leading-5 font-bold tracking-[0.06em] whitespace-nowrap uppercase opacity-85 mix-blend-multiply",
        color
      )}
      style={style}
    >
      {children}
      <span className="block text-[0.75rem] leading-4 font-semibold tracking-[0.04em]">
        {date}
      </span>
    </span>
  )
}

/* ── Panels ─────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline bg-canvas shadow-soft",
        className
      )}
      style={style}
    >
      {children}
    </div>
  )
}

/** The floating sheet: inset 20 from the window's edges, 16 corners
    (sheet.tsx:505). `x` slides it in from the right edge. */
export function Sheet({
  width,
  mono,
  title,
  side,
  actions,
  footer,
  children,
  x = 0,
  opacity = 1,
}: {
  width: number
  mono?: string
  title: ReactNode
  side?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
  x?: number
  opacity?: number
}) {
  return (
    <div
      className="absolute top-5 right-5 bottom-5 flex flex-col overflow-hidden rounded-shell border border-hairline bg-canvas shadow-float"
      style={{ width, translate: `${x}px 0px`, opacity }}
    >
      <div className="flex shrink-0 items-center gap-x-4 border-b border-hairline px-7 py-3">
        <div className="min-w-0 flex-1">
          {mono && (
            <div className="mb-0.5 truncate font-mono text-id text-body">{mono}</div>
          )}
          <div className="flex items-center gap-2.5">
            <div className="text-[1.125rem] leading-6 font-semibold tracking-[-0.01em] text-ink">
              {title}
            </div>
            {side}
          </div>
        </div>
        {actions}
        <span className="grid size-8 place-items-center rounded-inner text-line-ico">
          <X className="size-4" />
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {footer && (
        <div className="shrink-0 border-t border-hairline px-7 py-3.5">{footer}</div>
      )}
    </div>
  )
}

/** The white veil behind a sheet: nothing in this system darkens. */
export function Veil({ opacity }: { opacity: number }) {
  return (
    <div
      className="absolute inset-0"
      style={{ background: "var(--scrim)", opacity }}
    />
  )
}

/** The confirm dialog (dialog.tsx:160): 384 wide, centred. */
export function Dialog({
  title,
  children,
  footer,
  style,
}: {
  title: ReactNode
  children: ReactNode
  footer: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      className="absolute top-1/2 left-1/2 w-[26rem] rounded-card border border-hairline-2 bg-canvas p-5 shadow-float"
      style={{ translate: "-50% -50%", ...style }}
    >
      <div className="text-card-title font-semibold text-ink">{title}</div>
      <div className="mt-2 text-[0.875rem] leading-relaxed text-body">{children}</div>
      <div className="mt-5 flex justify-end gap-2">{footer}</div>
    </div>
  )
}

/** A receipt toast, bottom right of the window. */
export function Toast({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      className="absolute right-6 bottom-6 flex items-center gap-2.5 rounded-card border border-hairline bg-canvas px-4 py-3 text-[0.9375rem] text-ink shadow-pop"
      style={style}
    >
      <span className="grid size-5 place-items-center rounded-full bg-ok text-white">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      {children}
    </div>
  )
}

/* ── The pointer ────────────────────────────────────────────────────── */

/** A macOS arrow, drawn at the hotspot (x, y) in window pixels. */
export function Pointer({
  x,
  y,
  down = 0,
  opacity = 1,
}: {
  x: number
  y: number
  /** 0..1, how far into a click: the arrow dips and a ring opens. */
  down?: number
  opacity?: number
}) {
  const ring = down > 0 && down < 1
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: x, top: y, opacity, zIndex: 50 }}
    >
      {ring && (
        <span
          className="absolute rounded-full border-2 border-accent"
          style={{
            width: 34,
            height: 34,
            left: -17,
            top: -17,
            opacity: 0.5 * (1 - down),
            scale: String(0.4 + down * 0.9),
          }}
        />
      )}
      <svg
        width="22"
        height="30"
        viewBox="0 0 22 30"
        style={{
          scale: String(1 - Math.sin(Math.PI * down) * 0.12),
          transformOrigin: "0 0",
          filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 22%))",
        }}
      >
        <path
          d="M1.5 1.5 L1.5 23.5 L7 18.2 L10.6 27 L14.4 25.4 L10.9 16.8 L18.6 16.8 Z"
          fill="#111214"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

/* ── The mark ───────────────────────────────────────────────────────── */

/** The app icon (brand-mark.tsx): black tile, white C, the blue dot. */
export function BrandMark({
  size = 32,
  dot = true,
  style,
}: {
  size?: number
  /** False when the dot is being carried in by something else. */
  dot?: boolean
  style?: CSSProperties
}) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} style={style}>
      <rect width="32" height="32" rx="7.5" fill="#111214" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7"
        fill="none"
        stroke="rgb(255 255 255 / 10%)"
      />
      <path
        d="M18.2 11.6A6.5 6.5 0 1 0 18.2 20.4"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      {dot && <circle cx="23.4" cy="16" r="2.2" fill="var(--accent)" />}
    </svg>
  )
}
