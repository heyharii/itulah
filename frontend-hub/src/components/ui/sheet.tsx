import { Dialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { Menu } from "@base-ui/react/menu"
import { useRouterState } from "@tanstack/react-router"
import { ChevronLeft, MoreHorizontal, X } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { useDirtyGuard } from "@/components/ui/dirty-guard"
import { RecordPanel } from "@/components/ui/record-panel"
import { ITEM, POPUP, POSITIONER } from "@/lib/filter-chrome"
import { useLayout, useRecordBeside } from "@/lib/layout"
import { screenForPath } from "@/lib/navigation"
import { useSheetSpace } from "@/lib/sheet-space"
import { useSheetLayer } from "@/lib/sheet-stack"
import { cn } from "@/lib/utils"
import { isWhiteLook } from "@/lib/look"

/// # The record sheet — ONE anatomy
///
/// Every record, form and task that opens over a list opens in this. Written
/// down (6 Oct 2026, after the audit in `ux-audit/REPORT.md` §2 found six head
/// grammars, five footers and seven heading styles across 269 sheets) so the
/// next sheet is copied from this comment and not from a neighbour.
///
/// ```
/// ┌──────────────────────────────────────────────────────┐
/// │ ‹ Back to {parent}                  (nested sheets)  │
/// │ PO-041026-006            id    mono 15 — the number   │
/// │ Indorama, PT  [Active]   title 18/600 · ONE badge  ⋯ ×│
/// │ Created by Rina Kusuma · 06 Oct 2026      caption     │
/// ├──────────────────────────────────────────────────────┤
/// │ Details · Orders · Catalogue · Activity   tabs        │
/// ├──────────────────────────────────────────────────────┤
/// │ Banner (the record's state, one sentence)             │
/// │ Facts   — two columns, label over value               │  body: gap-6,
/// │ Items   — SubHead 15/500 + MiniTable                  │  nobody sets
/// │ Totals · Timeline · Notes                             │  margins
/// ├──────────────────────────────────────────────────────┤
/// │ [danger]  ..................  [Cancel]  [Primary]     │  foot
/// └──────────────────────────────────────────────────────┘
/// ```
///
/// ## Head — fixed, never scrolls, never holds actions
///
/// - `id`: the business number a person says aloud (PO-041026-006, HO-0006),
///   mono. Left out when there is none. Never a UUID, a login, a kind label, a
///   period, a date span or the title again.
/// - `title`: the record's own name — a supplier, an employee, an order number
///   when it has no better name. Wraps to two lines before it truncates. Never
///   a verb or the screen's name ("Pack", "Picklist").
/// - `badge`: exactly ONE `Pill`, right of the title on a desk and under it on a
///   phone. No stamp, no status Fact, no second copy in the body.
/// - `caption`: one muted line — "Created by {full name} · 06 Oct 2026", or
///   kind · place. Provenance, never instructions.
/// - `more`: the overflow ⋯ for Print / Download / Duplicate and nothing else.
/// - `back`: a record opened from another says "‹ Back to {parent}".
///
/// ## `actions` (deprecated) — kept so nothing breaks
///
/// The head is not a home for actions; the foot is. A sheet that still passes
/// `actions` keeps them in the head on a desk (unchanged), and on a PHONE they
/// are lifted into the foot — a strip of 44px buttons above whatever `footer`
/// holds, wrapping onto a second line when there are many, one alone taking
/// the full width. Nothing wraps under the title any more. Icon-only actions
/// (Print, Download) keep their icon and become 44px squares in that strip; new
/// code puts those in `more` and the verbs in `footer`.
///
/// ## Size — chosen by what the sheet holds, never by a screen's own `w-[Nrem]`
///
/// | `size`      | width      | what it holds                                  |
/// |-------------|------------|-------------------------------------------------|
/// | `rail`      | ≈ 560px    | a record of ≤ 10 facts + short tables, or a form of ≤ 8 fields: settings editors, a term, a colour, a count, a store, a user |
/// | `wide`      | ≈ 900px    | a document with lines: PO, supplier, return, composer, tabbed hubs (contract, asset, repair) |
/// | `table`     | ≈ 1020px   | a grid read across: receiving count, pool, SKU matrix, allotment lines, attendance |
/// | `workspace` | ≈ 1340px   | a list and the work beside it: New articles, Import, a rule or campaign form |
///
/// Only a `rail` stands BESIDE the list on a monitor. The phone is always the
/// bottom drawer, full height, whatever the size. `width` is the old name for
/// the same prop and is kept; a sheet that declares neither keeps the old
/// 760px panel until its family is migrated (`unsized` = legacy).
///
/// ## Body
///
/// Pass `stack` and the body is `flex flex-col gap-6`: children are sections,
/// and nobody sets a margin. Without it the body is the plain block it always
/// was, for sheets that still space themselves.
///
/// 1. A `Banner` — only the record's own state (a blocker, the last save
///    error), one sentence.
/// 2. `Facts` — one component, two columns on a desk and a phone, label over
///    value, sentence-case labels, values WRAP (an email is never cut), ≤ 8
///    short values; a long one is `<Fact wide>`; free text is a section.
/// 3. `SheetSection` / `SubHead` — 15/500 heading, a count as its `aside`, then
///    a `MiniTable` (it stacks on a phone) or a list. Order: Items → Totals →
///    Timeline → Notes. No `Card` inside a sheet: the sheet is the card.
///
/// ## Sections, never tabs — the `tabs` prop
///
/// No tabs in a record or a form (owner, 14 Oct 2026). A record that has more
/// than one thing to say passes `tabs` and they are drawn as ONE scroll: the
/// first as the record's body, the rest each under its name, then the
/// record's Activity. A section that is a grid says so with its own `size`
/// and the sheet takes the widest. `tab` scrolls to a section.
///
/// ## Foot — the only home of actions; the same on every width
///
/// Pass `footer={<SheetFooter … />}` (`sheet-footer.tsx`): destructive on the
/// left (a `ConfirmButton`), a quiet Cancel and ONE primary on the right; read
/// mode is `[Print] ….. [Edit]`; a `FootNote` says why the primary is
/// disabled; a failed write is a banner above the foot. Buttons are 36px on a
/// desk and 44px on a phone. The foot is pinned above the keyboard and the
/// home bar. Edit in place for ≤ 8 fields and no lines (the foot swaps to
/// Cancel | Save changes); documents open a separate wide sheet from Edit.
///
/// ## States
///
/// Loading is `SheetLoading` ("Reading the supplier…", the head already shows
/// the id from the URL); empty is `SheetEmpty` (one quiet line + the action);
/// a failed read is `SheetError` with Try again (`sheet-states.tsx`;
/// `SheetQuery` does all three). `dirty` makes ×, Esc, a swipe down and a tap on
/// the veil ask "Discard your changes?" once (`dirty-guard.tsx`).
///
/// ## The detail rail — a floating panel, never a flush column
///
/// On the desk it sits inset 20px from the top, right and bottom with the
/// shell's corners and the float shadow, so it reads as a sheet lifted above the
/// list; it stands on the WHITE veil — the list behind washes toward
/// near-white and never darkens. On a page 1300px wide a `rail` stops covering
/// anything: the shell gives it a column and the list narrows into what is
/// left. Beside the list it is `modal={false}` with pointer-dismissal off: every
/// row stays clickable, clicking another swaps the record, and Escape still
/// shuts it. Under 48rem it is a bottom drawer (the Vaul sense): it rises from
/// the edge nearest the hand, stops 12px short of the top so the page it came
/// from still shows, carries a grip, and a pull down puts it away.
export type SheetSize = "rail" | "wide" | "table" | "workspace"

/// Why a sheet is being asked to close — for the one that answers differently
/// to Esc (an edit in place cancels the edit; × leaves the sheet).
export type SheetCloseReason = "escape" | "close" | "veil" | "swipe"

/// One section of a record, as the `tabs` prop takes it.
export interface SheetTab {
  readonly value: string
  readonly label: React.ReactNode
  readonly content: React.ReactNode
  /// The width THIS section needs, when it is not the sheet's own: a record
  /// that reads as a rail but whose SKUs tab is a grid says
  /// `{ value: "skus", size: "table", … }` and the sheet widens while that
  /// tab shows. Replaces a caller tracking the tab only to pick a `size`
  /// (and then forgetting to put it back when another record opens).
  readonly size?: SheetSize
}

/// An entry in the head's overflow ⋯ — Print, Download, Duplicate.
export interface SheetMoreItem {
  readonly label: React.ReactNode
  readonly onSelect: () => void
  readonly icon?: React.ReactNode
  readonly disabled?: boolean
}

/// The width of each size. `rail` is the anatomy's ≈ 480px; the other three are
/// what `width` always meant.
const SIZE: Readonly<Record<SheetSize, string>> = {
  // ≈ 560 from 1400 (owner, 2026-10-19: a 480 rail was cramped — fields
  // half a name wide, two-line labels on every icon tile).
  rail: "md:w-[clamp(30rem,40vw,35rem)]",
  // The record sheet of hub-ui-patterns (14 Oct): 960, 1040 from 1440, all
  // but 80px of a tablet.
  wide: "md:w-[calc(100vw-5rem)] xl:w-[min(60rem,calc(100vw-18.75rem))] min-[90rem]:w-[min(65rem,calc(100vw-22.5rem))]",
  table: "md:w-[clamp(27.5rem,92vw,64rem)]",
  workspace: "md:w-[clamp(27.5rem,96vw,84rem)]",
}

/// The sizes, narrowest first.
const RANK: Readonly<Record<SheetSize, number>> = {
  rail: 0,
  wide: 1,
  table: 2,
  workspace: 3,
}

/// What a sheet that declares no size gets: the panel it always was, 760px at
/// 1440. Kept until each family is migrated and says what it holds.
const UNSIZED = "md:w-[clamp(27.5rem,62vw,47.5rem)]"

export function Sheet({
  open,
  onOpenChange,
  title,
  id,
  context,
  swap = false,
  caption,
  badge,
  figures,
  back,
  closeAs = "x",
  print,
  more,
  actions,
  subject,
  footer,
  noFoot = false,
  media,
  tabs,
  tab: shown,
  size,
  width,
  stack = false,
  dirty = false,
  children,
  className,
}: {
  open: boolean
  /// Asked for on × / Esc / a swipe down / the veil (`reason` says which) and
  /// when it opens. With `dirty`, a close is asked about first.
  onOpenChange: (open: boolean, reason?: SheetCloseReason) => void
  /// The record's own name. Two lines on a phone before it truncates.
  title: React.ReactNode
  /// The business number, above the title, after where the record sits.
  id?: React.ReactNode
  /// Where the record sits, before its number — "Purchase Orders / PO-…"
  /// (hub-ui-patterns). Left out, it is the screen the sheet opened on; a
  /// press on it goes back there. `false` says nothing.
  context?: React.ReactNode | false
  /// A MODE, not a layer: this sheet takes the place of the one under it —
  /// Edit over a record — so it neither slides in nor dims anything: the
  /// frame stays and its contents change, fading out and in.
  swap?: boolean
  /// One quiet line under the title: provenance — who raised it, on what day.
  /// Its own slot rather than another `badge`, because a badge competes with
  /// the title for the width a long name needs.
  caption?: React.ReactNode
  /// What the record IS, beside its name — ONE status `Pill`. In the head
  /// rather than the body because it is read before anything else and does not
  /// belong to any one section. Right of the title; under it on a phone.
  badge?: React.ReactNode
  /// The record's headline figures as one box (a `KpiBox`), between the title
  /// and the printer. A phone puts it on a line of its own under the title.
  figures?: React.ReactNode
  /// A nested record's way back: "‹ Back to {label}".
  back?: { readonly label: React.ReactNode; readonly onClick: () => void }
  /// What the close control is. `back` puts a ‹ Back at the left of the title
  /// instead of the × at the right: a record opened from another screen (an
  /// allotment from Ops) goes back to where it was opened from (owner,
  /// 2026-10-10).
  closeAs?: "x" | "back"
  /// The record's printer, in the head beside the close on every screen —
  /// never in the foot (owner, 2026-10-10: "print selalu di header").
  print?: React.ReactNode
  /// The overflow ⋯ in the head — Print, Download, Duplicate. Nothing else.
  more?: readonly SheetMoreItem[]
  /// DEPRECATED — verbs belong in `footer`. On a desk they stay in the head as
  /// they were; on a phone they are lifted into the foot, 44px, above the
  /// `footer`. See the anatomy above.
  actions?: React.ReactNode
  /// The record this sheet is showing, so its surroundings can be read here:
  /// what it is filed under, what people said about it, what was done to it.
  ///
  /// Declared on the shell rather than pasted into thirty sheets: every record
  /// has a history and every sheet should be able to show it, and the version
  /// where each screen remembers to add it is the version where a third of
  /// them do not. `kind` is a word from the server's own vocabulary
  /// (`record_kind`); a kind nothing recognises answers 404 rather than an
  /// empty panel that looks like a record with no history.
  subject?: { kind: string; id: string }
  /// The foot: a `SheetFooter` (or, for a sheet that still draws its own, any
  /// node — the band, the rule and the button heights are the sheet's).
  footer?: React.ReactNode
  /// The body draws its own action bar (a form whose Submit must stay inside
  /// the <form>): no automatic "Close" foot under it — two foots read as two
  /// sheets (owner, 2026-10-15, New Articles).
  noFoot?: boolean
  /// The record's picture, 64px, at the left of the crumb and title — an
  /// article's head reads like a PO's with its photo (owner, 2026-10-15).
  media?: React.ReactNode
  /// The record's sections, when it has more than one thing to say.
  ///
  /// The strip sits between the head and the body, outside the scroll, so the
  /// sections do not scroll away from each other. A record with a `subject`
  /// gets "Activity" appended as the last tab.
  tabs?: readonly SheetTab[]
  /// Which section is showing, when the caller needs to move it — a checklist
  /// sending somebody to the tab where the missing thing is set. Left out, the
  /// sheet keeps it to itself, which is what nearly every sheet wants.
  tab?: string | null
  onTabChange?: (tab: string) => void
  /// How much glass it takes: `rail`, `wide`, `table` or `workspace` — chosen by
  /// what the sheet holds (see the table above), never by a `className`.
  size?: SheetSize
  /// The old name for `size`, kept so nothing breaks. `width="rail"` or no
  /// width at all is the old 760px panel; `size="rail"` is the anatomy's 480px.
  width?: SheetSize
  /// The body is a `flex flex-col gap-6` stack of sections; nobody sets
  /// margins. Off: the plain block it always was.
  stack?: boolean
  /// Unsaved typing in the sheet: ×, Esc, a swipe down and the veil ask
  /// "Discard your changes?" once instead of throwing it away.
  dirty?: boolean
  children: React.ReactNode
  /// Only for what the sheet cannot say with the props — never a width.
  className?: string
}) {
  // No tabs in a record or a form (owner, 14 Oct: "ga semuanya tabs ya,
  // jelek … di detail dan form jangan pake tabs"; hub-ui-patterns, one
  // format): a sheet given `tabs` draws them as ONE scroll of sections — the
  // first is the record's body, the rest stand under their names — with the
  // record's Activity at the end, as a record without tabs has it. Asked for
  // one (`tab`), the sheet scrolls to it.
  const sections: readonly SheetTab[] | null = tabs ?? null
  // The widest any section needs: a record whose SKUs are a grid is as wide
  // as the grid.
  const sectionSize = sections?.reduce<SheetSize | undefined>(
    (widest, section) =>
      section.size === undefined
        ? widest
        : widest === undefined || RANK[section.size] > RANK[widest]
          ? section.size
          : widest,
    undefined
  )
  const sectionsBody = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || shown == null) return
    sectionsBody.current
      ?.querySelector(`[data-section="${CSS.escape(shown)}"]`)
      ?.scrollIntoView({ block: "start" })
  }, [open, shown])
  const kind: SheetSize = sectionSize ?? size ?? width ?? "rail"
  const unsized =
    sectionSize === undefined &&
    size === undefined &&
    (width === undefined || width === "rail")
  const phone = useLayout() === "phone"
  // A rail stands beside the list on a wide monitor — unless it was opened
  // from another sheet, when it is a layer over it (`lib/sheet-stack.ts`).
  const besideable = useRecordBeside() && kind === "rail"
  const layer = useSheetLayer(open && !phone, swap, besideable)
  const beside = layer.beside
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const where =
    context === false ? null : (context ?? screenForPath(pathname)?.label)
  // Claimed by a rail for as long as it is on screen, at every window width:
  // the shell is the one that decides what to do about it, and only the
  // monitor does anything. A wide sheet claims nothing — it never stands
  // beside the page, so a column reserved for it would be a strip of empty
  // canvas next to a veil. See `lib/sheet-space.ts` for why the panel is asked
  // rather than the URL read.
  useSheetSpace(open && kind === "rail" && (layer.beside || !besideable))

  // ×, Esc, a swipe down and the veil all arrive here as `open = false`.
  const guard = useDirtyGuard(dirty && open)
  const change = (next: boolean, details?: { readonly reason: string }) => {
    if (next) {
      onOpenChange(true)
      return
    }
    const reason = closeReasonOf(details?.reason)
    guard.request(() => onOpenChange(false, reason))
  }

  // A phone has no room for a row of header buttons under the title, so the
  // deprecated `actions` go to the foot instead.
  // In the All white look the desk does the same (owner, 2026-10-12): every
  // record's verbs live in its foot, one row, so no sheet carries a row of
  // words beside its title.
  const deskFoot = !phone && isWhiteLook()
  const lifted = (phone || deskFoot) && Boolean(actions)

  /// What the sheet holds — head, tabs, body, foot — drawn by either shell:
  /// the desk's Dialog or the phone's Drawer, whose Title and Close parts are
  /// passed in so each is wired to its own root.
  const body = (Parts: {
    Title: React.ElementType
    Close: React.ElementType
  }) => (
    <>
      <div
        className={cn(
          "sheet-head flex shrink-0 items-center gap-x-4 border-b border-hairline px-4 py-4 max-md:items-start md:px-7",
          "md:py-3",
          figures && "max-md:flex-wrap"
        )}
      >
        {closeAs === "back" && (
          <Parts.Close className="-ml-1 inline-flex shrink-0 items-center gap-0.5 self-center rounded-inner py-1 pr-2 pl-1 text-[0.9375rem] text-body transition-[color,background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-soft-2 hover:text-ink active:scale-[0.97] max-md:min-h-tap max-md:self-start">
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            Back
          </Parts.Close>
        )}
        {media && (
          <div className="sheet-media size-16 shrink-0 self-center overflow-hidden rounded-inner border border-hairline bg-soft">
            {media}
          </div>
        )}
        <div className="sheet-headtext min-w-0 flex-1">
          {back && (
            <button
              type="button"
              onClick={back.onClick}
              className="sheet-back mb-1 -ml-1 inline-flex max-w-full items-center gap-0.5 rounded-inner pr-1 text-[0.9375rem] text-mute transition-colors hover:text-ink max-md:min-h-tap"
            >
              <ChevronLeft className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Back to {back.label}</span>
            </button>
          )}
          {back === undefined && (where || id) && (
            <div className="sheet-id mb-0.5 truncate font-mono text-id text-body">
              {where && (
                <>
                  <Parts.Close tabIndex={-1} className="sheet-crumb">
                    {where}
                  </Parts.Close>
                  {id && (
                    <span aria-hidden className="sheet-crumb-sep">
                      /
                    </span>
                  )}
                </>
              )}
              {id && <span>{id}</span>}
            </div>
          )}
          <div className="sheet-titlerow flex min-w-0 items-center gap-2.5 max-md:flex-col max-md:items-start max-md:gap-1.5">
            <Parts.Title className="sheet-title line-clamp-2 min-w-0 text-[1.125rem] leading-6 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-ink">
              {title}
            </Parts.Title>
            {badge && (
              <span className="sheet-badge flex shrink-0 flex-wrap items-center gap-1.5">
                {badge}
              </span>
            )}
          </div>
          {caption && (
            <div className="sheet-caption mt-0.5 line-clamp-2 text-meta [overflow-wrap:anywhere] text-mute">
              {caption}
            </div>
          )}
        </div>
        {figures && (
          <div className="min-w-0 max-md:order-last max-md:basis-full md:shrink-0">
            {figures}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1.5 max-md:gap-0.5">
          {actions && !lifted && (
            <>
              {actions}
              <span aria-hidden className="mx-0.5 h-5 w-px bg-hairline" />
            </>
          )}
          {print}
          {more !== undefined && more.length > 0 && <MoreMenu items={more} />}
          {closeAs === "x" && (
            <Parts.Close className="sheet-close btn-iconly grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink max-md:size-tap pointer-coarse:size-tap">
              <X className="size-4" />
              <span aria-hidden className="btn-word hidden">
                Close
              </span>
            </Parts.Close>
          )}
        </div>
      </div>
      <div
        className={cn(
          "sheet-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-7 md:py-8",
          // A stack of sections, 24px apart. Each child keeps its own height:
          // in a scrolling column a flex item may otherwise be squeezed.
          stack && "flex flex-col gap-6 [&>*]:shrink-0"
        )}
      >
        {sections ? (
          <div ref={sectionsBody} className="flex flex-col gap-10">
            {sections.map((section, index) => (
              <section
                key={section.value}
                data-section={section.value}
                className={cn(
                  "flex scroll-mt-6 flex-col gap-4",
                  index > 0 && "border-t border-hairline pt-6"
                )}
              >
                {index > 0 && (
                  <h4 className="section-title font-semibold text-ink">
                    {section.label}
                  </h4>
                )}
                {section.content}
              </section>
            ))}
          </div>
        ) : (
          children
        )}
        {subject && (
          <RecordPanel
            subject={subject}
            className={stack ? "mt-0" : undefined}
          />
        )}
      </div>
      {/* A record nobody acts on still ends in its foot (UI-PATTERNS.md §5:
          the head and the foot are always there): Close, a plain ghost. */}
      {!footer && !lifted && !noFoot && (
        <div className="sheet-foot flex shrink-0 justify-end border-t border-hairline px-4 py-3 md:px-7 md:py-3.5 max-md:[&_button]:h-11 md:[&_button]:h-9">
          <Parts.Close render={<Button variant="ghost">Close</Button>} />
        </div>
      )}
      {(footer || lifted) && (
        // One foot, one height: 36px buttons on a desk, 44px under a thumb —
        // the same layout on every width (D1, 6 Oct 2026). It rides above the
        // keyboard and the home bar because the shell it sits in does.
        <div className="sheet-foot shrink-0 border-t border-hairline px-4 py-3 md:px-7 md:py-3.5 max-md:[&_button]:h-11 md:[&_button]:h-9">
          {lifted && deskFoot ? (
            <div className="foot-lifted flex flex-wrap items-center gap-2">
              {footer && <div className="mr-auto">{footer}</div>}
              {actions}
            </div>
          ) : lifted ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 [&>:only-child]:flex-1">
                {actions}
              </div>
              {footer}
            </div>
          ) : (
            footer
          )}
        </div>
      )}
    </>
  )

  // A phone: a sheet in the Vaul sense. It rises from the bottom edge and
  // stops short of the top — the page it came from still shows as a strip
  // above it — carries a grip, and a pull down puts it away (Base UI's
  // Drawer: the swipe, and the keyboard kept below the foot by
  // `VirtualKeyboardProvider`). Everything inside is the same sheet.
  if (phone) {
    return (
      <>
        <Drawer.Root open={open} onOpenChange={change}>
          <Drawer.VirtualKeyboardProvider>
            <Drawer.Portal>
              <Drawer.Backdrop
                forceRender
                className="sheet-veil fixed inset-0 z-40 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
              />
              <Drawer.Viewport className="fixed inset-0 z-40 flex items-end pb-[var(--drawer-keyboard-inset,0px)]">
                <Drawer.Popup
                  data-size={kind}
                  className={cn(
                    "sheet-drawer flex w-full flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
                    // Up to 12px under the notch, less whatever the keyboard
                    // takes, so the foot's buttons ride above it.
                    "h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem-var(--drawer-keyboard-inset,0px))]",
                    "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
                    "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
                    "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none",
                    className,
                    // A screen's own `w-[Nrem]` is for the desk; a phone's sheet
                    // is the whole width, whatever it asked for.
                    "w-full max-w-none"
                  )}
                >
                  <div
                    aria-hidden
                    className="flex shrink-0 justify-center pt-2"
                  >
                    <span className="h-1 w-9 rounded-full bg-hairline-strong" />
                  </div>
                  {body(Drawer)}
                </Drawer.Popup>
              </Drawer.Viewport>
            </Drawer.Portal>
          </Drawer.VirtualKeyboardProvider>
        </Drawer.Root>
        {guard.dialog}
      </>
    )
  }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={change}
        modal={beside ? false : true}
        disablePointerDismissal={beside}
      >
        <Dialog.Portal>
          {/* No veil beside the list. The veil's job is to say "the thing behind
            this is not what you are working on now", and beside the list that
            is a lie: it is exactly what somebody is working on. */}
          {!beside && (
            <Dialog.Backdrop
              // Over another sheet, or in place of one, the page is already
              // behind a veil: this one is clear, still a tap away from closing.
              data-quiet={layer.over || layer.replaces ? "" : undefined}
              className={cn(
                "sheet-veil fixed inset-0 z-40 bg-[var(--scrim)]",
                // One surface with the panel: the veil fades on the panel's own
                // clock, in and out.
                "transition-opacity duration-(--t-sheet) ease-(--ease-out) max-md:duration-(--t-drawer)",
                "data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0"
              )}
            />
          )}
          <Dialog.Popup
            data-size={unsized ? "unsized" : kind}
            data-under={layer.under ? "" : undefined}
            data-over={layer.over ? "" : undefined}
            data-swap={layer.replaces ? "" : undefined}
            className={cn(
              "sheet-pop fixed z-40 flex flex-col overflow-hidden border border-hairline bg-canvas shadow-float",
              // The phone: the whole screen. A bottom sheet stopping at 90% left
              // a strip of list nobody could use and, with the keyboard up, a
              // form a few lines tall — and a PO is raised on the phone, at the
              // supplier's counter. `dvh` rather than `vh` because a mobile
              // browser's toolbars slide and `vh` is the height it has when they
              // are gone; the notch and home-bar insets are padding so the head
              // and the footer's buttons clear them.
              "inset-0 h-dvh rounded-none border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              // The desk and the tablet: the floating rail, inset on three sides.
              "md:inset-x-auto md:inset-y-auto md:top-5 md:right-5 md:bottom-5 md:h-auto md:max-w-[calc(100vw-2.5rem)] md:rounded-shell md:border md:pt-0 md:pb-0",
              // Arriving from the edge it lives on, so where it came from is
              // where it goes back to. The desk's rail slides in from the right,
              // 20px of gutter included so it starts wholly off the glass, in
              // `--t-sheet`. Both leave faster than they came (`--t-exit`).
              // Translate only — no layout property moves. Reduced motion
              // drops the travel and keeps a fade.
              "transition-[translate,opacity] ease-(--ease-drawer)",
              "duration-(--t-drawer) data-[ending-style]:duration-(--t-exit) md:duration-(--t-sheet) md:data-[ending-style]:duration-(--t-exit)",
              "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
              layer.replaces
                ? // The mode move: the frame is already there, so nothing
                  // travels — the contents go (100ms) and come (160ms).
                  "md:data-[ending-style]:translate-none md:data-[starting-style]:translate-none md:data-[starting-style]:opacity-0 md:data-[ending-style]:opacity-0 md:duration-160 md:ease-(--ease-out) md:data-[ending-style]:duration-100"
                : "md:data-[ending-style]:translate-x-[calc(100%+1.25rem)] md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-[calc(100%+1.25rem)] md:data-[starting-style]:translate-y-0",
              "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-none motion-reduce:data-[starting-style]:opacity-0",
              unsized ? UNSIZED : SIZE[kind],
              className,
              "max-md:w-full max-md:max-w-none"
            )}
          >
            {body(Dialog)}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {guard.dialog}
    </>
  )
}

function closeReasonOf(
  reason: string | undefined
): SheetCloseReason | undefined {
  switch (reason) {
    case "escape-key":
      return "escape"
    case "close-press":
      return "close"
    case "outside-press":
      return "veil"
    case "swipe":
      return "swipe"
    default:
      return undefined
  }
}

/// The head's overflow: a ⋯ that opens a short menu — Print, Download,
/// Duplicate. A menu of the verbs that are NOT the sheet's job; the sheet's
/// own verbs are in the foot. 44px under a thumb.
function MoreMenu({ items }: { items: readonly SheetMoreItem[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More"
        className={cn(
          "btn-iconly",
          button({ variant: "quiet", size: "icon" }),
          "text-line-ico max-md:size-tap"
        )}
      >
        <MoreHorizontal />
        <span aria-hidden className="btn-word hidden">
          More
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          className={POSITIONER}
        >
          <Menu.Popup className={cn(POPUP, "min-w-44")}>
            {items.map((item, index) => (
              <Menu.Item
                key={index}
                disabled={item.disabled}
                onClick={item.onSelect}
                className={cn(
                  ITEM,
                  "max-md:min-h-tap",
                  item.disabled && "cursor-default opacity-50"
                )}
              >
                {item.icon}
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/// Anything a sheet's body spaced by hand and the one spacing replaces. Written
/// out so the collapse is findable: `Facts` drops these from `className`.
///
/// The five variants the 6 Oct 2026 audit found, now one (`gap-x-8 gap-y-4`,
/// value 4px under its label):
///
/// - default            `gap-x-4 gap-y-3.5`
/// - PO / Supplier      `gap-x-10 gap-y-4|5 [&_dd]:mt-1`
/// - Promotion/Campaign `gap-y-5`
/// - Voucher            `gap-x-6 gap-y-5`
/// - New article setup  `gap-x-10 gap-y-6 min-[100rem]:gap-y-9 [&_dd]:mt-1.5`
const OWN_SPACING = /(^|:)(gap(-[xy])?-|\[&_dd\]:mt-)/

/// The two-column fact grid a record detail leads with: a label over its value,
/// two columns on a desk and on a phone, ONE spacing.
///
/// Values wrap (an email, an address or a code is never cut to an ellipsis);
/// the grid holds ≤ 8 short values, a long one is `<Fact wide>`, and free text
/// is a section of its own, not a fact. `className` still reaches the grid for
/// layout (`mt-3`, a column count) — but a gap or a `dd` margin passed in is
/// ignored: spacing is the kit's, not a sheet's.
export function Facts({
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement>) {
  const kept = className
    ?.split(/\s+/)
    .filter((token) => token !== "" && !OWN_SPACING.test(token))
    .join(" ")
  return (
    <dl className={cn("grid grid-cols-2 gap-x-10 gap-y-5", kept)} {...props} />
  )
}

export function Fact({
  term,
  children,
  wide = false,
}: {
  term: React.ReactNode
  children: React.ReactNode
  /// Across both columns — an address, an email, a sentence-long value.
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      {/* `body`, not `faint`. Faint (#d3d3d8) is the grey for a rule or a
          disabled glyph, and a label printed in it reads as switched off —
          the term of a fact is the half that says what the number means, and
          it cannot be the half that disappears. */}
      {/* The text face, sentence case: Inter 14, label over value. */}
      <dt className="text-[0.9375rem] leading-[1.125rem] text-body">{term}</dt>
      {/* The value is content: 15, the body size (owner, 14 Oct: "kok rasanya
          kecil pas lihat detail supplier") — the label above it is the 14. */}
      <dd className="mt-1 text-[0.9375rem] leading-[1.375rem] [overflow-wrap:anywhere] text-ink tabular-nums">
        {children}
      </dd>
    </div>
  )
}
