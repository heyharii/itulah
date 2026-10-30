/// The client's nine divisions (cloud 0382), by the name the floor uses — the
/// till's grid and Central Gudang's list say a division the same way.
const DIVISION_NAME: Readonly<Record<string, string>> = {
  WANITA: "Wanita", PRIA: "Pria", ANAK_LAKI: "Anak Laki-laki", ANAK_PEREMPUAN: "Anak Perempuan",
  PERLENGKAPAN_BAYI: "Perlengkapan Bayi", SANDAL_SEPATU: "Sandal dan Sepatu", TAS: "Tas",
  AKSESORIS: "Aksesoris", NON_DIVISI: "Non Divisi",
}

export const divisionName = (code: string | null | undefined) =>
  code ? (DIVISION_NAME[code] ?? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ")) : "—"
