import { Ambil } from "@/screens/ambil"
import { AmbilRonde } from "@/screens/ambil-ronde"
import { Kemas } from "@/screens/kemas"
import { KemasKoli } from "@/screens/kemas-koli"
import { KemasKotak } from "@/screens/kemas-kotak"
import { Kirim } from "@/screens/kirim"
import { KirimMuat } from "@/screens/kirim-muat"
import { NodeAntrean } from "@/screens/node-antrean"
import { NodeSandi } from "@/screens/node-sandi"
import { NodeSinkron } from "@/screens/node-sinkron"
import { Opname } from "@/screens/opname"
import { OpnameLembar } from "@/screens/opname-lembar"
import { Tag } from "@/screens/tag"
import { TagKerjaan } from "@/screens/tag-kerjaan"
import { Terima } from "@/screens/terima"
import { TerimaHitung } from "@/screens/terima-hitung"
import { TerimaPeriksa } from "@/screens/terima-periksa"
import { Tugas } from "@/screens/tugas"
import type { ScreenMap } from "@/screens/registry"

/// Path → screen. `routes.tsx` builds the router from `lib/navigation.ts` and
/// looks each path up here, and it throws at module load if either list has an
/// entry the other does not. Eighteen screens, eighteen nav entries, and no
/// placeholders: a station that opens on "belum dibuat" while a lorry is on the
/// bay is worse than no station at all.
export const screens: ScreenMap = {
  "/tugas": Tugas,
  "/terima": Terima,
  "/terima/hitung": TerimaHitung,
  "/terima/periksa": TerimaPeriksa,
  "/tag": Tag,
  "/tag/kerjaan": TagKerjaan,
  "/ambil": Ambil,
  "/ambil/ronde": AmbilRonde,
  "/kemas": Kemas,
  "/kemas/kotak": KemasKotak,
  "/kemas/koli": KemasKoli,
  "/kirim": Kirim,
  "/kirim/muat": KirimMuat,
  "/opname": Opname,
  "/opname/lembar": OpnameLembar,
  "/node/sinkron": NodeSinkron,
  "/node/antrean": NodeAntrean,
  "/node/sandi": NodeSandi,
}
