import {
  AppWindow,
  Armchair,
  Box,
  Building,
  Building2,
  Car,
  Clock,
  Cpu,
  Hammer,
  Map,
  Monitor,
  Speaker,
  type LucideIcon,
} from "lucide-react"

import type { SheetSearch } from "@/lib/sheets"

/// The eleven shapes a thing the company owns can come in.
///
/// # Why a build and not a class
///
/// The register has fifty-nine classes, because the client's own chart has
/// fifty-nine — thirty-six of them racks, hangers, mannequins and the rest of
/// the shopfitting. Four of those classes are air conditioners, lifts,
/// escalators and gensets: four sets of ACCOUNTS and one FORM. Asking somebody
/// filling one in to choose between four AC-shaped forms would be asking them a
/// question the business does not have; asking them to fill in one generic form
/// would be asking for the warranty date of a curtain rail.
///
/// So the class decides the accounts (Finance's `account_map`, keyed by
/// `class_code`) and the build decides what is written down. `asset_class.build`
/// is the server's answer and this file is only its drawing — see migration
/// 0356 for the mapping and for why the list is exactly these eleven.
///
/// # Why the icon is here and not on the class
///
/// Because there are eleven icons and fifty-nine classes, and an icon per class
/// would be thirty-six near-identical boxes. What the eye needs on a list of
/// assets is "that one is a vehicle, that one is a machine, that one is
/// furniture", which is the build.
export type AssetBuild =
  | "LAND"
  | "BUILDING"
  | "TECH"
  | "VEHICLE"
  | "FFE"
  | "IT"
  | "AUDIO"
  | "OE"
  | "SOFTWARE"
  | "DEFERRED"
  | "CIP"

/// The eleven, in the order the picker offers them: the things a company owns
/// first — land, the building, the machines, the vehicles — then what it
/// furnishes them with, then the things that are not physical at all.
///
/// `note` is what the tile says under the name, and it is the CLASSES rather
/// than a description: "AC, lift, genset, installations" tells somebody which
/// of the fifty-nine they are about to be offered, which is the only question
/// the tile has to answer.
export const BUILDS: readonly {
  readonly value: AssetBuild
  readonly label: string
  readonly note: string
  readonly icon: LucideIcon
}[] = [
  { value: "LAND", label: "Land", note: "Freehold land, HGB", icon: Map },
  {
    value: "BUILDING",
    label: "Building",
    note: "Main buildings, extensions, staff housing",
    icon: Building,
  },
  {
    value: "TECH",
    label: "Technical equipment",
    note: "M&E installations, AC, lifts, escalators, gensets",
    icon: Cpu,
  },
  {
    value: "VEHICLE",
    label: "Vehicle",
    note: "Cars, motorcycles",
    icon: Car,
  },
  {
    value: "FFE",
    label: "Furniture & fixtures",
    note: "Office, store & warehouse, interior, exterior, staff housing",
    icon: Armchair,
  },
  {
    value: "IT",
    label: "IT hardware",
    note: "Computers, laptops, printers",
    icon: Monitor,
  },
  {
    value: "AUDIO",
    label: "Audio / music",
    note: "Sound systems",
    icon: Speaker,
  },
  {
    value: "OE",
    label: "Operating equipment",
    note: "Racks, tables, mannequins, hangers",
    icon: Box,
  },
  {
    value: "SOFTWARE",
    label: "Software",
    note: "Application licences",
    icon: AppWindow,
  },
  {
    value: "DEFERRED",
    label: "Pre-opening",
    note: "Costs paid in advance",
    icon: Clock,
  },
  {
    value: "CIP",
    label: "Project / CIP",
    note: "Work that is not an asset yet",
    icon: Hammer,
  },
]

/// One build's entry, for the many places that need one of its three answers —
/// its icon in a cell, its name under an asset, its note on a tile.
///
/// A record whose class is missing from the server's list answers with CIP
/// rather than `undefined`: a blank cell reads as a row that failed to load,
/// and a hammer reads as a thing still being built, which is the closest honest
/// answer for a class the register does not know.
export function buildOf(build: string | undefined | null) {
  return (
    BUILDS.find((one) => one.value === build) ??
    BUILDS[BUILDS.length - 1] /* CIP */
  )
}

/// What GA registers. Pre-opening and Contract in Progress are not things GA
/// receives: they are what Finance makes of a project's cost when it
/// capitalises it (0997), so the register form never offers them.
export const NOT_REGISTERED_BY_GA: readonly string[] = ["DEFERRED", "CIP"]

/// The readings of the register, drawn as the chips above it.
///
/// Seven are how the THINGS are found — "show me the machines", "show me the
/// vehicles" — and the last two are the groups that are not plant at all:
/// Software is the licences, Projects the cost still becoming a thing
/// (pre-opening and work in progress). Those two were sidebar rows until
/// 2026-09-27; the owner asked for a shorter menu, and they were never more
/// than the same register narrowed by build, so they are chips like the rest.
///
/// Property is the one view that is two builds: land and the buildings on it
/// are one question to a facilities person, and `asset_class` keeps them apart
/// because the chart charges them differently.
///
/// `value` is the `asset-view` search parameter, typed against the list
/// `lib/sheets.ts` accepts, so a chip cannot name a reading the URL would drop.
/// One list, read by the chips (for the counts and the icons), by the screen
/// (for the filter) and by the composer (for which builds it offers).
export const BUILD_VIEWS: readonly {
  readonly value: NonNullable<SheetSearch["asset-view"]>
  readonly label: string
  readonly note: string
  readonly builds: readonly AssetBuild[]
  readonly icon: LucideIcon
}[] = [
  {
    value: "property",
    label: "Property",
    note: "Land, building rights and buildings the company owns. Rented staff housing is not an asset: it is a lease contract.",
    builds: ["LAND", "BUILDING"],
    icon: Building2,
  },
  {
    value: "technical",
    label: "Technical",
    note: "M&E installations, AC, lifts, escalators and gensets. The most scheduled for servicing.",
    builds: ["TECH"],
    icon: Cpu,
  },
  {
    value: "vehicles",
    label: "Vehicles",
    note: "Cars and motorcycles. Registration (STNK/KIR) and insurance are in Contracts; servicing and fuel point at the asset.",
    builds: ["VEHICLE"],
    icon: Car,
  },
  {
    value: "ffe",
    label: "Furniture & fixtures",
    note: "Office, store & warehouse, interior, exterior and staff housing FF&E: one build, told apart by class.",
    builds: ["FFE"],
    icon: Armchair,
  },
  {
    value: "it",
    label: "IT hardware",
    note: "Laptops, computers, printers. Client class: FFE Komputer.",
    builds: ["IT"],
    icon: Monitor,
  },
  {
    value: "audio",
    label: "Audio",
    note: "Store sound systems. Client class: FFE Music.",
    builds: ["AUDIO"],
    icon: Speaker,
  },
  {
    value: "oe",
    label: "Operating equipment",
    note: "Racks, tables, mannequins, hangers. Not depreciated: replaced through a replacement.",
    builds: ["OE"],
    icon: Box,
  },
  {
    value: "software",
    label: "Software",
    note: "Licences and software the company uses.",
    builds: ["SOFTWARE"],
    icon: AppWindow,
  },
  {
    // Not "Projects" any more: that is GA's own menu since 0997. What is
    // read here is the cost Finance keeps as work in progress or Pre-opening.
    value: "projects",
    label: "Work in progress",
    note: "Pre-opening and Contract in Progress, kept by Finance.",
    builds: ["DEFERRED", "CIP"],
    icon: Hammer,
  },
]
