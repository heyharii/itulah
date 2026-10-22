import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { Box, Check, Delete } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { PhoneDrawer } from "@/components/ui/phone-drawer"
import { Thumbnail } from "@/components/ui/thumbnail"
import { TintButton } from "@/components/ui/tint-button"
import { useLayout } from "@/lib/layout"
import { count, quantity } from "@/lib/format"
import { cn } from "@/lib/utils"

/// The Pack sheet's parts, drawn from pack-sheet-options.html (owner, 18 Oct
/// 2026, H · Ask only if 2 open): the koli tiles, the one row every list in the
/// sheet is made of, the questions asked over the sheet (which koli, how many,
/// what goes back to Pick), the keypad, and the layer that rises over the sheet.

/// A SKU as the rows show it.
export interface SkuInfo {
  /// "Article · colour · size".
  readonly title: string
  /// The SKU code without its leading zeros.
  readonly code: string
  readonly url: string | null
  readonly name: string
  readonly division: string | null
  readonly colours: readonly string[]
}

// ── The dialog shell ────────────────────────────────────────────────────────

/// A question asked over the sheet: a centred card, a drawer on a phone. No ×:
/// what it asks is answered with its own buttons, or by a press outside.
function Modal({
  open,
  onOpenChange,
  title,
  sub,
  footer,
  width = "put",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  sub?: React.ReactNode
  footer?: React.ReactNode
  /// `put` is 480 wide, `back` 440.
  width?: "put" | "back"
  children?: React.ReactNode
}) {
  const phone = useLayout() === "phone"
  const Title: React.ElementType = phone ? Drawer.Title : BaseDialog.Title
  const body = (
    <>
      <div className="min-w-0">
        <Title className="text-[1.1875rem] leading-[1.4] font-semibold text-ink">
          {title}
        </Title>
        {sub && (
          <div className="mt-0.5 text-[0.9375rem] leading-[1.4] text-mute tabular-nums">
            {sub}
          </div>
        )}
      </div>
      {children}
      {footer !== undefined && (
        <div className="mt-4 flex items-center justify-end gap-4 max-md:[&>*]:h-11 max-md:[&>*:last-child]:flex-1">
          {footer}
        </div>
      )}
    </>
  )
  if (phone)
    return (
      <PhoneDrawer open={open} onOpenChange={onOpenChange}>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {body}
        </div>
      </PhoneDrawer>
    )
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-sheet border border-hairline-2 bg-canvas p-5 shadow-float transition-[opacity,scale] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100",
            width === "put" ? "w-[30rem]" : "w-[27.5rem]"
          )}
        >
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

/// "Into Koli 2": where the pieces are going, as a pill and not a button. A
/// `div`: the White look draws a `span` capsule as an outline.
export function KoliChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-bg px-3 text-[0.9375rem] font-semibold whitespace-nowrap text-accent [&_svg]:size-4">
      <Box />
      {children}
    </div>
  )
}

const LABEL = "mt-[18px] mb-2 text-[0.9375rem] text-mute"

// ── Which koli, then how many ───────────────────────────────────────────────

/// One dialog, two steps (owner, 18 Oct 2026): **which koli** — tiles like the
/// shelf's, a tap chooses — then **how many**: the chip, a box prefilled with
/// all of it, and one button that says what it will do. Step 1 has Cancel;
/// step 2 has Back, which returns to step 1 (or closes, when step 1 was not
/// asked). The frame stays and the contents slide. A touch screen takes step 2
/// as the keypad (`QuantityPad`).
export function PutDialog({
  title,
  sub,
  step,
  koli,
  newNo,
  onChoose,
  onCancel,
  chip,
  max,
  label,
  tone = "primary",
  onBack,
  onConfirm,
}: {
  title: string
  /// "code · N pcs" (a row) or "N pcs" (everything).
  sub: string
  step: 1 | 2
  /// Step 1: the open koli — the number it shows, its `no`, its pieces.
  koli?: readonly {
    readonly shown: number
    readonly no: number
    readonly pieces: number
  }[]
  newNo?: number
  onChoose?: (no: number | "new") => void
  onCancel?: () => void
  /// Step 2: where it is going, how many there are, what the button says.
  chip?: React.ReactNode
  max?: number
  label?: (n: number) => string
  tone?: "primary" | "bad"
  onBack?: () => void
  onConfirm?: (n: number) => void
}) {
  const [text, setText] = useState(String(max ?? 0))
  const n = Number(text) || 0
  const limit = max ?? 0
  const over = n > limit
  const can = n > 0 && !over
  // The contents slide when the step changes, not when the dialog opens.
  const content = useRef<HTMLDivElement>(null)
  const was = useRef(step)
  useEffect(() => {
    if (was.current === step) return
    const forward = step === 2
    was.current = step
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    content.current?.animate(
      [
        {
          opacity: 0,
          transform: `translateX(${forward ? 10 : -10}px)`,
        },
        { opacity: 1, transform: "none" },
      ],
      { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
    )
  }, [step])
  // Back to step 1 and forward again starts from all of it again.
  const [fresh, setFresh] = useState(step)
  if (fresh !== step) {
    setFresh(step)
    setText(String(limit))
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (next) return
        if (step === 1) onCancel?.()
        else onBack?.()
      }}
      title={title}
      sub={sub}
      footer={
        step === 1 ? (
          <TintButton onClick={onCancel}>Cancel</TintButton>
        ) : (
          <>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button
              variant={tone === "bad" ? "destructive" : "primary"}
              className="min-w-[11.25rem] px-5"
              disabled={!can}
              onClick={() => onConfirm?.(n)}
            >
              {label?.(n)}
            </Button>
          </>
        )
      }
    >
      <div ref={content}>
        {step === 1 ? (
          <>
            <div className={LABEL}>Koli</div>
            <div className="grid grid-cols-3 gap-2.5">
              {koli?.map((one) => (
                <button
                  key={one.no}
                  type="button"
                  onClick={() => onChoose?.(one.no)}
                  className="flex min-h-[4.75rem] flex-col items-start gap-0.5 rounded-[14px] border-[1.5px] border-hairline bg-canvas px-3 py-2.5 text-left transition-[border-color,scale] duration-150 ease-out active:scale-[0.97] [&_svg]:mb-1 [&_svg]:size-[1.375rem] [&_svg]:text-mute [@media(hover:hover)]:hover:border-accent [@media(hover:hover)]:hover:[&_svg]:text-accent"
                >
                  <Box />
                  <b className="text-[0.9375rem] font-semibold text-ink">
                    Koli {one.shown}
                  </b>
                  <span className="text-[0.9375rem] text-mute tabular-nums">
                    {quantity(one.pieces)}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onChoose?.("new")}
                className="flex min-h-[4.75rem] items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-hairline bg-canvas px-3 py-2.5 text-[0.9375rem] font-semibold text-accent transition-[scale] duration-150 ease-out active:scale-[0.97]"
              >
                + Koli {newNo}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4">{chip}</div>
            <div className={LABEL}>Quantity</div>
            <div className="flex items-center gap-3">
              <Input
                autoFocus
                inputMode="numeric"
                aria-label="Quantity"
                value={text}
                onChange={(event) =>
                  setText(event.target.value.replace(/\D/g, ""))
                }
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  if (can) onConfirm?.(n)
                }}
                className="h-12 w-24 rounded-card px-2.5 text-center text-[1.1875rem] font-semibold tabular-nums pointer-coarse:h-12"
              />
              <span
                className={cn(
                  "text-[0.9375rem] tabular-nums",
                  over ? "text-bad-fg" : "text-mute"
                )}
              >
                {over ? `Only ${count(limit)} here` : `max ${count(limit)}`}
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── The keypad ──────────────────────────────────────────────────────────────

/// How many, on a touch screen: the figure large, ten keys and All, one button
/// that names what it does. It starts at the full amount and the first key
/// replaces it; a figure never goes over the most there is. On a tablet it is a
/// card over the sheet, on a phone a drawer. A press outside puts it away and
/// the put with it.
export function QuantityPad({
  title,
  chip,
  max,
  label,
  tone = "primary",
  onClose,
  onConfirm,
}: {
  title: string
  chip: React.ReactNode
  max: number
  label: (n: number) => string
  tone?: "primary" | "bad"
  onClose: () => void
  onConfirm: (n: number) => void
}) {
  const phone = useLayout() === "phone"
  const [text, setText] = useState(String(max))
  const [fresh, setFresh] = useState(true)
  const n = Number(text) || 0
  const can = n > 0 && n <= max
  const press = (key: string) => {
    const base = fresh ? "" : text
    setFresh(false)
    if (base.length < 4) setText(String(Math.min(max, Number(base + key))))
  }
  const erase = () => {
    setText(fresh ? "" : text.slice(0, -1))
    setFresh(false)
  }
  const all = () => {
    setText(String(max))
    setFresh(false)
  }
  const Title: React.ElementType = phone ? Drawer.Title : BaseDialog.Title
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <Title className="min-w-0 text-[0.9375rem] leading-[1.4] font-semibold text-ink">
          {title}
        </Title>
        <div className="shrink-0 self-center">{chip}</div>
      </div>
      <output
        aria-live="polite"
        className="block pt-2.5 pb-0.5 text-center text-[2.5rem] leading-[1.4] font-bold tabular-nums"
      >
        {text === "" ? "0" : text}
      </output>
      <div className="mb-3 text-center text-[0.9375rem] text-mute tabular-nums">
        of {count(max)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
          <PadKey key={key} onPress={() => press(key)}>
            {key}
          </PadKey>
        ))}
        <PadKey onPress={all}>All</PadKey>
        <PadKey onPress={() => press("0")}>0</PadKey>
        <PadKey onPress={erase} label="Delete">
          <Delete className="size-5" />
        </PadKey>
      </div>
      <Button
        variant={tone === "bad" ? "destructive" : "primary"}
        className="mt-3 h-12 w-full"
        disabled={!can}
        onClick={() => onConfirm(n)}
      >
        {label(n)}
      </Button>
    </>
  )
  if (phone)
    return (
      <PhoneDrawer
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <div className="flex flex-col px-[18px] pt-3 pb-6">{body}</div>
      </PhoneDrawer>
    )
  return (
    <BaseDialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          forceRender
          className="fixed inset-0 z-50 bg-[var(--scrim)] backdrop-blur-[2px] transition-opacity duration-(--t-panel) ease-(--ease-out) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
        />
        <BaseDialog.Popup className="fixed bottom-[3.75rem] left-1/2 z-50 flex w-[23.75rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-sheet border border-hairline-2 bg-canvas p-[18px] shadow-float transition-[opacity,translate] duration-(--t-panel) ease-(--ease-out) data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0">
          {body}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

function PadKey({
  onPress,
  label,
  children,
}: {
  onPress: () => void
  label?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className="grid h-[3.25rem] place-items-center rounded-[12px] bg-soft-2 text-[1.25rem] font-medium text-ink tabular-nums transition-[background-color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.95] active:bg-hairline"
    >
      {children}
    </button>
  )
}

// ── Back to Pick ────────────────────────────────────────────────────────────

/// Picked pieces that go back to Pick (damaged, wrong): a stepper per SKU, and
/// one red button that moves them at once. The figure is a box that reads like
/// the proto's number, and can also be typed.
export function BackDialog({
  rows,
  info,
  pending,
  onPhoto,
  onClose,
  onConfirm,
}: {
  rows: readonly (readonly [string, number])[]
  info: (sku: string) => SkuInfo
  pending: boolean
  onPhoto: (sku: string) => void
  onClose: () => void
  onConfirm: (lines: { sku_code: string; quantity: number }[]) => void
}) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const total = Object.values(qty).reduce((a, b) => a + b, 0)
  const set = (sku: string, max: number, next: number) =>
    setQty((was) => ({ ...was, [sku]: Math.max(0, Math.min(max, next)) }))
  return (
    <Modal
      open
      width="back"
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
      title="Back to Picklist"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Keep
          </Button>
          <Button
            variant="destructive"
            className="px-[1.125rem]"
            disabled={total === 0}
            pending={pending}
            onClick={() =>
              onConfirm(
                Object.entries(qty)
                  .filter(([, n]) => n > 0)
                  .map(([sku_code, quantity]) => ({ sku_code, quantity }))
              )
            }
          >
            {total > 0 ? `Back to Picklist ${quantity(total)}` : "Back to Picklist"}
          </Button>
        </>
      }
    >
      <div className="mt-5 flex max-h-[50dvh] flex-col overflow-y-auto">
        {rows.map(([sku, max]) => {
          const n = qty[sku] ?? 0
          return (
            <SkuRow key={sku} info={info(sku)} onPhoto={() => onPhoto(sku)}>
              <div className="flex items-center gap-1.5">
                <StepKey
                  label="One less"
                  disabled={n <= 0}
                  onPress={() => set(sku, max, n - 1)}
                >
                  −
                </StepKey>
                <Input
                  aria-label="How many"
                  inputMode="numeric"
                  padLabel={info(sku).title}
                  value={String(n)}
                  onChange={(event) =>
                    set(
                      sku,
                      max,
                      Number(event.target.value.replace(/\D/g, "")) || 0
                    )
                  }
                  onFocus={(event) => event.target.select()}
                  className="h-[2.375rem] w-[3.125rem] px-0 text-center tabular-nums"
                />
                <StepKey
                  label="One more"
                  disabled={n >= max}
                  onPress={() => set(sku, max, n + 1)}
                >
                  +
                </StepKey>
              </div>
            </SkuRow>
          )
        })}
      </div>
    </Modal>
  )
}

function StepKey({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string
  disabled: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className="grid size-[2.375rem] place-items-center rounded-inner border border-hairline text-[1.1875rem] text-ink transition-[scale,color] duration-(--t-press) ease-(--ease-out) active:scale-[0.94] disabled:pointer-events-none disabled:text-faint"
    >
      {children}
    </button>
  )
}

// ── The row ─────────────────────────────────────────────────────────────────

/// One SKU: its picture (a press makes it large), "article · colour · size"
/// over the code, then either the quantity as a plain number with one tinted
/// button, or whatever the caller puts there. The row itself is not pressable.
/// The line between rows is on every row, the first too.
export function SkuRow({
  info,
  qty,
  action,
  onPhoto,
  children,
  end,
}: {
  info: SkuInfo
  qty?: number
  action?: {
    label: string
    icon?: React.ReactNode
    tone?: "accent" | "bad" | "solid" | "solid-bad"
    onClick: () => void
  }
  onPhoto: () => void
  children?: React.ReactNode
  /// Drawn last, at the right end, in place of an action.
  end?: React.ReactNode
}) {
  return (
    <div
      data-put={info.code}
      className="flex min-h-[3.75rem] items-center gap-3 border-t border-[var(--wt-row-line,var(--hairline))]"
    >
      <button
        type="button"
        aria-label={`Photo of ${info.name}`}
        onClick={onPhoto}
        className="shrink-0 rounded-inner transition-[scale,box-shadow] duration-150 active:scale-[0.95] [@media(hover:hover)]:hover:shadow-[0_0_0_1.5px_var(--accent)]"
      >
        <Thumbnail
          url={info.url}
          name={info.name}
          division={info.division}
          colours={info.colours}
          className="size-11 rounded-inner"
        />
      </button>
      <div className="min-w-0 flex-1 text-[0.9375rem] leading-[21px]">
        <div className="font-medium text-ink">{info.title}</div>
        <div className="text-mute tabular-nums">{info.code}</div>
      </div>
      {children}
      {qty !== undefined && (
        <span className="min-w-10 text-right text-[1.0625rem] font-semibold text-ink tabular-nums">
          {count(qty)}
        </span>
      )}
      {action &&
        (action.tone === "solid" || action.tone === "solid-bad" ? (
          // The row's act (Put in, Take out): a small solid button, blue to
          // go forward, red to take back out.
          <Button
            variant={action.tone === "solid" ? "primary" : "destructive"}
            size="sm"
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </Button>
        ) : (
          <TintButton
            size={action.tone === "bad" ? "md" : "row"}
            tone={action.tone}
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </TintButton>
        ))}
      {end}
    </div>
  )
}

// ── The tiles ───────────────────────────────────────────────────────────────

/// A koli that has been sealed: the box with its tick.
export function SealedBox() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"
        fill="currentColor"
        fillOpacity=".18"
        stroke="none"
      />
      <path d="M8 12.5l3 3 5.5-6" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

/// One big radio: Picked, or a koli. All look alike — a ring at the corner, an
/// icon, the name, the pieces; the one you are on is blue. With one koli open
/// and Picked in view, that koli is lightly ringed: the one a put will go into.
/// A sealed koli has the green sealed box.
export function KoliTile({
  id,
  on,
  target,
  sealed,
  dim,
  icon,
  label,
  pieces,
  onPick,
}: {
  id: string
  on: boolean
  target?: boolean
  sealed?: boolean
  dim?: boolean
  icon: React.ReactNode
  label: string
  pieces: number
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      data-tile={id}
      onClick={onPick}
      className={cn(
        "relative flex min-h-[5.375rem] flex-col items-start gap-0.5 rounded-[14px] border-[1.5px] p-3 text-left transition-[border-color,background-color,scale] duration-150 ease-out active:scale-[0.97] [&_svg]:mb-1 [&_svg]:size-[1.375rem]",
        on
          ? "border-accent bg-accent-bg"
          : target
            ? "border-accent/45 bg-canvas"
            : sealed
              ? "border-hairline bg-soft"
              : "border-hairline bg-canvas",
        sealed
          ? "[&_svg]:text-ok-fg"
          : on || target
            ? "[&_svg]:text-accent"
            : "[&_svg]:text-mute"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-3 right-3 size-5 rounded-full border-solid transition-[border-width,border-color] duration-150",
          on
            ? "border-[6px] border-accent"
            : "border-[1.6px] border-hairline-strong"
        )}
      />
      {icon}
      <b
        className={cn(
          "text-[0.9375rem] leading-[21px] font-semibold text-ink",
          dim && "opacity-50"
        )}
      >
        {label}
      </b>
      <span
        className={cn(
          "text-[0.9375rem] leading-[21px] text-mute tabular-nums",
          dim && "opacity-50"
        )}
      >
        {quantity(pieces)}
      </span>
    </button>
  )
}

/// "+ Koli 3": the dashed tile that opens the next one.
export function AddTile({ no, onPick }: { no: number; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex min-h-[5.375rem] items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-hairline bg-canvas p-3 text-[0.9375rem] font-semibold text-accent transition-[scale] duration-150 ease-out active:scale-[0.97]"
    >
      + Koli {no}
    </button>
  )
}

/// "✓ Sealed · A00002": the green tag on a koli that has its code. A `div`, not
/// a `Tag` — it is not a mono code label — and not an outlined capsule.
export function SealTag({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex h-8 items-center gap-1.5 rounded-inner bg-ok-bg/50 pr-3 pl-2 text-[0.9375rem] font-semibold whitespace-nowrap text-ok-fg tabular-nums">
      <Check className="size-[1.125rem]" strokeWidth={2.4} />
      {children}
    </div>
  )
}

/// Nothing left, and every koli is sealed.
export function Everything({ koli, pieces }: { koli: number; pieces: number }) {
  return (
    <div className="grid place-items-center pt-[4.375rem] pb-10 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-full bg-ok-bg/50 text-ok-fg">
        <Check className="size-[1.125rem]" strokeWidth={2.4} />
      </div>
      <b className="text-[1.1875rem] leading-[1.4] font-semibold text-ink">
        Everything packed
      </b>
      <span className="text-[0.9375rem] text-mute tabular-nums">
        {count(koli)} koli · {quantity(pieces)}
      </span>
    </div>
  )
}
