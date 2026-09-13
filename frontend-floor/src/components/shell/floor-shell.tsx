import { useQuery } from "@tanstack/react-query"
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import {
  ArrowLeft,
  KeyRound,
  LogOut,
  Menu,
  RefreshCw,
  Signal,
  Upload,
  UserRound,
} from "lucide-react"
import { useState } from "react"

import { Mark } from "@/components/shell/mark"
import { AppBar } from "@/components/ui/app-bar"
import { Chip } from "@/components/ui/button"
import { Drawer, DrawerItem, DrawerSection } from "@/components/ui/drawer"
import { Pill } from "@/components/ui/pill"
import { TabBar } from "@/components/ui/tab-bar"
import { useGo } from "@/lib/go"
import {
  pushedForPath,
  stations,
  tabForPath,
  tabs,
  titleForPath,
} from "@/lib/navigation"
import { unsentCount, useOutbox } from "@/lib/outbox"
import { reads } from "@/lib/queries"
import { useIdentity, useNodeIdentity, useSignOut } from "@/lib/session"
import { useWaiting } from "@/lib/waiting"
import { count } from "@/lib/format"
import { syncHealth } from "@itulah/contract/client"

/// The shell, and it is not the hub's.
///
/// No 58px icon rail and no 248px sidebar: this is the **phone expression** —
/// full-bleed, a three-zone app-bar, a floating squircle tab bar for the five
/// destinations, and a hamburger drawer for everything else.
///
/// Two rules govern the whole file:
///
///   - **A pushed detail hides the tab bar.** The left chip becomes a back arrow
///     and the five squircles go. That is what makes a count sheet something you
///     finish or leave deliberately rather than something a stray thumb wanders
///     out of.
///   - **Nothing darkens.** The drawer floats on the white veil; the content
///     behind it washes toward near-white and stays legible as a ghost.
export function FloorShell() {
  const router = useRouter()
  const go = useGo()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  const pushed = pushedForPath(pathname)
  const tab = tabForPath(pathname)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const goBack = () => {
    // History when there is history — the arrow should undo the tap that got
    // here. A cold reload on a pushed screen has none, and then the declared
    // parent is where the arrow lands, rather than nowhere.
    if (router.history.canGoBack()) router.history.back()
    else go(pushed?.back ?? "/tugas")
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas">
      <AppBar
        left={
          pushed === null ? (
            <Chip aria-label="Menu" onClick={() => setDrawerOpen(true)}>
              <Menu strokeWidth={1.7} />
            </Chip>
          ) : (
            <Chip aria-label="Kembali" onClick={goBack}>
              <ArrowLeft strokeWidth={1.7} />
            </Chip>
          )
        }
        title={titleForPath(pathname)}
        right={
          pushed === null ? (
            <Chip aria-label="Node ini" onClick={() => go("/node/sinkron")}>
              <UserRound strokeWidth={1.7} />
            </Chip>
          ) : undefined
        }
      />

      <Outlet />

      {/* The bar is drawn on every top-level screen, including the two stations
          that have no squircle of their own: somebody who has spent an hour at a
          tagging bench still has to be able to leave it with one thumb, and a
          station that hid the navigation would be a station they reload the app
          to get out of. Nothing is lit while they are there, which is the honest
          answer — they are not in any of the five. */}
      {pushed === null && (
        <TabBar items={tabs} activePath={tab?.path ?? null} />
      )}

      <FloorDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  )
}

/// Everything that is not one of the five destinations: the two stations worked
/// standing still, which node this is, whether it is getting through, and the two
/// things a person does to their own account.
function FloorDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const go = useGo()
  const identity = useIdentity()
  const where = useNodeIdentity()
  const signOut = useSignOut()
  const queue = useOutbox()
  const unsent = unsentCount(queue)
  const waiting = useWaiting()

  // The backlog, asked for only while the drawer is open. The sender's own cycle
  // is five seconds and polling faster only makes the screen busy without making
  // it more truthful.
  const backlog = useQuery({
    ...reads.syncStatus(),
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  })

  const health = backlog.data === undefined ? null : syncHealth(backlog.data)
  const person = identity.data ?? null

  // Closed where the navigation happens rather than in an effect watching the
  // path: a drawer left open across a navigation is a drawer covering the very
  // screen somebody just asked for.
  const leave = (to: string) => {
    onOpenChange(false)
    go(to)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Node ini">
      <div className="mb-4 flex items-center gap-3 rounded-card border border-hairline bg-soft px-3.5 py-3">
        <Mark className="h-9 w-8 shrink-0 text-line-ico" />
        <div className="min-w-0">
          <div className="truncate text-card-title font-semibold text-ink">
            {person?.display_name ?? "Masuk"}
          </div>
          <div className="truncate text-meta text-mute">
            {where.data === null || where.data === undefined
              ? "—"
              : `${where.data.node_role} · ${where.data.site_id ?? where.data.node_id}`}
          </div>
        </div>
      </div>

      <DrawerSection>Stasiun lain</DrawerSection>
      {stations.map((station) => {
        const Icon = station.icon
        const pending =
          station.path === "/tag" ? waiting.tagging : waiting.counts
        return (
          <DrawerItem
            key={station.path}
            icon={<Icon />}
            label={station.label}
            detail={pending === 0 ? "—" : count(pending)}
            onClick={() => leave(station.path)}
          />
        )
      })}

      <DrawerSection>Pusat</DrawerSection>
      <DrawerItem
        icon={<RefreshCw />}
        label="Sinkron"
        detail={
          health === null ? (
            "…"
          ) : (
            <Pill tone={SYNC_TONE[health]}>{SYNC_WORD[health]}</Pill>
          )
        }
        onClick={() => leave("/node/sinkron")}
      />
      <DrawerItem
        icon={<Upload />}
        label="Belum terkirim"
        detail={unsent === 0 ? "—" : count(unsent)}
        onClick={() => leave("/node/antrean")}
      />

      <DrawerSection>Akun Anda</DrawerSection>
      <DrawerItem
        icon={<KeyRound />}
        label="Ganti sandi"
        onClick={() => leave("/node/sandi")}
      />
      <DrawerItem
        icon={<LogOut />}
        label="Keluar"
        tone={unsent > 0 ? "bad" : "normal"}
        detail={unsent > 0 ? <Signal className="size-4 text-bad" /> : undefined}
        onClick={() => {
          // Signing out with work still on this device is worth one question.
          // The queue survives it — it is on disk, not in the session — but the
          // next person holding this phone will not know to look, and the work
          // will sit there until somebody does.
          if (
            unsent > 0 &&
            !window.confirm(
              `${count(unsent)} pekerjaan di HP ini belum sampai ke node. Semuanya tersimpan dan akan terkirim begitu jaringan kembali. Tetap keluar?`,
            )
          ) {
            return
          }
          signOut.mutate()
        }}
      />
    </Drawer>
  )
}

const SYNC_TONE = {
  current: "ok",
  behind: "warn",
  blocked: "bad",
  off: "neutral",
} as const

const SYNC_WORD = {
  current: "Terkini",
  behind: "Mengirim",
  blocked: "Macet",
  off: "Mati",
} as const
