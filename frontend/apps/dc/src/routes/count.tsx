import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, Node, Warehouse } from "@itulah/client";

const warehouse = new Warehouse(new Node());

const workKey = ["dc", "purchase-lines"] as const;
const receiptKey = ["dc", "goods-receipts"] as const;

/// What arrived, counted without being told the answer.
///
/// The checker is never shown the ordered quantity — that is the whole point of
/// a blind count, and the server withholds it. So this screen has nothing to
/// show but the article and an empty box, which is correct.
export function CountScreen() {
  const queryClient = useQueryClient();

  const work = useQuery({
    queryKey: workKey,
    queryFn: ({ signal }) => warehouse.purchaseLines(signal),
  });
  const receipts = useQuery({
    queryKey: receiptKey,
    queryFn: ({ signal }) => warehouse.goodsReceipts(signal),
  });

  const count = useMutation({
    mutationFn: (input: { receiptId: string; poLineId: string; counted: number }) =>
      warehouse.countPurchase({
        receipt_id: input.receiptId,
        po_line_id: input.poLineId,
        counted_quantity: input.counted,
        actor_id: "checker",
        idempotency_key: crypto.randomUUID(),
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workKey });
    },
  });

  if (work.isPending) {
    return <p>Memuat daftar kerja…</p>;
  }
  if (work.error) {
    return <Problem error={work.error} />;
  }

  const receiptId = receipts.data?.items[0]?.receipt_id ?? "";
  const lines = work.data?.items ?? [];

  return (
    <main>
      <h1>Terima &amp; hitung</h1>
      {receiptId === "" ? (
        <p>
          Belum ada dokumen penerimaan yang terbuka. Buka satu dulu sebelum
          menghitung — semua hitungan menempel pada dokumennya.
        </p>
      ) : null}

      {lines.length === 0 ? (
        <p>Tidak ada yang menunggu dihitung.</p>
      ) : (
        <ul>
          {lines.map((line) => (
            <li key={line.po_line_id}>
              <CountOne
                line={line}
                disabled={receiptId === "" || count.isPending}
                onCount={(counted) =>
                  count.mutate({ receiptId, poLineId: line.po_line_id, counted })
                }
              />
            </li>
          ))}
        </ul>
      )}
      {count.error ? <Problem error={count.error} /> : null}
    </main>
  );
}

function CountOne({
  line,
  disabled,
  onCount,
}: {
  line: { po_line_id: string; article_name: string };
  disabled: boolean;
  onCount: (counted: number) => void;
}) {
  const form = useForm({
    defaultValues: { counted: "" },
    onSubmit: ({ value }) => {
      onCount(Number.parseInt(value.counted, 10));
      form.reset();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <strong>{line.article_name}</strong>
      <form.Field
        name="counted"
        validators={{
          // A courtesy, not the authority: the server checks this too, and its
          // answer is the one that counts. Checking here only saves the checker
          // a round trip when they have obviously mistyped.
          onChange: ({ value }) => {
            if (value.trim() === "") {
              return "Isi jumlah yang benar-benar dihitung";
            }
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed) || parsed < 0) {
              return "Jumlah tidak boleh negatif";
            }
            return undefined;
          },
        }}
      >
        {(field) => (
          <>
            <label htmlFor={field.name}>Jumlah dihitung</label>
            <input
              id={field.name}
              name={field.name}
              inputMode="numeric"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value.replace(/\D/g, ""))}
              onBlur={field.handleBlur}
            />
            {field.state.meta.errors.length > 0 ? (
              <span role="alert">{String(field.state.meta.errors[0])}</span>
            ) : null}
          </>
        )}
      </form.Field>
      <button type="submit" disabled={disabled}>
        Catat
      </button>
    </form>
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
