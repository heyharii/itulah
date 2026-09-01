import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { ApiError, Node, Till as TillClient, cacheKey } from "@itulah/client";
import type { SaleResult } from "@itulah/contract";
import { priceSource, rupiah } from "../money";

const node = new Node();
const till = new TillClient(node);

/// One scan, before it is priced.
///
/// A basket holds tags, not prices. What each one costs is settled by the
/// server when the sale is rung up, because a promotion is a statement about
/// the whole basket — the item that completes "buy two" changes what the first
/// one costs. A till that showed a per-line price as it scanned would be
/// promising a number it cannot keep.
interface Scanned {
  readonly epc: string;
}

export function SellScreen() {
  const queryClient = useQueryClient();
  const [basket, setBasket] = useState<readonly Scanned[]>([]);
  const [epc, setEpc] = useState("");
  const [cash, setCash] = useState("");
  const [receipt, setReceipt] = useState<SaleResult | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);

  const identity = useQuery({
    queryKey: cacheKey.identity(),
    queryFn: ({ signal }) => node.identity({ signal }),
  });

  const catalog = useQuery({
    queryKey: cacheKey.catalog(),
    queryFn: ({ signal }) => till.catalog(signal),
  });

  /// The shelf price of everything, by tag-less product code.
  ///
  /// Used only to show the cashier what a scanned item is. It is not what the
  /// sale is charged at — that comes back from the server, priced as a basket.
  const shelf = useMemo(() => {
    const byCode = new Map<string, { name: string; unit_price_minor: number }>();
    for (const item of catalog.data?.items ?? []) {
      byCode.set(item.sku_code, {
        name: item.name,
        unit_price_minor: item.unit_price_minor,
      });
    }
    return byCode;
  }, [catalog.data]);

  const sale = useMutation({
    mutationFn: (paid: number) =>
      till.completeSale({
        epcs: basket.map((line) => line.epc),
        cash_minor: paid,
        actor_id: "kasir",
        idempotency_key: crypto.randomUUID(),
        coupon_codes: [],
        customer_id: null,
      }),
    onSuccess: (result) => {
      setReceipt(result);
      setBasket([]);
      setCash("");
      // The floor has changed, so anything that counts it is now wrong.
      void queryClient.invalidateQueries({ queryKey: cacheKey.pools() });
      scanInput.current?.focus();
    },
  });

  const scan = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const tag = epc.trim().toUpperCase();
      if (tag === "") {
        return;
      }
      // The same tag twice is a double read, not two garments: one physical
      // thing carries one EPC. Refusing it here saves a refusal at the server
      // and tells the cashier immediately.
      if (basket.some((line) => line.epc === tag)) {
        setEpc("");
        return;
      }
      setBasket((current) => [...current, { epc: tag }]);
      setEpc("");
      setReceipt(null);
    },
    [basket, epc],
  );

  const paid = Number.parseInt(cash, 10);
  const canComplete = basket.length > 0 && Number.isFinite(paid) && paid > 0;

  return (
    <main>
      <header>
        <h1>Kasir</h1>
        <Status identity={identity} catalog={catalog} />
      </header>

      <form onSubmit={scan}>
        <label htmlFor="epc">Pindai tag</label>
        <input
          id="epc"
          ref={scanInput}
          value={epc}
          onChange={(event) => setEpc(event.target.value)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="EPC"
        />
        <button type="submit">Tambah</button>
      </form>

      <section>
        <h2>Keranjang ({basket.length})</h2>
        {basket.length === 0 ? (
          <p>Belum ada barang. Pindai tag untuk memulai.</p>
        ) : (
          <ol>
            {basket.map((line, index) => {
              const known = shelf.get(line.epc);
              return (
                <li key={line.epc}>
                  <code>{line.epc}</code>
                  {known ? ` · ${known.name}` : null}
                  <button
                    type="button"
                    onClick={() =>
                      setBasket((current) => current.filter((_, at) => at !== index))
                    }
                  >
                    Hapus
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {/* No running total. What the basket comes to is the server's answer,
            and showing a sum of shelf prices here would be a different number
            the moment a promotion applies. */}
      </section>

      <section>
        <h2>Bayar</h2>
        <label htmlFor="cash">Tunai diterima</label>
        <input
          id="cash"
          inputMode="numeric"
          value={cash}
          onChange={(event) => setCash(event.target.value.replace(/\D/g, ""))}
          placeholder="0"
        />
        <button
          type="button"
          disabled={!canComplete || sale.isPending}
          onClick={() => sale.mutate(paid)}
        >
          {sale.isPending ? "Memproses…" : "Selesaikan"}
        </button>
        {sale.error ? <Problem error={sale.error} /> : null}
      </section>

      {receipt ? <Receipt receipt={receipt} /> : null}
    </main>
  );
}

function Status({
  identity,
  catalog,
}: {
  identity: ReturnType<typeof useQuery<Awaited<ReturnType<Node["identity"]>>>>;
  catalog: ReturnType<typeof useQuery<Awaited<ReturnType<TillClient["catalog"]>>>>;
}) {
  if (identity.isPending) {
    return <p>Menghubungi kasir…</p>;
  }
  if (identity.error) {
    return <Problem error={identity.error} />;
  }
  const node = identity.data;
  if (node && node.role !== "STORE") {
    // A till pointed at a warehouse should say so rather than offer buttons
    // that will be refused.
    return <p>Node ini {node.role}, bukan toko — kasir tidak bisa jalan di sini.</p>;
  }
  return (
    <p>
      {node?.site_id}
      {catalog.data
        ? catalog.data.has_price_book
          ? ` · buku harga v${catalog.data.publication_version ?? "?"} · ${catalog.data.item_count} barang`
          : " · belum menerima buku harga"
        : null}
    </p>
  );
}

/// A failure, said in the server's own words.
///
/// The server writes its refusals for an operator — "that coupon has been used
/// already", "no price for SKU1 at store-01" — so they are shown as written
/// rather than replaced with a generic apology that tells nobody anything.
function Problem({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Terjadi kesalahan yang tidak dikenali.";
  return <p role="alert">{message}</p>;
}

function Receipt({ receipt }: { receipt: SaleResult }) {
  const applied = (receipt.promotions ?? []).filter((promotion) => promotion.applied);
  const refused = (receipt.promotions ?? []).filter((promotion) => !promotion.applied);
  return (
    <section>
      <h2>Selesai</h2>
      <dl>
        <dt>Total</dt>
        <dd>{rupiah(receipt.total_minor)}</dd>
        <dt>Dibayar</dt>
        <dd>{rupiah(receipt.paid_minor)}</dd>
        <dt>Kembali</dt>
        <dd>{rupiah(receipt.change_minor)}</dd>
      </dl>

      {applied.length > 0 ? (
        <>
          <h3>Promo</h3>
          <ul>
            {applied.map((promotion) => (
              <li key={promotion.rule_id}>
                {promotion.name} · −{rupiah(promotion.benefit_minor)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* Why a promotion did NOT come off is the question a cashier is
          actually asked, and the server answers it. Hiding that leaves them
          shrugging at a customer. */}
      {refused.length > 0 ? (
        <>
          <h3>Promo yang tidak berlaku</h3>
          <ul>
            {refused.map((promotion) => (
              <li key={promotion.rule_id}>
                {promotion.name} — {promotion.reason ?? "tanpa keterangan"}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {receipt.granted_lines && receipt.granted_lines.length > 0 ? (
        <>
          <h3>Barang gratis — pindai sekarang</h3>
          {/* Reported, never conjured: the goods only leave the shop by being
              scanned, so the cashier is prompted rather than the stock quietly
              adjusted. */}
          <ul>
            {receipt.granted_lines.map((line) => (
              <li key={line.sku_code}>
                {line.quantity} × {line.sku_code} ({priceSource("MARKDOWN")}:{" "}
                {rupiah(line.value_minor)})
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {receipt.points_earned > 0 ? <p>Poin: {receipt.points_earned}</p> : null}
    </section>
  );
}
