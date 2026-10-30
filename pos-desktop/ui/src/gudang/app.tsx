/// Central Gudang's screen, after the door (`app.tsx`, edition `gudang`).
///
/// ⇧1 Terima, ⇧2 Ke toko, ⇧3 Ke gudang, ⇧4 Reject, ⇧5 Kirim HO, ⇧9 Cek stok,
/// ⇧0 Riwayat, ⇧7 simpan — the warehouse screen of
/// `warehouse-app-prototype.html`, in `warehouse.tsx`, on the node's
/// `/api/v1/store/warehouse/*` routes (`backend/src/edge/warehouse.rs`) and the
/// store's own receipt and stock reads. There is no shift, no drawer and no
/// customer display: the node refuses this machine every selling call.

import { Warehouse } from "@/gudang/warehouse"

export function WarehouseApp({
  name,
  terminalId,
  onSignOut,
}: {
  /// The person signed in, by their full name when the node has one.
  name: string
  /// This PC as the node named it: "Gudang 1".
  terminalId: string
  onSignOut: () => void
}) {
  return <Warehouse name={name} terminalId={terminalId} onSignOut={onSignOut} />
}
