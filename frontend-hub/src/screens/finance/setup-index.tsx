import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { ExpandingSearch } from "@/components/ui/list-chrome"
import { Toolbar } from "@/components/ui/segmented"
import { NoMatch } from "@/components/ui/states"
import { allNavItems } from "@/lib/navigation"
import { financeSetupGroups } from "@/screens/finance/nav"

/// Finance › Setup: every master on one page, in groups (owner, 2026-10-16,
/// `finance-final-prototype.html`). Done once and then not thought about, so
/// none of it is a row of its own; each opens the screen it always was.
export function FinanceSetup() {
  const [search, setSearch] = useState("")
  const needle = search.trim().toLowerCase()
  const groups = financeSetupGroups
    .map((group) => ({
      label: group.label,
      items: group.paths.flatMap((path) => {
        const item = allNavItems.find((one) => one.path === path)
        return item &&
          `${group.label} ${item.label}`.toLowerCase().includes(needle)
          ? [item]
          : []
      }),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <PageContent>
      <PageHeader title="Setup" />
      <Toolbar className="group/bar">
        <ExpandingSearch
          value={search}
          onChange={setSearch}
          label="Search setup"
        />
      </Toolbar>
      {groups.length === 0 && (
        <NoMatch what="setting" onClear={() => setSearch("")} />
      )}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <section
            key={group.label}
            aria-label={group.label}
            className="self-start overflow-hidden rounded-card border border-hairline"
          >
            <h2 className="border-b border-hairline px-4 py-3 text-[0.9375rem] font-semibold text-ink">
              {group.label}
            </h2>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <AppLink
                  key={item.path}
                  to={item.path}
                  className="flex min-h-12 items-center gap-3 border-b border-hairline px-4 py-3 text-[0.9375rem] text-ink transition-colors duration-(--t-hover) last:border-b-0 hover:bg-soft"
                >
                  <Icon className="size-4 shrink-0 text-line-ico" />
                  <span className="min-w-0 flex-1">{item.label}</span>
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
