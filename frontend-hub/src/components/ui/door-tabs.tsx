import { useNavigate } from "@tanstack/react-router"
import { Check, ChevronDown } from "lucide-react"
import { useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { Select } from "@/components/ui/field"
import { SHEET_ROW } from "@/components/ui/list-chrome"
import { BottomSheet } from "@/components/ui/picker-sheet"
import { useDoorStatus } from "@/components/ui/door-status"
import { DoorHead, SubTabs } from "@/components/ui/sub-tabs"
import {
  doorTabsFor,
  type AppModule,
  type NavTab,
  type NavView,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The tabs of a door (`NavItem.tabs`), under its title on every screen the
/// door stands for, and the choice of view when the open tab has more than
/// one. Each tab and each view is a screen of its own with its own address,
/// so choosing one navigates: a link to "Payables › Due › Aging" is a link.
/// The rule under the tabs is the page head's own (`.page-head-door`).
///
/// On a phone the tab and the view are one button in the dock, in the thumb's
/// reach (owner, 2026-10-05: a chevron at the top of a tall phone was pressed
/// by nobody), and one sheet of every tab and view of the door — so the dock
/// carries one button for the door rather than one per row of choices (owner,
/// 2026-10-16: "supaya baris tombol bawahnya tidak penuh").
export function DoorTabs({
  module,
  title,
  tabs: every,
  tab: currentTab,
  view,
}: {
  /// Whose door: its `useAudience` says which tabs this person sees. Give the
  /// component a `key` of the module's id, so moving to another department's
  /// door calls that department's hook afresh.
  module: AppModule
  title: string
  tabs: readonly NavTab[]
  tab: NavTab
  view: NavView
}) {
  const audience = (module.useAudience ?? noAudience)()
  const tabs = doorTabsFor(every, audience)
  const tab = tabs.find((one) => one.label === currentTab.label) ?? currentTab
  const navigate = useNavigate()
  const go = (path: string) => void navigate({ to: path } as never)
  const shell = useDock()
  if (shell?.phone)
    return (
      <DoorChoice title={title} tabs={tabs} tab={tab} view={view} go={go} />
    )
  return (
    <div className="door-tabs flex flex-wrap items-end gap-x-4 gap-y-2">
      <DoorHead.Provider value>
        <SubTabs
          className="max-w-full min-w-0 flex-[1_1_max-content]"
          tabs={tabs.map((one) => ({ value: one.label, label: one.label }))}
          value={tab.label}
          onChange={(label) => {
            const next = tabs.find((one) => one.label === label)
            if (next) go(next.views[0].path)
          }}
        />
      </DoorHead.Provider>
      {tab.views.length > 1 && (
        <label className="mb-1.5 flex max-w-full shrink-0 items-center gap-2 text-[0.9375rem] text-mute">
          <span>View</span>
          <span className="w-56 max-w-full min-w-0">
            <Select aria-label={tab.label} value={view.path} onChange={go}>
              {tab.views.map((one) => (
                <option key={one.path} value={one.path}>
                  {one.label}
                </option>
              ))}
            </Select>
          </span>
        </label>
      )}
    </div>
  )
}

/// The door on a phone: the button says where you are — the tab, or the view
/// when it is not the tab's first ("Aging", not "Due") — and its sheet lists
/// the door's tabs, a tab of several views as a heading over them.
function DoorChoice({
  title,
  tabs,
  tab,
  view,
  go,
}: {
  title: string
  tabs: readonly NavTab[]
  tab: NavTab
  view: NavView
  go: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  // The list's own status, when the screen handed it over: said after the
  // tab once it is not the first ("BKK · Draft").
  const status = useDoorStatus()
  const chosen = status?.options.find((one) => one.value === status.value)
  const word =
    tab.views.length > 1 && view.path !== tab.views[0].path
      ? view.label
      : tab.label
  const here =
    status && chosen && status.value !== status.options[0]?.value
      ? `${word} · ${chosen.short ?? (typeof chosen.label === "string" ? chosen.label : "")}`
      : word
  const row = (one: NavView, label: string) => {
    const on = one.path === view.path
    return (
      <button
        key={one.path}
        type="button"
        aria-pressed={on}
        onClick={() => {
          setOpen(false)
          if (!on) go(one.path)
        }}
        className={cn(SHEET_ROW, on && "font-medium text-accent")}
      >
        <span className="flex-1">{label}</span>
        <Check className={cn("size-4 shrink-0", on ? "" : "opacity-0")} />
      </button>
    )
  }
  return (
    <>
      <DockPortal slot="tabs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${title}: ${here}`}
          // First in the dock whenever it mounts: a screen's own chips (a
          // month, a unit) can portal in before it.
          className="order-first inline-flex h-11 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-3 pl-4 text-[0.9375rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
        >
          <span className="truncate">{here}</span>
          <ChevronDown className="size-4 shrink-0 text-line-ico" />
        </button>
      </DockPortal>
      <BottomSheet open={open} onOpenChange={setOpen} title={title}>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
          {tabs.map((one) =>
            one.views.length === 1 ? (
              row(one.views[0], one.label)
            ) : (
              <section key={one.label} aria-label={one.label}>
                <h3 className="px-3 pt-3 pb-1 text-[0.9375rem] font-semibold text-mute">
                  {one.label}
                </h3>
                {one.views.map((each) => row(each, each.label))}
              </section>
            )
          )}
          {status && (
            <section aria-label={status.title}>
              <h3 className="px-3 pt-3 pb-1 text-[0.9375rem] font-semibold text-mute">
                {status.title === "Status" ? `${word} status` : status.title}
              </h3>
              {status.options.map((one) => {
                const on = one.value === status.value
                return (
                  <button
                    key={one.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setOpen(false)
                      if (!on) status.onChange(one.value)
                    }}
                    className={cn(SHEET_ROW, on && "font-medium text-accent")}
                  >
                    <span className="flex-1">{one.label}</span>
                    {one.count !== undefined && (
                      <span className="text-mute tabular-nums">
                        {one.count}
                      </span>
                    )}
                    <Check
                      className={cn("size-4 shrink-0", on ? "" : "opacity-0")}
                    />
                  </button>
                )
              })}
            </section>
          )}
        </div>
      </BottomSheet>
    </>
  )
}

function noAudience(): null {
  return null
}
