import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";

import { Node, Till as TillClient, cacheKey } from "@itulah/client";
import { priceSource, rupiah } from "../money";

const till = new TillClient(new Node());

/// What this shop may sell, and for how much.
///
/// The same numbers the counter will charge — both come from the shared
/// pricing engine — so a cashier can answer "how much is this" without
/// scanning it, and be right.
export function CatalogScreen() {
  const [needle, setNeedle] = useState("");
  const catalog = useQuery({
    queryKey: cacheKey.catalog(),
    queryFn: ({ signal }) => till.catalog(signal),
  });

  const items = useMemo(() => {
    const rows = catalog.data?.items ?? [];
    const query = needle.trim().toLowerCase();
    if (query === "") {
      return rows;
    }
    return rows.filter(
      (item) =>
        item.sku_code.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query),
    );
  }, [catalog.data, needle]);

  const viewport = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewport.current,
    // A guess, corrected by measurement as rows render. Being wrong costs a
    // scrollbar that settles; not guessing costs nothing to render at all.
    estimateSize: () => 56,
    overscan: 8,
  });

  if (catalog.isPending) {
    return <p>Memuat katalog…</p>;
  }
  if (catalog.error) {
    return <p role="alert">{(catalog.error as Error).message}</p>;
  }
  // An empty catalogue has two very different causes, and telling them apart is
  // the difference between calling head office and calling whoever fixes the
  // network.
  if (!catalog.data?.has_price_book) {
    return (
      <p>
        Toko ini belum menerima buku harga. Barang tidak bisa dijual sampai buku
        harga sampai — hubungi pusat.
      </p>
    );
  }

  return (
    <main>
      <h1>Katalog</h1>
      <label htmlFor="cari">Cari</label>
      <input
        id="cari"
        value={needle}
        onChange={(event) => setNeedle(event.target.value)}
        placeholder="Kode atau nama"
        autoComplete="off"
      />
      <p>
        {items.length} dari {catalog.data.item_count} barang · buku harga v
        {catalog.data.publication_version ?? "?"}
      </p>
      {/* Only what fits on screen is rendered.
          
          This catalogue has been measured at forty thousand products, and
          forty thousand rows is not a slow screen — it is a browser that stops
          answering. The list stays whole; the rendering does not. */}
      <div ref={viewport} style={{ height: "70vh", overflow: "auto" }}>
        <div style={{ height: `${rows.getTotalSize()}px`, position: "relative" }}>
          {rows.getVirtualItems().map((row) => {
            const item = items[row.index];
            if (!item) {
              return null;
            }
            return (
              <div
                key={item.sku_code}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${row.size}px`,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <code>{item.sku_code}</code> · {item.name} ·{" "}
                <strong>{rupiah(item.unit_price_minor)}</strong> ·{" "}
                {priceSource(item.price_source)}
                {/* A was-price, but only when there is one: showing the same
                    number twice reads as a discount that is not there. */}
                {item.base_unit_price_minor !== item.unit_price_minor
                  ? ` · sebelumnya ${rupiah(item.base_unit_price_minor)}`
                  : null}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
