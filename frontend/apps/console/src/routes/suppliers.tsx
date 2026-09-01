import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, Node, Sourcing } from "@itulah/client";
import type { Supplier } from "@itulah/contract";

const sourcing = new Sourcing(new Node());
const suppliersKey = ["suppliers"] as const;

/// Who the company buys from.
///
/// A supplier is a relationship, not a row to be deleted: one who is no longer
/// used still owns the history of everything ever bought from them, and a
/// purchase order from last year must still name somebody. So this screen can
/// stop and resume buying, and cannot remove.
export function SuppliersScreen() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Supplier | null>(null);
  const [adding, setAdding] = useState(false);

  const suppliers = useQuery({
    queryKey: suppliersKey,
    queryFn: ({ signal }) => sourcing.suppliers(undefined, signal),
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      sourcing.setSupplierActive(input.id, input.active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: suppliersKey });
    },
  });

  return (
    <main className="main">
      <div className="searchbar">
        <b style={{ flex: 1 }}>Pemasok</b>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          Pemasok baru
        </button>
      </div>

      <div className="stack">
        {suppliers.isPending ? <p>Memuat…</p> : null}
        {suppliers.error ? <Problem error={suppliers.error} /> : null}
        {suppliers.data ? (
          <table className="tw">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Kontak</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {suppliers.data.map((supplier) => (
                <tr className="trow" key={supplier.supplier_id}>
                  <td className="mono">{supplier.supplier_code}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => setOpen(supplier)}
                    >
                      {supplier.name}
                    </button>
                  </td>
                  <td>
                    {supplier.contact_name ?? <span className="nil">—</span>}
                    {supplier.phone ? ` · ${supplier.phone}` : ""}
                  </td>
                  <td>
                    <span
                      className="pill"
                      data-tone={supplier.status === "ACTIVE" ? "green" : "neutral"}
                    >
                      {supplier.status === "ACTIVE" ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={setActive.isPending}
                      onClick={() =>
                        setActive.mutate({
                          id: supplier.supplier_id,
                          active: supplier.status !== "ACTIVE",
                        })
                      }
                    >
                      {supplier.status === "ACTIVE" ? "Hentikan" : "Aktifkan"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {setActive.error ? <Problem error={setActive.error} /> : null}
      </div>

      {adding ? <NewSupplier onDone={() => setAdding(false)} /> : null}
      {open ? <SupplierItems supplier={open} onClose={() => setOpen(null)} /> : null}
    </main>
  );
}

function NewSupplier({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (values: { supplier_code: string; name: string; contact_name: string }) =>
      sourcing.createSupplier({
        supplier_code: values.supplier_code,
        name: values.name,
        contact_name: values.contact_name.trim() === "" ? null : values.contact_name,
        phone: null,
        email: null,
        address: null,
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: suppliersKey });
      onDone();
    },
  });

  const form = useForm({
    defaultValues: { supplier_code: "", name: "", contact_name: "" },
    onSubmit: ({ value }) => create.mutate(value),
  });

  return (
    <div className="scrim" onClick={onDone} role="presentation">
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <b>Pemasok baru</b>
        </div>
        <form
          className="sheet-body stack"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="supplier_code"
            validators={{
              // A courtesy. The server owns this rule and answers with its own
              // words; checking here only spares a round trip on an empty box.
              onChange: ({ value }) =>
                value.trim() === "" ? "Kode pemasok wajib diisi" : undefined,
            }}
          >
            {(field) => (
              <label className="f">
                <span>Kode pemasok</span>
                <input
                  className="inp mono"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors[0] ? (
                  <span className="hint" role="alert">
                    {String(field.state.meta.errors[0])}
                  </span>
                ) : null}
              </label>
            )}
          </form.Field>

          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => (value.trim() === "" ? "Nama wajib diisi" : undefined),
            }}
          >
            {(field) => (
              <label className="f">
                <span>Nama</span>
                <input
                  className="inp"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors[0] ? (
                  <span className="hint" role="alert">
                    {String(field.state.meta.errors[0])}
                  </span>
                ) : null}
              </label>
            )}
          </form.Field>

          <form.Field name="contact_name">
            {(field) => (
              <label className="f">
                <span>Nama kontak (opsional)</span>
                <input
                  className="inp"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </label>
            )}
          </form.Field>

          {create.error ? <Problem error={create.error} /> : null}
          <div className="sheet-foot">
            <button type="button" className="btn btn-secondary" onClick={onDone}>
              Batal
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SupplierItems({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const items = useQuery({
    queryKey: ["suppliers", supplier.supplier_id, "items"],
    queryFn: ({ signal }) => sourcing.items(supplier.supplier_id, signal),
  });

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div className="sheet sheet-wide" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <b>{supplier.name}</b>
          <span className="mono dim">{supplier.supplier_code}</span>
        </div>
        <div className="sheet-body stack">
          {items.isPending ? <p>Memuat item…</p> : null}
          {items.error ? <Problem error={items.error} /> : null}
          {items.data?.length === 0 ? (
            <p className="empty">Pemasok ini belum punya item.</p>
          ) : null}
          {items.data && items.data.length > 0 ? (
            <table className="tw">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Harga</th>
                  <th>Artikel kita</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.data.map((item) => (
                  <tr className="trow" key={item.supplier_item_id}>
                    <td className="mono">{item.supplier_item_code}</td>
                    <td>{item.name}</td>
                    <td className="den">
                      Rp{" "}
                      {item.unit_price_minor
                        .toString()
                        .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}
                    </td>
                    <td className="mono">
                      {item.internal_article_code ?? <span className="nil">belum</span>}
                    </td>
                    <td>
                      <span
                        className="pill"
                        data-tone={item.status === "ACTIVE" ? "green" : "neutral"}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
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
