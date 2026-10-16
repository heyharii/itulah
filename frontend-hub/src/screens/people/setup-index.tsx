import { ChevronRight } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { allNavItems } from "@/lib/navigation"
import { peopleSetupGroups } from "@/screens/people/nav"

/// HR › Setup: every setting on one page, in groups (owner, 2026-10-16,
/// `hr-doors-prototype.html`). Done once and then not thought about, so none
/// of it is a row of its own; each opens the screen it always was.
export function PeopleSetup() {
  return (
    <PageContent>
      <PageHeader title="Setup" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {peopleSetupGroups.map((group) => (
          <section
            key={group.label}
            className="self-start rounded-card border border-hairline p-1.5"
          >
            <h2 className="px-2.5 pt-2 pb-1 text-[0.9375rem] font-semibold text-body">
              {group.label}
            </h2>
            {group.paths.map((path) => {
              const item = allNavItems.find((one) => one.path === path)
              if (item === undefined) return null
              const Icon = item.icon
              return (
                <AppLink
                  key={path}
                  to={path}
                  className="flex h-11 items-center gap-3 rounded-inner px-2.5 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) hover:bg-soft"
                >
                  <Icon className="size-4 shrink-0 text-line-ico" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-line-ico" />
                </AppLink>
              )
            })}
          </section>
        ))}
      </div>
    </PageContent>
  )
}
