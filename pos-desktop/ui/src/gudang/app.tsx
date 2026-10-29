/// Central Gudang's screen, after the door (`app.tsx`, edition `gudang`).
///
/// F1 Terima, F2 Ke toko, F3 Ke gudang, F4 Reject, F5 Kirim HO, F9 Cek stok,
/// F10 Riwayat, F12 simpan — the warehouse screen of
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
