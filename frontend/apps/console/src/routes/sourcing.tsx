import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ApiError, Node, Sourcing, sourceCatalogue } from "@itulah/client";
import type { SourcedItem } from "@itulah/contract";

const sourcing = new Sourcing(new Node());
const catalogueKey = ["sourcing", "catalogue"] as const;

interface Wanted {
  readonly item: SourcedItem;
  readonly quantity: number;
}

/// What the company can buy, and from whom.
///
/// Browsing is only worth anything if it ends in an order, so the shortlist is
/// part of the screen rather than a place you go afterwards: the whole reason
/// this exists is that building a purchase order by retyping a supplier's own
/// codes is where the errors come from.
export function SourcingScreen() {
  const [needle, setNeedle] = useState("");
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [wanted, setWanted] = useState<readonly Wanted[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [destination, setDestination] = useState("dc");

  // Typing should not send a request per keystroke, and a debounce is four
  // lines. A dependency for it would be four lines of dependency.
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(needle), 180);
    return () => clearTimeout(timer);
  }, [needle]);

  const catalogue = useQuery({
    queryKey: [...catalogueKey, settled, supplierFilter] as const,
    queryFn: ({ signal }) =>
      sourceCatalogue(sourcing, { needle: settled, supplierId: supplierFilter }, signal),
    // Keeps the previous page on screen while the next one loads, so a search
    // does not blink through an empty state on every keystroke.
    placeholderData: (previous) => previous,
  });

  // The filter panel needs every supplier, not just those with a match — a
  // list that shrank as you typed would hide the one you were about to pick.
  const supplierList = useQuery({
    queryKey: ["suppliers", "active"],
    queryFn: ({ signal }) => sourcing.suppliers("ACTIVE", signal),
  });

  const rows = catalogue.data ?? [];

  const suppliers = supplierList.data ?? [];

  // Name and code matching happens at the server, where the data is. What is
  // left here is the one filter the server has no column for.
  const shown = useMemo(
    () =>
      // "Sudah dipetakan" means the supplier's product already answers to one
      // of our article codes. Unmapped is not a fault — a new product has no
      // code until head office gives it one when the goods arrive.
      onlyMapped ? rows.filter((row) => row.item.internal_article_code) : rows,
    [rows, onlyMapped],
  );

  const order = useMutation({
    mutationFn: () =>
      sourcing.orderFromCatalog({
        // The order needs a number somebody can quote down a phone line, and
        // somewhere to send the goods. Neither is something this screen may
        // invent quietly, so both are asked for.
        po_number: poNumber.trim(),
        supplier_id: wanted[0]?.item.supplier.supplier_id ?? "",
        destination_site_id: destination.trim(),
        notes: null,
        lines: wanted.map((line) => ({
          supplier_item_id: line.item.item.supplier_item_id,
          quantity: line.quantity,
          promised_date: null,
        })),
      }),
    onSuccess: () => {
      setWanted([]);
      setPoNumber("");
    },
  });

  // Every line of one order comes from one supplier: a purchase order is a
  // document sent to somebody, and two suppliers cannot both receive it.
  const suppliersInShortlist = new Set(wanted.map((line) => line.item.supplier.supplier_id));
  const mixed = suppliersInShortlist.size > 1;

  return (
    <main className="main">
      <div className="searchbar">
        <label className="searchbox inp">
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Cari nama, kode pemasok, atau nama pemasok"
            aria-label="Cari katalog sourcing"
            autoComplete="off"
          />
        </label>
        <span className="pill" data-tone="neutral">
          {shown.length} dari {rows.length}
        </span>
      </div>

      <div className="body">
        <aside className="filters" aria-label="Penyaring">
          <div className="fh">Pemasok</div>
          <div className="fgrp">
            <label className="opt">
              <input
                type="radio"
                name="supplier"
                checked={supplierFilter === null}
                onChange={() => setSupplierFilter(null)}
              />
              Semua
            </label>
            {suppliers.map((supplier) => (
              <label className="opt" key={supplier.supplier_id}>
                <input
                  type="radio"
                  name="supplier"
                  checked={supplierFilter === supplier.supplier_id}
                  onChange={() => setSupplierFilter(supplier.supplier_id)}
                />
                {supplier.name}
              </label>
            ))}
          </div>

          <div className="fh">Pemetaan</div>
          <div className="fgrp">
            <label className="opt">
              <input
                type="checkbox"
                checked={onlyMapped}
                onChange={(event) => setOnlyMapped(event.target.checked)}
              />
              Sudah punya kode artikel kita
            </label>
          </div>

          {/* The mockup also offers category, colour, MOQ and lead time. None
              of those exist on a supplier item in this system, so none are
              offered here: a filter that cannot filter is worse than an
              absent one. Adding them is server work, not screen work. */}
        </aside>

        <section className="results" aria-label="Hasil sourcing">
          <div className="sortbar">
            <span>Katalog pemasok</span>
            <span className="right">
              {catalogue.isFetching ? <span className="pill">Memuat…</span> : null}
            </span>
          </div>

          {catalogue.isPending ? (
            <div className="stack">
              <p>Memuat katalog…</p>
            </div>
          ) : catalogue.error ? (
            <div className="stack">
              <Problem error={catalogue.error} />
            </div>
          ) : shown.length === 0 ? (
            <div className="stack">
              <p className="empty">
                {rows.length === 0
                  ? "Belum ada pemasok aktif yang punya item. Daftarkan pemasok dan itemnya dulu."
                  : "Tidak ada yang cocok dengan penyaring ini."}
              </p>
            </div>
          ) : (
            <div className="grid">
              {shown.map((row) => (
                <Card
                  key={row.item.supplier_item_id}
                  row={row}
                  onWant={() =>
                    setWanted((current) =>
                      current.some(
                        (line) => line.item.item.supplier_item_id === row.item.supplier_item_id,
                      )
                        ? current
                        : [...current, { item: row, quantity: 1 }],
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>

        <aside className="shortlist" aria-label="Daftar beli">
          <div className="head">
            <b>Daftar beli</b>
            <span className="pill" data-tone="neutral">
              {wanted.length}
            </span>
          </div>
          <div className="lines">
            {wanted.length === 0 ? (
              <p className="empty" style={{ padding: "12px 14px" }}>
                Belum ada yang dipilih.
              </p>
            ) : (
              wanted.map((line) => (
                <div className="line" key={line.item.item.supplier_item_id}>
                  <span className="grow">
                    <span className="mono">{line.item.item.supplier_item_code}</span>
                    <br />
                    {line.item.item.name}
                  </span>
                  <input
                    className="inp inp-num"
                    inputMode="numeric"
                    aria-label={`Jumlah untuk ${line.item.item.name}`}
                    value={String(line.quantity)}
                    onChange={(event) =>
                      setWanted((current) =>
                        current.map((existing) =>
                          existing.item.item.supplier_item_id ===
                          line.item.item.supplier_item_id
                            ? {
                                ...existing,
                                quantity: Number.parseInt(
                                  event.target.value.replace(/\D/g, "") || "0",
                                  10,
                                ),
                              }
                            : existing,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() =>
                      setWanted((current) =>
                        current.filter(
                          (existing) =>
                            existing.item.item.supplier_item_id !==
                            line.item.item.supplier_item_id,
                        ),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="foot">
            <label className="f">
              <span>Nomor pesanan</span>
              <input
                className="inp mono"
                value={poNumber}
                onChange={(event) => setPoNumber(event.target.value)}
                placeholder="PO-2026-001"
              />
            </label>
            <label className="f">
              <span>Kirim ke</span>
              <input
                className="inp"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
            </label>
            {mixed ? (
              <p className="hint" role="alert">
                Satu pesanan hanya untuk satu pemasok — dokumen ini dikirim ke
                seseorang, dan dua pemasok tidak bisa sama-sama menerimanya.
              </p>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={
                wanted.length === 0 ||
                mixed ||
                order.isPending ||
                poNumber.trim() === "" ||
                destination.trim() === "" ||
                wanted.some((line) => line.quantity <= 0)
              }
              onClick={() => order.mutate()}
            >
              {order.isPending ? "Mengirim…" : "Buat pesanan"}
            </button>
            {order.error ? <Problem error={order.error} /> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Card({ row, onWant }: { row: SourcedItem; onWant: () => void }) {
  const { item, supplier } = row;
  return (
    <article className="item">
      <span className="thumb">
        {item.image_url ? <img src={item.image_url} alt="" /> : <span>tanpa gambar</span>}
      </span>
      <span className="body-txt">
        <span className="code mono">{item.supplier_item_code}</span>
        <span className="name">{item.name}</span>
        <span className="price">
          <b>{rupiah(item.unit_price_minor)}</b>
          <span className="dim">{item.currency}</span>
        </span>
        <span className="facts">
          {/* What our own catalogue calls it, when it has been decided. A
              supplier's product is not our article until head office says so,
              and that happens when the goods arrive — so most of these are
              empty and that is not a fault. */}
          {item.internal_article_code ? (
            <span className="chip mono">{item.internal_article_code}</span>
          ) : (
            <span className="chip">belum dipetakan</span>
          )}
          {item.status !== "ACTIVE" ? (
            <span className="pill" data-tone="orange">
              {item.status}
            </span>
          ) : null}
        </span>
        <span className="supplier">{supplier.name}</span>
        <span className="actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onWant}>
            Tambah ke daftar beli
          </button>
        </span>
      </span>
    </article>
  );
}

function rupiah(minor: number): string {
  return `Rp ${Math.abs(minor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function Problem({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Terjadi kesalahan yang tidak dikenali.";
  return (
    <p className="hint" role="alert">
      {message}
    </p>
  );
}
