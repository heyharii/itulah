import { Link, useRouterState } from "@tanstack/react-router"
import { HelpCircle, LogOut, X } from "lucide-react"

import { count } from "@/lib/format"
import {
  domainForPath,
  flatDomain,
  modulesOfDomain,
  moduleForPath,
  shown,
  type AppModule,
  type NavItem,
} from "@/lib/navigation"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The sidebar — one module's screens, and only ever one module's.
///
/// The department list moved out to `rail.tsx` on 2026-09-10; that file
/// carries the argument for the split, including the answer to the case that
/// removed the rail in the first place. What is left here is the panel: the
/// screens of whichever module you are in, drawn in the sections the module
/// declares, at full width with no indent, because there is no longer a parent
/// row above them to be indented under.
///
/// **Which module that is, is read off the URL.** There is no open/closed
/// state anywhere in this file, and that is what makes a link pasted into chat
/// open the sidebar exactly as the person who sent it had it. State would have
/// to be restored, synchronised with navigation, and would still be wrong in
/// the second tab.
///
/// The rows carry their icons again. They lost them when they were sub-items —
/// a second column of glyphs indented under a glyph was the thing that made the
/// old two-panel shell hard to read — but a top-level row is not under
/// anything, and an icon beside a screen name is how a list of six is picked
/// from at a glance rather than read.
///
/// The three modules that reached their screens by an in-page tab strip do not
/// any more: those strips were what a module without a sidebar row had to grow,
/// and they are ordinary rows now like everyone else's.
export function Sidebar({
  open,
  variant = "flow",
  onToggle,
}: {
  open: boolean
  /// Whether this is the column in the layout or the drawer over it. One
  /// component for both, because they are the same navigation: a second file
  /// for the narrow one is a second place to add a module to, and the version
  /// where somebody forgets is the version where a screen is reachable on a
  /// desk and not on an iPad. The shell decides which — see `app-shell.tsx`.
  variant?: "flow" | "drawer"
  onToggle: () => void
}) {
  const drawer = variant === "drawer"
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = moduleForPath(pathname)
  const domain = domainForPath(pathname)
  const owned = domain ? modulesOfDomain(domain) : [active]
  // Headings when there are groups to name, and not when the domain is six
  // one-screen modules whose rows already say what the headings would — see
  // `flatDomain`.
  const grouped = owned.length > 1 && !flatDomain(owned)
  const identity = useIdentity()
  const where = useNodeIdentity()
  const signOut = useSignOut()

  return (
    <aside
      data-open={open}
      className={cn(
        "flex shrink-0 flex-col border-r border-hairline bg-soft px-[0.6875rem] py-[0.8125rem]",
        "min-h-0",
        // Docked, the column is always its full width: folding it away is the
        // shell's job, done by sliding it rather than by narrowing it — see
        // `DockedSidebar` in `app-shell.tsx` for why the width never animates.
        !drawer && (open ? "h-full w-[15.5rem]" : "hidden"),
        // A drawer is opened by a thumb, so it takes the labelled width and
        // scrolls its own height. `max-w` keeps the veil reachable on the
        // narrowest phone: a drawer with no screen showing beside it is a
        // page, and a page needs a back button rather than a tap-outside.
        drawer && "h-full w-[15.5rem] max-w-[calc(85vw-5rem)] overflow-y-auto"
      )}
    >
      {/* The workspace: whose books these are, and which node is answering.
          At the bar's height, so its lower edge and the bar's are one line
          across the window. It is the way Home was always reached — the mark
          — and it says which node you are on, which the bar used to leave to
          a tooltip on an avatar. */}
      <div className="-mx-[0.1875rem] -mt-[0.8125rem] flex h-13 shrink-0 items-center gap-1 border-b border-hairline">
        <Link
          to="/"
          aria-label="Wira Makmur — home"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-inner px-1.5 py-1 transition-colors hover:bg-soft-2"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-[0.4375rem] bg-dark text-[0.625rem] font-semibold tracking-[0.02em] text-on-dark shadow-[inset_0_0_0_1px_rgb(255_255_255/8%)]">
            WM
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <b className="block truncate text-[0.8125rem] font-semibold tracking-[-0.01em] text-ink">
              Wira Makmur
            </b>
            <small className="flex items-center gap-1 truncate text-[0.6875rem] text-mute">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  where.data ? "bg-ok" : "bg-faint"
                )}
              />
              {where.data?.node_id ?? "connecting…"}
            </small>
          </span>
        </Link>
        {/* Only the drawer closes itself here. The docked column's switch is
            on the rail — a control that vanishes with the panel it controls
            is a one-way door. */}
        {drawer && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Close navigation"
            title="Close"
            className="grid size-tap shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text"
          >
            <X className="size-[1.125rem] stroke-[1.7]" />
          </button>
        )}
      </div>

      {/* The domain the column is listing, as its title. Home belongs to no
          domain and says so. Keyed like the list so it swaps with it — but
          NOT with the list's key: two siblings under one key is how every
          domain visited left its title behind, stacked above the rows. */}
      <b
        key={`title:${domain?.id ?? active.id}`}
        className="nav-swap mt-3.5 mb-1.5 block truncate px-[0.5625rem] text-card-title font-semibold tracking-[-0.01em] text-ink"
      >
        {domain?.label ?? active.label}
      </b>

      {/* Quick actions and Ask used to sit here, above the modules. They were
          removed from the column on the owner's instruction; the ⌘K palette and
          the assistant are still reachable by their shortcuts, which is where
          the people who use them were reaching for them anyway. */}

      {/* Keyed on the domain, so the list is replaced — and plays `nav-swap`
          — when the rail moves, and is left alone when a row is clicked. */}
      <nav
        key={`list:${domain?.id ?? active.id}`}
        aria-label="Navigation"
        className="nav-swap flex min-h-0 [scrollbar-width:none] flex-col gap-px overflow-y-auto [&::-webkit-scrollbar]:hidden"
      >
        {/* The drawer says what the rail says: the screens of the DOMAIN, not
            of one module inside it. Selling holds three modules, and a drawer
            that showed only the one you happened to be in would hide Store ops
            and Members from every phone in the company.

            Whether those modules are drawn as labelled groups or as one flat
            list is `flatDomain`'s question, not this file's. */}
        {owned.map((module) => (
          <div key={module.id} className="flex flex-col gap-px">
            {grouped && (
              <span className="px-[0.5625rem] pt-4 pb-[0.3125rem] text-section font-semibold tracking-[0.05em] text-mute uppercase">
                {module.label}
              </span>
            )}
            <ModuleScreens key={module.id} module={module} />
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-px pt-2.5">
        <button
          type="button"
          title={open ? undefined : "Help & resources"}
          className={cn(
            "flex items-center gap-2.5 rounded-lg py-1.5 text-meta font-normal text-body transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:min-h-tap",
            open ? "px-[0.5625rem]" : "justify-center px-0"
          )}
        >
          <HelpCircle className="size-[0.9375rem] shrink-0 text-line-ico" />
          {open && "Help & resources"}
        </button>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2.5 rounded-inner",
            open && "border border-hairline p-[0.4375rem_0.5rem]",
            !open && "justify-center"
          )}
        >
          <span className="size-[1.625rem] shrink-0 rounded-full bg-linear-to-br from-avatar-from to-avatar-to" />
          {open && (
            <>
              <span className="min-w-0 flex-1 text-[0.78125rem] leading-tight font-medium">
                <span className="block truncate">
                  {identity.data?.display_name ??
                    identity.data?.username ??
                    "—"}
                </span>
                <small className="block truncate text-[0.6875rem] font-normal text-mute">
                  {where.data?.node_id ?? "cloud"}
                </small>
              </span>
              <button
                type="button"
                aria-label="Sign out"
                onClick={() => signOut.mutate()}
                disabled={signOut.isPending}
                className="grid size-[1.625rem] shrink-0 place-items-center rounded-lg text-line-ico transition-colors hover:bg-soft-2 hover:text-text disabled:opacity-50"
              >
                <LogOut className="size-4 stroke-[1.7]" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

/// One module's screens, in the sections the module declares.
///
/// Sections rather than a flat list because the labels are the module's own
/// grouping of its work — Finance's "Work · Books · Rules" — and that grouping
/// is the difference between six rows you scan and six rows you read. The
/// first section carries no label: it sits directly under the workspace chip
/// and a heading there would name the module a second time.
///
/// A LATER section with no label draws a rule instead of a heading. Articles
/// wanted that on 2026-09-12: its four lists belong under the article rather
/// than under a word, and every word tried for them — "Vocabulary",
/// "Reference data", "Master data" — named a category of table rather than
/// anything the business does. A hairline says "these belong to the row above"
/// and says nothing else.
///
/// A module with one visible screen draws that screen and no heading. It is
/// still drawn: the row is where you are, and an empty panel beside a lit rail
/// tile reads as a screen that failed to load.
function ModuleScreens({ module }: { module: AppModule }) {
  // Called unconditionally and before anything branches on it. Which module is
  // on screen changes, so a hook called only by the modules that declare one
  // would change the hook order between renders; `key`ing this component by
  // module id keeps the default stable for the life of the instance.
  const useAudience = module.useAudience ?? noAudience
  const audience = useAudience()
  // One subscription for the whole column rather than one per row: a row that
  // needs to know where the reader is already asks Router, and sixty rows
  // asking is sixty subscriptions to answer one question.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const visible = module.sections
    .map((section) => ({
      label: section.label,
      items: section.items.filter(shown(audience)),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <>
      {visible.map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-px">
          {section.label ? (
            <span className="px-[0.5625rem] pt-4 pb-[0.3125rem] text-section font-normal text-mute">
              {section.label}
            </span>
          ) : (
            index > 0 && (
              <hr className="mx-[0.5625rem] mt-[0.6875rem] mb-[0.5625rem] border-0 border-t border-hairline" />
            )
          )}
          {section.items.map((item) => (
            <ScreenRow
              key={item.path}
              item={item}
              // Only the module's own landing screen needs an exact match: it
              // is a prefix of every other path in the module, so a loose
              // match would light it on all of them.
              exact={item.path === module.home}
              // A row whose child is not under its own path — Utilities under
              // Langganan — says so itself, because Router cannot know it.
              lit={litByHand(pathname, item)}
              soon={module.soon ?? false}
            />
          ))}
        </div>
      ))}
    </>
  )
}

/// One screen, as a row.
///
/// Its own component so that a row which wants a live count gets one hook call,
/// at the top of a component, unconditionally — the only way a hook may be
/// called at all. `item.useCount?.()` inside the `.map()` above would be a hook
/// in a loop body, and would break the first time a section changed length.
///
/// The active row is a FILL, and it is the only fill in the column: the rail
/// tile says which module, this says which screen, and neither has to compete
/// with a second highlighted thing above it.
///
/// A `soon` module's rows keep their place but open nothing — a link into
/// `Placeholder` would promise a screen that is not there.
function ScreenRow({
  item,
  exact,
  lit = false,
  soon = false,
}: {
  item: NavItem
  exact: boolean
  /// Whether this row is the parent of where the reader is, for a child Router
  /// cannot see from here. See `NavItem.alsoLights`.
  lit?: boolean
  soon?: boolean
}) {
  const Icon = item.icon
  const useCount = item.useCount ?? noCount
  const badge = useCount()

  if (soon) {
    return (
      <span
        title={`${item.label} — not built yet`}
        aria-disabled="true"
        className="group flex cursor-default items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-mute"
      >
        <Icon className="size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <Badge value={badge} tint={item.badge} />
      </span>
    )
  }

  return (
    <Link
      to={item.path}
      activeOptions={{ exact }}
      aria-current={lit ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-[0.5625rem] py-[0.4375rem] text-nav font-medium text-text transition-colors hover:bg-soft-2 hover:text-ink data-[status=active]:bg-soft-2 data-[status=active]:font-semibold data-[status=active]:text-ink pointer-coarse:min-h-tap",
        lit && "bg-soft-2 font-semibold text-ink"
      )}
    >
      <Icon
        className={cn(
          "size-[1.0625rem] shrink-0 stroke-[1.55] text-line-ico group-data-[status=active]:text-ink",
          lit && "text-ink"
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <Badge value={badge} tint={item.badge} />
    </Link>
  )
}

/// Whether where the reader is belongs to this row, by the row's own
/// declaration rather than by Router's prefix matching.
///
/// A whole path or anything under it, so `/contracts/utilities/anything` still
/// lights Langganan — the rule Router applies to a row's own path, applied to
/// the paths a row has adopted.
function litByHand(pathname: string, item: NavItem): boolean {
  return (
    item.alsoLights?.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    ) ?? false
  )
}

/// Nothing at zero, and nothing while the count is still `null`. A badge that
/// appears empty, or blinks on at every page load, teaches people to stop
/// reading it.
function Badge({
  value,
  tint,
}: {
  value: number | null | undefined
  tint?: "bad" | "warn"
}) {
  if (typeof value !== "number" || value <= 0) return null
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-[0.375rem] py-px text-[0.65625rem] font-semibold tabular-nums",
        tint === "bad" ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"
      )}
    >
      {count(value)}
    </span>
  )
}

/// The hook a row without a count calls. Asks nothing, subscribes to nothing.
function noCount(): null {
  return null
}

/// The hook a module without an audience calls. Asks nothing, subscribes to
/// nothing, and answers `null` — which every item without an `audience` is
/// unaffected by, and every item with one is hidden by. Ten of the eleven
/// modules are in exactly this position.
function noAudience(): null {
  return null
}
