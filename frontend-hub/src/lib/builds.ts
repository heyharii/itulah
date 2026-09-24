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
/// than a description: "AC, lift, genset, instalasi" tells somebody which of
/// the fifty-nine they are about to be offered, which is the only question the
/// tile has to answer.
export const BUILDS: readonly {
  readonly value: AssetBuild
  readonly label: string
  readonly note: string
  readonly icon: LucideIcon
}[] = [
  { value: "LAND", label: "Tanah", note: "Tanah hak milik, HGB", icon: Map },
  {
    value: "BUILDING",
    label: "Bangunan",
    note: "Bangunan utama, tambahan, mess",
    icon: Building,
  },
  {
    value: "TECH",
    label: "Peralatan teknis",
    note: "Instalasi ME, AC, lift, eskalator, genset",
    icon: Cpu,
  },
  {
    value: "VEHICLE",
    label: "Kendaraan",
    note: "Mobil, sepeda motor",
    icon: Car,
  },
  {
    value: "FFE",
    label: "Furniture & fixtures",
    note: "Office, toko & gudang, interior, exterior, mess",
    icon: Armchair,
  },
  { value: "IT", label: "Perangkat IT", note: "Komputer, laptop, printer", icon: Monitor },
  { value: "AUDIO", label: "Audio / music", note: "Sound system", icon: Speaker },
  {
    value: "OE",
    label: "Operating equipment",
    note: "Rak, meja, manekin, hanger",
    icon: Box,
  },
  { value: "SOFTWARE", label: "Software", note: "Lisensi aplikasi", icon: AppWindow },
  { value: "DEFERRED", label: "Pre-opening", note: "Biaya dibayar di muka", icon: Clock },
  { value: "CIP", label: "Proyek / CIP", note: "Pekerjaan yang belum jadi aset", icon: Hammer },
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

/// The seven readings of the register that are not the sidebar's three.
///
/// Register · Software · Projects are how the MONEY is filed: plant,
/// intangibles, cost still becoming a thing. These are how the THINGS are
/// found — "show me the machines", "show me the vehicles" — and they are the
/// chips above the register plus a hidden route each, so a shop's facilities
/// person can bookmark the one they always want.
///
/// Seven and not eleven, because four of the eleven are the sidebar's own
/// three readings under other names: Software and Pre-opening are the
/// Software and Projects rows, and CIP is inside Projects. A chip that
/// duplicated a sidebar row would be two doors onto one room.
///
/// Property is the one view that is two builds: land and the buildings on it
/// are one question to a facilities person, and `asset_class` keeps them apart
/// because the chart charges them differently.
///
/// One list, read by the sidebar (for the routes), by the chips (for the
/// counts and the icons) and by the screen (for the filter), so the seven
/// cannot drift into being eight.
export const BUILD_VIEWS: readonly {
  readonly value: string
  readonly label: string
  readonly note: string
  readonly builds: readonly AssetBuild[]
  readonly icon: LucideIcon
}[] = [
  {
    value: "property",
    label: "Property",
    note: "Tanah, hak guna bangunan dan bangunan milik perusahaan. Mess yang disewa bukan aset: itu kontrak Sewa.",
    builds: ["LAND", "BUILDING"],
    icon: Building2,
  },
  {
    value: "technical",
    label: "Technical Equipment",
    note: "Instalasi ME, AC, lift, eskalator dan genset. Paling banyak dijadwalkan servis.",
    builds: ["TECH"],
    icon: Cpu,
  },
  {
    value: "vehicles",
    label: "Vehicles",
    note: "Mobil dan motor. STNK/KIR dan asuransinya ada di Contracts; servis dan BBM menunjuk aset ini.",
    builds: ["VEHICLE"],
    icon: Car,
  },
  {
    value: "ffe",
    label: "Furniture & Fixtures",
    note: "FFE office, toko & gudang, interior, exterior dan mess: satu build, dibedakan kelasnya.",
    builds: ["FFE"],
    icon: Armchair,
  },
  {
    value: "it",
    label: "IT Hardware",
    note: "Laptop, komputer, printer. Kelas client: FFE Komputer.",
    builds: ["IT"],
    icon: Monitor,
  },
  {
    value: "audio",
    label: "Audio / Music",
    note: "Sound system toko. Kelas client: FFE Music.",
    builds: ["AUDIO"],
    icon: Speaker,
  },
  {
    value: "oe",
    label: "Operating Equipment",
    note: "Rak, meja, manekin, hanger. Tidak disusutkan: diganti lewat replacement.",
    builds: ["OE"],
    icon: Box,
  },
]
