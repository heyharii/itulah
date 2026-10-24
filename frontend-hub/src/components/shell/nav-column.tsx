import { RailPick } from "@/components/shell/rail-pick"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  ChevronRight,
  House,
  Search,
  X,
  type LucideIcon,
} from "lucide-react"
import {
  Fragment,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { BrandMark } from "@/components/brand-mark"
import { hasMattePicture, MattePicture } from "@/components/ui/matte-picture"
import { AccountOrb } from "@/components/shell/account-orb"
import { RailTip } from "@/components/ui/rail-tip"
import { officeFor } from "@/lib/apps"
import { count } from "@/lib/format"
import {
  domainForPath,
  domainHome,
  shownDomains,
  modulesOfDomain,
  moduleAllowed,
  moduleForPath,
  moreSections,
  primaryItems,
  shown,
  type AppDomain,
  type AppModule,
  type Audience,
  type NavItem,
  type NavSection,
} from "@/lib/navigation"
import { useIdentity, useSections } from "@/lib/session"
import { cn } from "@/lib/utils"
import { homeNav } from "@/screens/home/nav"

/// The dark rail: every department as an icon, the one you are in lit.
///
/// Option A of `sidebar-types-prototype.html` (owner, 2026-10-04): the
/// departments' icons alone down a charcoal strip, and the screens of the
/// department you are in in the light panel beside it (`sub-sidebar.tsx`) —
/// the shape the one column replaced on 2026-09-28, brought back now that the
/// owner wants the two answers apart again: which part of the business on the
/// rail, which screen of it on the panel.
///
/// Charcoal, in the rail's ramp (`--rail*`), so the sign-in door and the rail
/// are one material. A department with one screen is its icon alone; a count
/// rides its icon as a dot.
///
/// Two forms. DOCKED it is always the rail — the full-height icon strip. As a
/// DRAWER (under 64rem, `app-shell.tsx`) it is the old one column instead:
/// rows with their words, the department you are in opened beneath its row,
/// because a drawer has no panel to hold the screens and icons alone would be
/// a memory test.
export function NavColumn({
  folded = false,
  variant = "docked",
  onClose,
  onSearch,
  onToggleNav,
  panelOpen = true,
}: {
  folded?: boolean
  variant?: "docked" | "drawer"
  /// The drawer's close button. Absent when docked.
  onClose?: () => void
  onSearch: () => void
  /// Folds and unfolds the screens panel (⌘B) — the rail itself no longer
  /// folds. Docked only. The rail shows the button only while the panel is
  /// away; while it stands, its head carries the fold.
  onToggleNav?: () => void
  /// Whether the screens panel is standing beside the rail. A page with no
  /// panel (Home, the asides) counts as open: its rail top stays the brand.
  panelOpen?: boolean
}) {
  /// The panel is away and the rail's top must offer it back.
  const unfold = folded && onToggleNav !== undefined && !panelOpen
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const here = domainForPath(pathname)
  const active = moduleForPath(pathname)
  const role = useIdentity().data?.role
  const office = officeFor(role)
  const { sections, bypass } = useSections()

  const departments = office
    ? shownDomains.filter((domain) =>
        modulesOfDomain(domain).some(
          (module) => !module.hidden && moduleAllowed(module, sections, bypass)
        )
      )
    : []

  // The open department's row, kept in view: arriving at a Finance screen
  // from ⌘K should not leave the column scrolled to Procurement.
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    list.current
      ?.querySelector<HTMLElement>("[data-open-department]")
      ?.scrollIntoView({ block: "nearest" })
  }, [here?.id])
  // And the row you are on, once it is drawn: a department of two dozen rows
  // (Finance's Invoicing sidebar) runs past the fold, and a lit row below it
  // reads as a screen the menu does not have.
  useLayoutEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(
        'a[data-status="active"]:not([data-open-department]), a[aria-current="page"]:not([data-open-department])'
      )
      ?.scrollIntoView({ block: "nearest" })
  }, [pathname])

  const drawer = variant === "drawer"
  return (
    <nav
      aria-label="Navigation"
      className={cn(
        "shell-rail flex h-full shrink-0 flex-col bg-rail text-rail-text",
        folded ? "w-[4.25rem]" : "w-[15.5rem]",
        drawer && "max-w-[85vw]"
      )}
    >
      {/* The mark and the name, at the desk bar's height so the three lower
          edges — rail, panel, page — are one line across the window. It is
          the way home. With the panel folded away the mark gives its place
          to the button that brings the panel back: the rail itself does not
          fold any more, so the rail's only switch is the panel's. */}
      {/* The folded rail on a desk has no mark (owner, 14 Oct: "hapus logo c
          icon karna di laptop menunya ketutup"): the departments and the tools
          under them need the height on a laptop, and Home is a row of its
          own. Only the › that brings the panel back stands at its top, while
          the panel is folded away. The drawer keeps the mark and the name: it
          is the full column, with the room. */}
      {folded && onToggleNav ? (
        unfold && (
          <div className="flex shrink-0 justify-center px-2 pt-3">
            <button
              type="button"
              onClick={onToggleNav}
              aria-label="Show the screens"
              title="Show the screens  ⌘B"
              className="grid size-10 shrink-0 place-items-center rounded-[0.625rem] text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
            >
              <ChevronRight className="size-[1.125rem] stroke-[1.7]" />
            </button>
          </div>
        )
      ) : (
        <div
          className={cn(
            "flex h-13 shrink-0 items-center border-b border-rail-hair",
            folded ? "justify-center px-2" : "gap-1 px-3"
          )}
        >
          {!unfold && (
            <Link
              to="/"
              aria-label="Central — home"
              title={folded ? "Central" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-inner p-1 transition-colors hover:bg-rail-2",
                !folded && "flex-1"
              )}
            >
              <BrandMark className="size-7" />
              {!folded && (
                <b className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-rail-ink">
                  Central
                </b>
              )}
            </Link>
          )}
          {unfold && onToggleNav && (
            <button
              type="button"
              onClick={onToggleNav}
              aria-label="Show the screens"
              title="Show the screens  ⌘B"
              className="grid size-8 shrink-0 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
            >
              <ChevronRight className="size-[1.125rem] stroke-[1.7]" />
            </button>
          )}
          {drawer && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="grid size-tap shrink-0 place-items-center rounded-inner text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-ink"
            >
              <X className="size-[1.125rem] stroke-[1.7]" />
            </button>
          )}
        </div>
      )}

      {/* The palette, given a place to be found. ⌘K was the only way in, and
          since the owner's menu of 2026-09-28 moved most screens under More,
          "type where you want to go" is the shortest road to any of them.
          On a desk it is the top bar's "Find anything" instead. */}
      {/* Folded on a desk: Search stands at the top of the rail, the way to
          anywhere (hub-ui-patterns, 14 Oct) — ⌘K opens it too. */}
      {folded && onToggleNav && <RailFinders onSearch={onSearch} />}
      <div
        className={cn(
          "shrink-0 pt-3",
          folded ? "px-2" : "px-3",
          onToggleNav && "hidden"
        )}
      >
        <button
          type="button"
          onClick={onSearch}
          title={folded ? "Search  ⌘K" : undefined}
          aria-label="Search or jump to a screen"
          className={cn(
            "flex h-9 w-full items-center rounded-inner text-rail-mute shadow-[inset_0_0_0_1px_var(--rail-hair)] transition-colors hover:bg-rail-2 hover:text-rail-text",
            folded ? "justify-center" : "gap-2.5 px-2.5"
          )}
        >
          <Search className="size-4 shrink-0 stroke-[1.7]" />
          {!folded && (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-[0.9375rem]">
                Search or jump to…
              </span>
              <kbd className="font-sans text-[0.9375rem] text-rail-mute">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <div
        ref={list}
        className={cn(
          "flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto pt-3 pb-3 [&::-webkit-scrollbar]:hidden",
          folded ? "items-center px-2" : "px-3"
        )}
      >
        {!homeNav.hidden && (
          <DepartmentLink
            icon={House}
            art="home"
            label={homeNav.label}
            to="/"
            lit={active.id === homeNav.id}
            folded={folded}
          />
        )}
        {departments.map((domain, index) => (
          <div
            key={domain.id}
            className={cn(
              "flex flex-col",
              // A breath between Executive — the whole business read at
              // once — and the departments that are parts of it.
              index > 0 && departments[index - 1].id === "executive" && "mt-2"
            )}
          >
            <Department
              domain={domain}
              open={here?.id === domain.id}
              folded={folded}
              sections={sections}
              bypass={bypass}
              activeModule={active}
              pathname={pathname}
            />
          </div>
        ))}
      </div>

      {/* The rail's foot held chat, discussions, the bell, the profile and
          Sign out. They are the account orb now (`account-orb.tsx`, owner,
          2026-10-16), pinned here on a desk; undocked it floats. */}
      {!drawer && (
        <div className="flex shrink-0 justify-center pt-2 pb-4">
          <AccountOrb pinned />
        </div>
      )}
    </nav>
  )
}

/// A department: its row, and — when it is the one you are in — its screens
/// beneath it on a guide line, then the fold holding everything else it has.
function Department({
  domain,
  open,
  folded,
  sections,
  bypass,
  activeModule,
  pathname,
}: {
  domain: AppDomain
  open: boolean
  folded: boolean
  sections: ReturnType<typeof useSections>["sections"]
  bypass: boolean
  activeModule: AppModule
  pathname: string
}) {
  const modules = modulesOfDomain(domain).filter(
    (module) =>
      module.id === activeModule.id || moduleAllowed(module, sections, bypass)
  )
  const own = modules.flatMap((module) => primaryItems(module))
  const more =
    SHOW_MORE && modules.some((module) => moreSections(module).length > 0)
  // A department that is one screen is a link to that screen, not a folder
  // holding one row that repeats its own name. With More hidden, one whose
  // screens all sat under it is a link to its home too.
  const single = own.length <= 1 && !more
  // …unless its module brings a panel of its own (Stores): on a compact desk
  // a press on the rail still floats it.
  const ownPanel = modules.some((module) => module.sidebar === true)
  const Icon = domain.icon
  // The department you are in can be folded shut and opened again: pressing
  // its row while it is open folds it instead of navigating to its home. The
  // fold holds while you stay in it and is forgotten once you leave, so
  // coming back — a click, ⌘K, a link — finds it open.
  const [shut, setShut] = useState(false)
  if (!open && shut) setShut(false)
  const expanded = open && !shut

  const pick = useContext(RailPick)
  if (folded || single) {
    return (
      <DepartmentLink
        icon={Icon}
        art={domain.id}
        label={domain.label}
        to={domainHome(domain)}
        lit={open}
        folded={folded}
        openDepartment={open}
        onPick={
          pick !== null && (!single || ownPanel)
            ? () => pick(domain)
            : undefined
        }
        // Not on the department you are in: its count is on the screens in
        // the panel beside it (owner, 14 Oct).
        badge={folded && !open ? <DomainCount domain={domain} dot /> : undefined}
      />
    )
  }

  return (
    <>
      <Link
        to={domainHome(domain)}
        aria-expanded={expanded}
        data-open-department={open ? "" : undefined}
        onClick={(event) => {
          if (!open) return
          event.preventDefault()
          setShut(!shut)
        }}
        className={cn(
          "group flex h-9 shrink-0 items-center gap-3 rounded-inner px-2.5 text-[0.9375rem] transition-colors",
          open
            ? "font-medium text-rail-ink"
            : "text-rail-text hover:bg-rail-2 hover:text-rail-ink"
        )}
      >
        <Icon
          className={cn(
            "size-[1.125rem] shrink-0 stroke-[1.6] transition-colors",
            open ? "text-rail-ink" : "text-rail-mute group-hover:text-rail-text"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{domain.label}</span>
        {!expanded && <DomainCount domain={domain} />}
        <ChevronRight
          className={cn(
            "size-4 shrink-0 stroke-[1.7] text-rail-mute transition-transform duration-(--t-panel) ease-(--ease-out)",
            expanded && "rotate-90"
          )}
        />
      </Link>

      {expanded && (
        // Keyed on the department so its screens rise into place when it
        // opens (`nav-swap`), and are left alone when a row inside is clicked.
        <div
          key={domain.id}
          className="nav-swap mt-0.5 mb-2 ml-[1.1875rem] flex flex-col gap-px border-l border-rail-hair pl-2"
        >
          <DepartmentScreens modules={modules} pathname={pathname} />
        </div>
      )}
    </>
  )
}

/// The More fold is hidden for now (owner, 2026-09-29): every department
/// shows only its own rows. The screens under it still route, and are still
/// found through search; flip this to bring the fold back.
const SHOW_MORE = false

/// The two surfaces these rows are drawn on: the charcoal rail (and the
/// drawer, which is the rail's full-width form) and the light panel beside
/// it (`sub-sidebar.tsx`). One row logic, two palettes — the lit row, the
/// counts and the "not built yet" tag cannot be allowed to drift between the
/// two columns that show them.
export type Tone = "rail" | "panel"

const TONE = {
  rail: {
    row: "h-[2.125rem] rounded-[0.4375rem] text-rail-text hover:bg-rail-2 hover:text-rail-ink",
    on: "data-[status=active]:bg-rail-3 data-[status=active]:font-medium data-[status=active]:text-rail-ink",
    lit: "bg-rail-3 font-medium text-rail-ink",
    fold: "h-[2.125rem] rounded-[0.4375rem] hover:bg-rail-2 hover:text-rail-ink",
    foldOpen: "font-medium text-rail-ink",
    foldShut: "text-rail-text",
    chev: "text-rail-mute",
    soon: "h-[2.125rem] text-rail-mute/70",
    soonTag: "text-rail-mute/80 shadow-[inset_0_0_0_1px_var(--rail-hair)]",
    count: "text-rail-mute",
    countWarn: "bg-warn/20 text-[#f2c98a]",
    countBad: "bg-bad/20 text-[#ffa3a3]",
    divider: "border-rail-hair",
  },
  panel: {
    row: "h-9 rounded-inner text-body hover:bg-soft-2 hover:text-ink",
    on: "data-[status=active]:bg-accent-bg data-[status=active]:font-medium data-[status=active]:text-accent",
    lit: "bg-accent-bg font-medium text-accent",
    fold: "h-9 rounded-inner hover:bg-soft-2 hover:text-ink",
    foldOpen: "font-medium text-ink",
    foldShut: "text-body",
    chev: "text-mute",
    soon: "h-9 text-mute/70",
    soonTag: "text-mute/80 shadow-[inset_0_0_0_1px_var(--hairline)]",
    count: "text-mute",
    countWarn: "text-warn-fg",
    countBad: "text-bad-fg",
    divider: "border-hairline",
  },
} as const

/// What a department holds, in the order the owner's menu gives it: its own
/// rows, then the fold with everything else.
///
/// Exported for the phone, whose department sheet (`app-sheet.tsx`) draws
/// exactly these rows — so the phone and the desk cannot disagree about what
/// a department holds, which is the promise the sheet always made. The light
/// panel draws them too, in its own tone.
export function DepartmentScreens({
  modules,
  pathname,
  touch = false,
  tone = "rail",
}: {
  modules: readonly AppModule[]
  pathname: string
  /// Under a thumb: a size up, 15px type on 44px rows.
  touch?: boolean
  tone?: Tone
}) {
  const more =
    SHOW_MORE && modules.some((module) => moreSections(module).length > 0)
  return (
    <>
      {modules.map((module, index) => (
        <ModuleRows
          key={module.id}
          module={module}
          pathname={pathname}
          divider={module.divider === true && index > 0}
          touch={touch}
          tone={tone}
        />
      ))}
      {more && (
        <MoreFold
          modules={modules}
          pathname={pathname}
          grouped={modules.length > 1}
          touch={touch}
        />
      )}
    </>
  )
}

/// One module's own rows, flat — the owner's list reads as one column per
/// department, so section headings are for the More fold, not for these.
/// The exception is a section declared `fold` (Finance, since 2026-09-29): a
/// sub-menu, drawn as a heading that folds its rows.
function ModuleRows({
  module,
  pathname,
  divider,
  touch,
  tone,
}: {
  module: AppModule
  pathname: string
  divider: boolean
  touch: boolean
  tone: Tone
}) {
  const useAudience = module.useAudience ?? noAudience
  const audience = useAudience()
  if (primaryItems(module, audience).length === 0) return null
  return (
    <>
      {divider && (
        <hr
          className={cn("my-1.5 mr-2 border-0 border-t", TONE[tone].divider)}
        />
      )}
      <SectionRows
        sections={module.sections}
        module={module}
        audience={audience}
        pathname={pathname}
        touch={touch}
        tone={tone}
      />
    </>
  )
}

/// Sections as rows: a `fold` section as a heading over its rows, any other
/// flat.
function SectionRows({
  sections,
  module,
  audience,
  pathname,
  touch,
  tone,
}: {
  sections: readonly NavSection[]
  module: AppModule
  audience: Audience | null
  pathname: string
  touch: boolean
  tone: Tone
}) {
  const show = shown(audience)
  return (
    <>
      {sections.map((section, index) => {
        const rows = section.items.filter((item) => show(item) && !item.more)
        if (rows.length === 0) return null
        if (section.chip && section.label) {
          // A6 "Chip": the label as a grey chip, the rows always under it,
          // and a breath between groups.
          return (
            <div
              key={section.label}
              className="mt-[1.375rem] flex flex-col gap-px first:mt-0"
            >
              <span className="mb-1 ml-1.5 h-[1.375rem] self-start rounded-[0.375rem] bg-soft-2 px-2 text-[0.75rem] leading-[1.375rem] font-semibold whitespace-nowrap text-mute">
                {section.label}
              </span>
              {rows.map((item) => (
                <ScreenRow
                  key={item.path}
                  item={item}
                  module={module}
                  pathname={pathname}
                  touch={touch}
                  tone={tone}
                />
              ))}
            </div>
          )
        }
        if (section.fold && section.label) {
          return (
            <FoldGroup
              key={section.label}
              label={section.label}
              rows={rows}
              module={module}
              pathname={pathname}
              touch={touch}
              tone={tone}
            />
          )
        }
        return (
          <Fragment key={section.label ?? index}>
            {rows.map((item) => (
              <ScreenRow
                key={item.path}
                item={item}
                module={module}
                pathname={pathname}
                touch={touch}
                tone={tone}
              />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

/// A sub-menu: a labelled group of a department's own rows that folds.
///
/// Closed until you are inside it, so the department reads as its short list
/// of groups. An open or a close holds; arriving at one of its rows — from
/// ⌘K, a link, or the row itself — opens it again, so the row that is lit is
/// always a row you can see.
function FoldGroup({
  label,
  rows,
  module,
  pathname,
  touch,
  tone,
}: {
  label: string
  rows: readonly NavItem[]
  module: AppModule
  pathname: string
  touch: boolean
  tone: Tone
}) {
  const t = TONE[tone]
  const inside = rows.some(
    (item) =>
      here(pathname, item, module) ||
      (item.alsoLights?.some((path) => within(pathname, path)) ?? false)
  )
  // Where the choice was made, so moving INTO the group overrides a close
  // made elsewhere, while a close made on one of its own screens holds.
  const [choice, setChoice] = useState<{ open: boolean; at: string } | null>(
    null
  )
  const expanded =
    choice === null
      ? inside
      : inside && choice.at !== pathname
        ? true
        : choice.open
  const badged = rows.filter((item) => item.useCount !== undefined)

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setChoice({ open: !expanded, at: pathname })}
        className={cn(
          "flex shrink-0 items-center gap-2 px-2.5 text-[0.9375rem] transition-colors pointer-coarse:min-h-tap",
          t.fold,
          // Folded over the screen you are on: the heading stands in for the
          // row it hides.
          inside && !expanded ? t.foldOpen : t.foldShut,
          touch && ROW_TOUCH
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {!expanded &&
          badged.map((item) => (
            <ItemCount key={item.path} item={item} tone={tone} />
          ))}
        <ChevronRight
          className={cn(
            "size-4 shrink-0 stroke-[1.7] transition-transform duration-(--t-panel) ease-(--ease-out)",
            t.chev,
            expanded && "rotate-90"
          )}
        />
      </button>
      {expanded && (
        <div className="nav-swap flex flex-col gap-px pb-1 pl-3">
          {rows.map((item) => (
            <ScreenRow
              key={item.path}
              item={item}
              module={module}
              pathname={pathname}
              touch={touch}
              tone={tone}
            />
          ))}
        </div>
      )}
    </>
  )
}

/// One row's count, drawn somewhere other than on its row — on the heading
/// of the fold that hides it. A component so each row's hook is called by
/// its own element, never in a loop.
function ItemCount({ item, tone }: { item: NavItem; tone: Tone }) {
  const useCount = item.useCount ?? noCount
  return <Count value={useCount()} tint={item.badge} tone={tone} />
}

/// A department's own count, on its folded row — on the rail, as the dot.
/// A component so the hook is called by its own element, never in the
/// departments loop.
function DomainCount({ domain, dot }: { domain: AppDomain; dot?: boolean }) {
  const useCount = domain.useCount ?? noCount
  return <Count value={useCount()} tint={domain.badge} dot={dot} />
}

/// Everything a department has that is not one of its own rows: one click
/// further down, never gone. Opens by itself when the screen you are on is
/// inside it, so the row that is lit is always a row you can see.
function MoreFold({
  modules,
  pathname,
  grouped,
  touch,
}: {
  modules: readonly AppModule[]
  pathname: string
  grouped: boolean
  touch: boolean
}) {
  const inside = modules.some((module) =>
    moreSections(module).some((section) =>
      section.items.some((item) => here(pathname, item, module))
    )
  )
  // `null` until somebody presses it: until then the fold follows where you
  // are; after that it is theirs.
  const [choice, setChoice] = useState<boolean | null>(null)
  const expanded = choice ?? inside

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setChoice(!expanded)}
        className={cn(
          "mt-1 flex h-[2.125rem] shrink-0 items-center gap-2 rounded-[0.4375rem] px-2.5 text-[0.9375rem] text-rail-mute transition-colors hover:bg-rail-2 hover:text-rail-text pointer-coarse:min-h-tap",
          touch && ROW_TOUCH
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">More</span>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 stroke-[1.7] transition-transform duration-(--t-panel) ease-(--ease-out)",
            expanded && "rotate-90"
          )}
        />
      </button>
      {expanded && (
        <div className="nav-swap flex flex-col gap-px pb-1">
          {/* The department's first module needs no heading — its rows are
              the department's own ("Sales" over a row called Sales read
              twice). The others say whose rows follow: Stores, Members. */}
          {modules.map((module, index) => (
            <ModuleMore
              key={module.id}
              module={module}
              pathname={pathname}
              heading={grouped && index > 0 ? module.label : undefined}
              touch={touch}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ModuleMore({
  module,
  pathname,
  heading,
  touch,
}: {
  module: AppModule
  pathname: string
  heading?: string
  touch: boolean
}) {
  const useAudience = module.useAudience ?? noAudience
  const audience = useAudience()
  const groups = moreSections(module, audience)
  if (groups.length === 0) return null
  return (
    <>
      {groups.map((section, index) => {
        const label = section.label ?? (index === 0 ? heading : undefined)
        // A heading that only repeats the row under it ("Stores" over
        // Stores) is a hairline instead: the group still reads as a group.
        const echo =
          label !== undefined &&
          label.toLowerCase() === section.items[0]?.label.toLowerCase()
        return (
          <div key={section.label ?? index} className="flex flex-col gap-px">
            {label && !echo && (
              <span className="px-2.5 pt-2.5 pb-1 text-[0.9375rem] text-rail-mute">
                {label}
              </span>
            )}
            {echo && (
              <hr className="my-1.5 mr-2 border-0 border-t border-rail-hair" />
            )}
            {section.items.map((item) => (
              <ScreenRow
                key={item.path}
                item={item}
                module={module}
                pathname={pathname}
                touch={touch}
                tone="rail"
              />
            ))}
          </div>
        )
      })}
    </>
  )
}

function ScreenRow({
  item,
  module,
  pathname,
  touch,
  tone,
}: {
  item: NavItem
  module: AppModule
  pathname: string
  touch: boolean
  tone: Tone
}) {
  const t = TONE[tone]
  const useCount = item.useCount ?? noCount
  const badge = useCount()

  if (item.soon || module.soon) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label} — not built yet`}
        className={cn(
          "flex shrink-0 cursor-default items-center gap-2 px-2.5 text-[0.9375rem] pointer-coarse:min-h-tap",
          t.soon,
          touch && ROW_TOUCH
        )}
      >
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span
          className={cn("shrink-0 rounded-full px-1.5 leading-5", t.soonTag)}
        >
          Soon
        </span>
      </span>
    )
  }

  const exact =
    item.path === module.home ||
    item.path === module.base ||
    deeperRowHolds(pathname, item, module)
  const lit = item.alsoLights?.some((path) => within(pathname, path)) ?? false
  return (
    <Link
      to={item.path}
      activeOptions={{ exact }}
      aria-current={lit ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-2 px-2.5 text-[0.9375rem] transition-colors pointer-coarse:min-h-tap",
        t.row,
        t.on,
        lit && t.lit,
        touch && ROW_TOUCH
      )}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <Count value={badge} tint={item.badge} tone={tone} />
    </Link>
  )
}

/// A row that is one place: Home, a one-screen department.
/// Folded, it is the icon alone, with its name on hover and its count — when
/// it carries one — as the dot at its corner.
function DepartmentLink({
  icon: Icon,
  art,
  label,
  to,
  lit,
  folded,
  openDepartment = false,
  badge,
  onPick,
}: {
  icon: LucideIcon
  /// The department's matte picture, drawn instead of the line icon in the
  /// Soft style (`lib/look.ts`): in colour where you are, grey elsewhere.
  art?: string
  label: string
  to: string
  lit: boolean
  folded: boolean
  openDepartment?: boolean
  /// Replaces the walk to the department's home: its screens open beside the
  /// rail instead (compact desk).
  onPick?: () => void
  /// A count, as a rendered node rather than a value: its `useCount` hook
  /// belongs to the caller's element, never to a loop over these rows.
  badge?: ReactNode
}) {
  const matte = art !== undefined && hasMattePicture(art) ? art : null
  const link = (
    <Link
      to={to}
      onClick={
        onPick
          ? (event) => {
              event.preventDefault()
              onPick()
            }
          : undefined
      }
      aria-label={folded ? label : undefined}
      aria-current={lit ? "page" : undefined}
      data-open-department={openDepartment ? "" : undefined}
      className={cn(
        "group relative flex shrink-0 items-center rounded-inner text-[0.9375rem] transition-colors",
        folded ? "size-10 justify-center" : "h-9 gap-3 px-2.5",
        lit
          ? "bg-rail-3 font-medium text-rail-ink"
          : "text-rail-text hover:bg-rail-2 hover:text-rail-ink"
      )}
    >
      <Icon
        className={cn(
          "size-[1.125rem] shrink-0 stroke-[1.6] transition-colors",
          lit ? "text-rail-ink" : "text-rail-mute group-hover:text-rail-text",
          matte !== null && "look-now-only"
        )}
      />
      {matte !== null && (
        <MattePicture
          id={matte}
          tone={lit ? "colour" : "grey"}
          className="look-soft-only size-[1.625rem]"
        />
      )}
      {!folded && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {folded && badge}
    </Link>
  )
  return folded ? <RailTip label={label}>{link}</RailTip> : link
}

/// Search, at the top of the folded rail: a glass, a 40px square like the
/// departments under it. Ask AI stood under it and was taken off for now
/// (owner, 14 Oct: "ai jg hapus dulu deh"); ⌘J still opens the assistant.
function RailFinders({ onSearch }: { onSearch?: () => void }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2 px-2 pt-3">
      <RailTip label="Search  ⌘K">
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search or jump to a screen"
          className="grid size-10 place-items-center rounded-[0.625rem] text-rail-text transition-[color,background-color,scale] duration-(--t-press) ease-(--ease-out) hover:bg-rail-2 hover:text-rail-ink active:scale-[0.97]"
        >
          <Search className="size-[1.125rem] stroke-[1.6]" />
        </button>
      </RailTip>
    </div>
  )
}

function Count({
  value,
  tint,
  dot = false,
  tone = "rail",
}: {
  value: number | null | undefined
  /// `quiet`: a grey number with no pill (`NavItem.badge`).
  tint?: "bad" | "warn" | "quiet"
  /// The rail's shape of a count: no number at 44px wide, just the dot at the
  /// icon's corner — amber for a warning, red for a problem, blue otherwise.
  dot?: boolean
  tone?: Tone
}) {
  if (typeof value !== "number" || value <= 0) return null
  // What is waiting for somebody, said the same everywhere (UI-PATTERNS.md:
  // a strong red pill, a white number, 14px, none at zero, 99+ at most) —
  // at the corner of a rail icon, at the end of a screen's row.
  if (dot) {
    return (
      <span className="nav-badge nav-dot absolute -top-1 -right-1">
        {value > 99 ? "99+" : value}
      </span>
    )
  }
  const t = TONE[tone]
  return (
    <span
      data-quiet={tint === "quiet" ? "" : undefined}
      className={cn(
        "nav-count shrink-0 rounded-full px-1.5 text-[0.9375rem] leading-5 font-medium tabular-nums",
        tint === "bad" ? t.countBad : tint === "warn" ? t.countWarn : t.count
      )}
    >
      {value > 99 ? "99+" : count(value)}
    </span>
  )
}

/// A row under a thumb, in the phone's department sheet: 44px and 15px type,
/// the size every other list a phone opens here is drawn at.
const ROW_TOUCH = "min-h-11 px-3 text-[0.9375rem] rounded-[0.625rem]"

/// A path is inside a row when it is the row's path or below it.
function within(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`)
}

/// Whether the screen on show is this row's — exactly, for a row sitting at
/// its module's home or base. Every Finance path starts with `/finance`, so
/// read as a prefix, Finance's Home would claim every Finance screen and
/// hold a fold open on all of them.
function here(pathname: string, item: NavItem, module: AppModule): boolean {
  const exact =
    item.path === module.home ||
    item.path === module.base ||
    deeperRowHolds(pathname, item, module)
  return exact ? pathname === item.path : within(pathname, item.path)
}

/// Whether the screen on show belongs to another row of the module that sits
/// under this one's path — Dispatch at `/operations/despatch/trucks`, below
/// Surat jalan at `/operations/despatch`. Read as a prefix, the shorter row lit
/// up on the longer one's screen too, and the column said you were in two
/// places at once. The longest row wins; a record page under the shorter row
/// with no row of its own still lights it.
function deeperRowHolds(
  pathname: string,
  item: NavItem,
  module: AppModule
): boolean {
  return module.sections.some((section) =>
    section.items.some(
      (other) =>
        other.path.length > item.path.length &&
        within(other.path, item.path) &&
        within(pathname, other.path)
    )
  )
}

function noCount(): null {
  return null
}

function noAudience(): null {
  return null
}
