import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, Node, Warehouse } from "@itulah/client";

const warehouse = new Warehouse(new Node());
const picklistKey = ["dc", "picklist"] as const;

/// The picker's sheet: a SKU and a number, and no destination at all.
///
/// Which shop each piece serves is settled when it goes into a box, not when
/// it comes off the rack. Deciding earlier means goods stranded under a
/// cancelled allotment that somebody has to move before anyone else can use
/// them.
export function PickScreen() {
  const queryClient = useQueryClient();
  const [taking, setTaking] = useState<Record<string, string>>({});

  const sheet = useQuery({
    queryKey: picklistKey,
    queryFn: ({ signal }) => warehouse.picklist(signal),
  });

  const pick = useMutation({
    mutationFn: (input: { sku: string; quantity: number }) =>
      warehouse.pick({
        source_pool_id: "dc.warehouse",
        sku_code: input.sku,
        quantity: input.quantity,
        actor_id: "picker",
        idempotency_key: crypto.randomUUID(),
        pick_session_id: null,
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: picklistKey });
    },
  });

  if (sheet.isPending) {
    return <p>Memuat picklist…</p>;
  }
  if (sheet.error) {
    return <Problem error={sheet.error} />;
  }

  const lines = sheet.data?.lines ?? [];
  if (lines.length === 0) {
    return (
      <main>
        <h1>Picking</h1>
        <p>Tidak ada yang perlu diambil.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Picking</h1>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Sisa diminta</th>
            <th>Diambil</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.sku_code}>
              <td>
                <code>{line.sku_code}</code>
              </td>
              <td>{line.outstanding}</td>
              <td>
                <input
                  inputMode="numeric"
                  aria-label={`Jumlah diambil untuk ${line.sku_code}`}
                  value={taking[line.sku_code] ?? ""}
                  onChange={(event) =>
                    setTaking((current) => ({
                      ...current,
                      [line.sku_code]: event.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  disabled={pick.isPending}
                  onClick={() => {
                    const quantity = Number.parseInt(taking[line.sku_code] ?? "", 10);
                    if (Number.isFinite(quantity) && quantity > 0) {
                      pick.mutate({ sku: line.sku_code, quantity });
                      setTaking((current) => ({ ...current, [line.sku_code]: "" }));
                    }
                  }}
                >
                  Ambil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pick.error ? <Problem error={pick.error} /> : null}
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
