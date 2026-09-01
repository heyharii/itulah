import {
  ClipboardCheckIcon,
  HouseIcon,
  InboxIcon,
  ListChecksIcon,
  PackageIcon,
  ScanLineIcon,
  TagIcon,
  TruckIcon,
} from "lucide-react"

import type { OperationCounts } from "@/lib/queries"

/// One taxonomy, two shells.
///
/// The same destinations in the same order appear as a rail from `md` up and
/// as a bottom bar below it. Two lists would become two taxonomies within a
/// month — somebody adds a screen to the rail, the handheld never gets it —
/// so there is one array and the shells only differ in how they draw it.
///
/// Every entry is an operation this DC node actually serves; nothing here is
/// a placeholder for a route the server has no endpoint behind.
export interface Destination {
  readonly to: string
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string }>
  /// What is waiting there. Drawn as a badge, and the reason the nav is worth
  /// looking at rather than merely worth clicking.
  readonly waiting: (counts: OperationCounts) => number
  /// Whether it earns one of the five slots on a handheld's bottom bar. The
  /// rest stay one tap away on the work queue, which is the home screen.
  readonly onTabBar?: boolean
}

export const DESTINATIONS: readonly Destination[] = [
  {
    to: "/",
    label: "Work",
    icon: HouseIcon,
    waiting: () => 0,
    onTabBar: true,
  },
  {
    to: "/receiving",
    label: "Receiving",
    icon: ClipboardCheckIcon,
    waiting: (counts) => counts.receipts + counts.awaitingVerification,
    onTabBar: true,
  },
  {
    to: "/tagging",
    label: "Tagging",
    icon: TagIcon,
    waiting: (counts) => counts.tagging,
  },
  {
    to: "/picking",
    label: "Picking",
    icon: ListChecksIcon,
    waiting: (counts) => counts.picklistLines,
    onTabBar: true,
  },
  {
    to: "/packing",
    label: "Packing",
    icon: PackageIcon,
    waiting: (counts) => counts.unsealedKoli,
    onTabBar: true,
  },
  {
    to: "/shipping",
    label: "Shipping",
    icon: TruckIcon,
    waiting: (counts) => counts.loose + counts.unshipped,
    onTabBar: true,
  },
  {
    to: "/counts",
    label: "Counts",
    icon: ScanLineIcon,
    waiting: (counts) => counts.openCounts,
  },
  {
    to: "/outbox",
    label: "Outbox",
    icon: InboxIcon,
    waiting: () => 0,
  },
]
