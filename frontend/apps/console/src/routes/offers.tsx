import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";

import { ApiError, Centre, Node } from "@itulah/client";

const centre = new Centre(new Node());

/// What one shop is selling, at that shop's own prices.
///
/// The same evaluator the till runs, which is the point: this is the screen a
/// merchandiser opens to check a price, so of all the places that could
/// disagree with a counter it is the worst. It used to read the price list and
/// nothing else — a garment on clearance showed here at its full price while
/// the shop charged the clearance.
export function OffersScreen() {
  const [site, setSite] = useState("store-01");
  const [asked, setAsked] = useState("store-01");

  const offers = useQuery({
    queryKey: ["commercial", "offers", asked],
    queryFn: ({ signal }) => centre.offers(asked, "STORE", signal),
  });

  const viewport = useRef<HTMLDivElement>(null);
  const items = offers.data?.items ?? [];
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 48,
    overscan: 8,
  });

  return (
    <main>
      <h1>Harga per toko</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setAsked(site.trim());
        }}
      >
        <label htmlFor="site">Toko</label>
        <input id="site" value={site} onChange={(event) => setSite(event.target.value)} />
        <button type="submit">Lihat</button>
      </form>

      {offers.isPending ? <p>Memuat…</p> : null}
      {offers.error ? <Problem error={offers.error} /> : null}
      {offers.data ? (
        <>
          <p>{offers.data.item_count} barang</p>
          <div ref={viewport} style={{ height: "70vh", overflow: "auto" }}>
            <div style={{ height: `${rows.getTotalSize()}px`, position: "relative" }}>
              {rows.getVirtualItems().map((row) => {
                const offer = items[row.index];
                if (!offer) {
                  return null;
                }
                return (
                  <div
                    key={offer.sku_code}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${row.size}px`,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <code>{offer.sku_code}</code> · {offer.article_name} ·{" "}
                    <strong>{offer.unit_price_minor.toLocaleString("id-ID")}</strong> ·{" "}
                    {offer.price_source}
                    {offer.markdown_id ? ` (${offer.markdown_id})` : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}

function Problem({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Terjadi kesalahan yang tidak dikenali.";
  return <p role="alert">{message}</p>;
}
