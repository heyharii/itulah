import { Link, useRouterState } from "@tanstack/react-router"

import {
  domainForPath,
  flatDomain,
  modulesOfDomain,
  moduleForPath,
  shown,
  type AppModule,
  type NavItem,
} from "@/lib/navigation"
import { reportsNav } from "@/screens/reports/nav"
import { systemNav } from "@/screens/system/nav"
import { cn } from "@/lib/utils"

/// The screens of the domain you are in, down the side.
///
/// ## Why this is not the module strip any more
///
/// It was: fourteen modules as icons, with a labelled column beside it holding
/// the screens of whichever one was open. Two columns of chrome, 56px plus
/// 248px, standing permanently in front of a table that is read across.
///
/// The bar across the top now answers *which part of the business*, so this
/// column answers only *which screen* — and one domain's screens are six or
/// eight rows, which is short enough to spell out. It keeps 64px of the window
/// and borrows the rest of its width only while somebody is pointing at it,
/// over the page rather than pushing it: a table that re-measures its columns
/// every time a sidebar opens is a table that flickers for a living.
///
/// ## What it does NOT do
///
/// It does not colour its rows per module, and it does not scroll away the
/// screen you are on. The asides at its foot — Reports, System — are the two
/// destinations that belong to no domain yet; they are drawn as a strip under
/// a rule rather than as rows, because they are not part of the answer the
/// column above is giving.
export function Rail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = moduleForPath(pathname)
  const domain = domainForPath(pathname)
  const owned = domain ? modulesOfDomain(domain) : [active]
  // A module names itself when its neighbours make the naming worth something.
  // GA's six modules hold one screen each and every heading was its own row's
  // word again — see `flatDomain`.
  const many = owned.length > 1 && !flatDomain(owned)

  return (
    <div className="relative z-30 w-16 shrink-0">
      <nav
        aria-label="Screens"
        className={cn(
          "group absolute inset-y-0 left-0 flex w-16 flex-col items-stretch gap-px overflow-x-hidden overflow-y-auto",
          "[scrollbar-width:none] border-r border-hairline bg-soft-3 px-2.5 pt-2.5 pb-3 [&::-webkit-scrollbar]:hidden",
          "transition-[width,box-shadow] duration-[--t-hover]",
          // The words arrive on hover, and on keyboard focus — a column that
          // only opens to a pointer is a column a keyboard cannot read.
          "focus-within:w-60 focus-within:shadow-pop hover:w-60 hover:shadow-pop",
          // A touch screen has no hover, so it never widens here: the labelled
          // column is one tap away in the drawer instead.
          "pointer-coarse:hover:w-16 pointer-coarse:hover:shadow-none"
        )}
      >
        {owned.map((module) => (
          <ModuleBlock
            key={module.id}
            module={module}
            pathname={pathname}
            named={many}
          />
        ))}

        <span className="mt-auto flex items-center gap-px border-t border-hairline pt-2.5">
          {[reportsNav, systemNav].map((aside) => (
            <AsideTile
              key={aside.id}
              module={aside}
              active={aside.id === active.id}
            />
          ))}
        </span>
      </nav>
    </div>
  )
}

/// One module's screens. The module names itself only when its domain holds
/// more than one that has anything to group — Selling carries three, Buying
/// carries one, GA carries six of one screen apiece and is drawn flat — and a
/// section names itself always, because those headings (Inventory's Audit,
/// Finance's Books) are the modules' own and were not invented here.
function ModuleBlock({
  module,
  pathname,
  named,
}: {
  module: AppModule
  pathname: string
  named: boolean
}) {
  const audience = module.useAudience?.() ?? null
  return (
    <>
      {named && <Heading level="module">{module.label}</Heading>}
      {module.sections.map((section, index) => {
        const items = section.items.filter(shown(audience))
        if (items.length === 0) return null
        return (
          <div key={section.label ?? index} className="contents">
            {section.label && (
              <Heading level={named ? "section" : "module"}>
                {section.label}
              </Heading>
            )}
            {items.map((item) => (
              <Row key={item.path} item={item} pathname={pathname} />
            ))}
          </div>
        )
      })}
    </>
  )
}

/// Headings are hidden rather than removed while the column is narrow: they
/// keep their height, so nothing below them jumps when the words arrive.
function Heading({
  level,
  children,
}: {
  level: "module" | "section"
  children: React.ReactNode
}) {
  return (
    <h3
      className={cn(
        "px-3.5 whitespace-nowrap text-mute transition-opacity duration-[--t-hover]",
        "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        level === "module"
          ? "mt-3.5 mb-1 text-[0.6875rem] font-semibold tracking-[0.05em] uppercase first:mt-0.5"
          : "mt-2.5 mb-0.5 text-[0.75rem] font-medium"
      )}
    >
      {children}
    </h3>
  )
}

function Row({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon
  const here = pathname === item.path || pathname.startsWith(item.path + "/")
  return (
    <Link
      to={item.path}
      title={item.label}
      aria-current={here ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-inner px-3.5 text-[0.8125rem] font-medium transition-colors",
        here
          ? "bg-accent-bg text-accent"
          : "text-text hover:bg-soft-2 hover:text-ink",
        "pointer-coarse:h-tap"
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 stroke-[1.6]",
          here ? "text-accent" : "text-line-ico"
        )}
      />
      <span className="min-w-0 flex-1 truncate opacity-0 transition-opacity duration-[--t-hover] group-focus-within:opacity-100 group-hover:opacity-100">
        {item.label}
      </span>
    </Link>
  )
}

/// The two destinations that belong to no domain, as icons at the foot.
function AsideTile({ module, active }: { module: AppModule; active: boolean }) {
  const Icon = module.icon
  return (
    <Link
      to={module.home}
      title={module.label}
      aria-label={module.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-inner transition-colors",
        active
          ? "bg-accent-bg text-accent"
          : "text-line-ico hover:bg-soft-2 hover:text-text",
        "pointer-coarse:size-tap"
      )}
    >
      <Icon className="size-[1.0625rem] stroke-[1.55]" />
    </Link>
  )
}
