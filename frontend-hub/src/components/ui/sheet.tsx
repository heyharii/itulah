import { Dialog } from "@base-ui/react/dialog"
import { Drawer } from "@base-ui/react/drawer"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { RecordPanel } from "@/components/ui/record-panel"
import { useLayout, useRecordBeside } from "@/lib/layout"
import { useSheetSpace } from "@/lib/sheet-space"
import { cn } from "@/lib/utils"

/// The detail rail — a floating panel, never a flush column.
///
/// It sits inset 20px from the top, right and bottom of the shell with
/// `{r.shell}` corners and the float shadow, so it reads as a sheet lifted
/// above the list, the way cards float on the well. A `border-left` on a
/// square-cornered full-height column is the deprecated shape.
///
/// It sits on the WHITE veil: the list behind washes toward near-white and
/// never darkens.
///
/// **Under 48rem it takes the whole screen instead.** A 27.5rem rail inset
/// 16px from the right is a rail on a 375px screen: it covers everything and
/// still leaves a 16px sliver of list nobody can read or tap. A record on a
/// phone comes up over the list from the edge nearest the hand, stopping short
/// of the top so the list it came from is still visible behind it — which is
/// the same thing the desk rail says by floating, said with the one axis a
/// phone has. Everything inside is unchanged: same header, same facts, same
/// mini-table, same history.
///
/// **And on a page 1300px wide it stops covering anything at all.** Same
/// panel, same place on the glass — what changes is that the shell gives it a
/// column and the list narrows into what is left, so a buyer can read the
/// order and the twenty orders around it at once. That is the whole of what
/// this app does differently on a big screen, and it is deliberately not a new
/// rail: a permanent strip of chrome down the right-hand side would have to be
/// filled with something, and the two candidates were already ruled out here —
/// the filter rail was removed from every screen for spending 248px on a
/// control people touch twice a day, and a record's history already lives in
/// the panel below.
///
/// Beside the list it is `modal={false}` and pointer-dismissal is off, which is
/// what makes it a column rather than a dialog that happens to be next to one:
/// every row stays clickable, clicking another one swaps the record instead of
/// closing it, and the page scrolls behind. Escape still shuts it — that is a
/// keyboard dismissal, and a panel you cannot leave from the keyboard is a
/// trap.
export function Sheet({
  open,
  onOpenChange,
  title,
  id,
  caption,
  actions,
  badge,
  subject,
  footer,
  tabs,
  tab: shown,
  onTabChange,
  width = "rail",
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /// The record's sections, when it has more than one thing to say.
  ///
  /// A record long enough to scroll past its own summary is a record nobody
  /// reads to the end — and the six columns of an order's lines are not what
  /// somebody opened it to check when they came to see whether it is late. The
  /// strip sits between the head and the body, outside the scroll, so the
  /// sections do not scroll away from each other.
  ///
  /// A record with a `subject` gets its activity appended as the last tab: the
  /// panel was already being drawn under everything else, where it was the one
  /// thing guaranteed to be below the fold.
  tabs?: readonly {
    readonly value: string
    readonly label: React.ReactNode
    readonly content: React.ReactNode
  }[]
  /// Which section is showing, when the caller needs to move it — a checklist
  /// sending somebody to the tab where the missing thing is set. Left out, the
  /// sheet keeps it to itself, which is what nearly every sheet wants.
  tab?: string | null
  onTabChange?: (tab: string) => void
  /// What the record IS, beside its name — a status pill, the words it is
  /// filed under. In the head rather than the body because it is read before
  /// anything else and does not belong to any one section.
  badge?: React.ReactNode
  title: React.ReactNode
  /// The record's own identifier, set in mono above the title.
  id?: React.ReactNode
  /// One quiet line UNDER the title: where this record came from, and when.
  ///
  /// Its own slot rather than another `badge`, because a badge sits on the
  /// title's line and competes with it for the width a long name needs. This
  /// is the provenance somebody reads once — who raised it, on what day — to
  /// confirm they opened the right document, and then never again.
  caption?: React.ReactNode
  /// At most two, plus an overflow — pinned in the header, not at the foot.
  actions?: React.ReactNode
  /// The record this sheet is showing, so its surroundings can be read here:
  /// what it is filed under, what people said about it, what was done to it.
  ///
  /// Declared on the shell rather than pasted into thirty sheets: every record
  /// has a history and every sheet should be able to show it, and the version
  /// where each screen remembers to add it is the version where a third of
  /// them do not. That is also what made comments and tags cost one change
  /// rather than twenty-four — the sheets were already saying which record
  /// they had open.
  ///
  /// `kind` is a word from the server's own vocabulary (`record_kind`), not a
  /// name this screen invents. A kind nothing recognises answers 404 rather
  /// than an empty panel that looks like a record with no history.
  subject?: { kind: string; id: string }
  /// The composer, when the record takes one.
  footer?: React.ReactNode
  /// How much glass it takes.
  ///
  /// `rail` is the default and the shape everything else in the app uses: a
  /// record standing next to the row it came from. `wide` is for a sheet that
  /// is a TASK rather than a record — composing a thread, where the widest
  /// thing on it is a textarea somebody is going to write a paragraph into,
  /// and a 27.5rem column turns that paragraph into a column of six-word
  /// lines. Two thirds of the window, never narrower than the rail, and capped
  /// at 46rem because a form field wider than that is a line the eye loses its
  /// place on.
  ///
  /// A wide sheet does not stand beside the list on a monitor: it is over the
  /// page, veil and all. Beside is a promise that the list is still readable
  /// next to it, and at two thirds of the glass that promise cannot be kept —
  /// and there is nothing to read next to a form that has not been filled in
  /// yet anyway.
  ///
  /// `table` is the third: a sheet whose body is a GRID, read across rather
  /// than down. Receiving's verifier is the case it exists for — six figures
  /// per line that only mean anything side by side, and in a 27.5rem rail
  /// those six became a stack of cards a screen tall each, so five garments
  /// off one lorry could not be seen at once. It behaves like `wide` in every
  /// other way, and stops at 64rem because past that the columns stop being a
  /// row the eye can track.
  ///
  /// `workspace` is the fourth and widest, and it is not a record at all: a
  /// panel whose body is a LIST AND THE WORK BESIDE IT. New articles is the case
  /// it exists for — an order rail, a delivery rail and a form with a colour x
  /// size grid in it, three panes that each need their own room. At 64rem the
  /// two rails left the form 36rem and it kept collapsing to one column.
  ///
  /// The 64rem cap does not apply because the thing being tracked is not one
  /// row of columns: it is three panes, each read on its own, and the rule
  /// about the eye losing a row is a rule about a table. It stops at 84rem
  /// because that is where the form's own columns stop being readable.
  width?: "rail" | "wide" | "table" | "workspace"
  children: React.ReactNode
  className?: string
}) {
  // Which section is showing. Kept here rather than by the caller because the
  // caller would have to reset it every time a different record opens in the
  // same sheet — the tab you left on the last order is not a question you are
  // still asking about this one.
  const [own, setOwn] = useState<string | null>(null)
  const tab = shown !== undefined ? shown : own
  const setTab = (value: string) => {
    setOwn(value)
    onTabChange?.(value)
  }
  // A different record opens on its first section. The identifier is what says
  // "different" — the sheet stays mounted while the list swaps records under
  // it, so nothing else would fire.
  useEffect(() => setOwn(null), [id, open])
  const sections = tabs
    ? [
        ...tabs,
        ...(subject
          ? [
              {
                value: "__activity",
                // "Comments", not "Activity": the panel also carries the tags
                // and the trail, but commenting is what somebody comes here to
                // DO, and a tab named for the doing is the one people find.
                label: "Comments",
                content: <RecordPanel subject={subject} />,
              },
            ]
          : []),
      ]
    : null
  const here = sections?.find((s) => s.value === tab) ?? sections?.[0] ?? null
  const beside = useRecordBeside() && width === "rail"
  const phone = useLayout() === "phone"
  // Claimed by a rail for as long as it is on screen, at every window width:
  // the shell is the one that decides what to do about it, and only the
  // monitor does anything. A wide sheet claims nothing — it never stands
  // beside the page, so a column reserved for it would be a strip of empty
  // canvas next to a veil. See `lib/sheet-space.ts` for why the panel is asked
  // rather than the URL read.
  useSheetSpace(open && width === "rail")

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
          "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-hairline px-4 py-4 md:flex-nowrap md:px-7",
          // A sheet with tabs gets a header of its own, with room: the title
          // is not the first tab's lid (owner, 2 Oct 2026).
          sections ? "md:py-5" : "md:py-3"
        )}
      >
        <div className="min-w-0 flex-1">
          {id && <div className="mb-0.5 font-mono text-id text-body">{id}</div>}
          <div className="flex min-w-0 items-center gap-2.5">
            <Parts.Title className="truncate text-[1rem] leading-6 font-semibold tracking-[-0.01em] text-ink">
              {title}
            </Parts.Title>
            {badge && <span className="shrink-0">{badge}</span>}
          </div>
          {caption && (
            <div className="mt-0.5 truncate text-meta text-mute">{caption}</div>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-1.5 max-md:order-3 max-md:w-full max-md:flex-wrap">
            {actions}
            <span
              aria-hidden
              className="mx-0.5 h-5 w-px bg-hairline max-md:hidden"
            />
          </div>
        )}
        <Parts.Close className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink max-md:order-2 pointer-coarse:size-tap">
          <X className="size-4" />
        </Parts.Close>
      </div>
      {sections && here && (
        <nav
          role="tablist"
          aria-label="Record sections"
          className="flex shrink-0 [scrollbar-width:none] items-stretch gap-2 overflow-x-auto border-b border-hairline px-4 md:px-7 [&::-webkit-scrollbar]:hidden"
        >
          {sections.map((section) => {
            const current = section.value === here.value
            return (
              <button
                key={section.value}
                role="tab"
                type="button"
                aria-selected={current}
                onClick={() => setTab(section.value)}
                className={cn(
                  "-mb-px inline-flex h-12 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[0.9375rem] font-medium whitespace-nowrap transition-colors",
                  current
                    ? "border-accent font-semibold text-accent"
                    : "border-transparent text-body hover:text-ink",
                  "pointer-coarse:h-tap"
                )}
              >
                {section.label}
              </button>
            )
          })}
        </nav>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-7 md:py-8">
        {sections && here ? here.content : children}
        {!sections && subject && <RecordPanel subject={subject} />}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-hairline px-4 py-3 md:px-7 md:py-3.5">
          {footer}
        </div>
      )}
    </>
  )

  // A phone: a sheet in the Vaul sense. It rises from the bottom edge and
  // stops short of the top — the page it came from still shows as a strip
  // above it — carries a grip, and a pull down puts it away (Base UI's
  // Drawer: the swipe, and the keyboard kept below the foot by
  // `VirtualKeyboardProvider`). It replaced the full-screen panel, which
  // could only be left by its ×. Everything inside is the same sheet.
  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange}>
        <Drawer.VirtualKeyboardProvider>
          <Drawer.Portal>
            <Drawer.Backdrop
              forceRender
              className="fixed inset-0 z-40 bg-[var(--scrim)] opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-(--t-drawer) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0 data-[swiping]:transition-none"
            />
            <Drawer.Viewport className="fixed inset-0 z-40 flex items-end pb-[var(--drawer-keyboard-inset,0px)]">
              <Drawer.Popup
                className={cn(
                  "flex w-full flex-col overflow-hidden rounded-t-sheet border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] shadow-float outline-none",
                  // Up to 12px under the notch, less whatever the keyboard
                  // takes, so the foot's buttons ride above it.
                  "h-[calc(100dvh-env(safe-area-inset-top,0px)-0.75rem-var(--drawer-keyboard-inset,0px))]",
                  "[transform:translateY(var(--drawer-swipe-movement-y,0px))] transition-[translate,transform] duration-(--t-drawer) ease-(--ease-drawer) data-[ending-style]:duration-(--t-exit)",
                  "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full data-[swiping]:transition-none",
                  "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[starting-style]:translate-none",
                  className
                )}
              >
                <div aria-hidden className="flex shrink-0 justify-center pt-2">
                  <span className="h-1 w-9 rounded-full bg-hairline-strong" />
                </div>
                {body(Drawer)}
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.VirtualKeyboardProvider>
      </Drawer.Root>
    )
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={beside ? false : true}
      disablePointerDismissal={beside}
    >
      <Dialog.Portal>
        {/* No veil beside the list. The veil's job is to say "the thing behind
            this is not what you are working on now", and beside the list that
            is a lie: it is exactly what somebody is working on. */}
        {!beside && (
          <Dialog.Backdrop
            className={cn(
              "fixed inset-0 z-40 bg-[var(--scrim)]",
              // One surface with the panel: the veil fades on the panel's own
              // clock, in and out.
              "transition-opacity duration-(--t-sheet) ease-(--ease-out) max-md:duration-(--t-drawer)",
              "data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0"
            )}
          />
        )}
        <Dialog.Popup
          className={cn(
            "fixed z-40 flex flex-col overflow-hidden border border-hairline bg-canvas shadow-float",
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
            // where it goes back to. The phone's sheet rises the full height
            // of the glass, the way iOS presents a screen, on the iOS sheet
            // curve at `--t-drawer`; the desk's rail slides in from the right,
            // 20px of gutter included so it starts wholly off the glass, in
            // `--t-sheet`. Both leave faster than they came (`--t-exit`).
            // Translate only — no layout property moves. Reduced motion
            // drops the travel and keeps a fade.
            "transition-[translate,opacity] ease-(--ease-drawer)",
            "duration-(--t-drawer) data-[ending-style]:duration-(--t-exit) md:duration-(--t-sheet) md:data-[ending-style]:duration-(--t-exit)",
            "data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
            "md:data-[ending-style]:translate-x-[calc(100%+1.25rem)] md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-[calc(100%+1.25rem)] md:data-[starting-style]:translate-y-0",
            "motion-reduce:data-[ending-style]:translate-none motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-none motion-reduce:data-[starting-style]:opacity-0",
            width === "workspace"
              ? "md:w-[clamp(27.5rem,96vw,84rem)]"
              : width === "table"
                ? "md:w-[clamp(27.5rem,92vw,64rem)]"
                : width === "wide"
                  ? "md:w-[clamp(27.5rem,72vw,56rem)]"
                  : "md:w-[clamp(27.5rem,62vw,47.5rem)]",
            className
          )}
        >
          {body(Dialog)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/// The two-column fact grid a record detail leads with: mono micro-cap term,
/// tabular value.
export function Facts({
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cn("grid grid-cols-2 gap-x-4 gap-y-3.5", className)}
      {...props}
    />
  )
}

export function Fact({
  term,
  children,
}: {
  term: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      {/* `body`, not `faint`. Faint (#d3d3d8) is the grey for a rule or a
          disabled glyph, and a label printed in it reads as switched off —
          the term of a fact is the half that says what the number means, and
          it cannot be the half that disappears. */}
      {/* The text face, not the mono one, and no capitals. Measured against
          the prototype: a fact's label there is Inter 12/18 in sentence case,
          and the mono micro-caps this used to wear made four ordinary words
          read as a machine's field names. */}
      <dt className="text-[0.875rem] leading-[1.125rem] text-body">{term}</dt>
      <dd className="mt-[0.3125rem] truncate text-[0.875rem] leading-[1.375rem] text-ink tabular-nums">
        {children}
      </dd>
    </div>
  )
}
