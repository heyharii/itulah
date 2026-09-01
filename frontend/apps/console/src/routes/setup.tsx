import { useQuery } from "@tanstack/react-query";

import { ApiError, Centre, Node } from "@itulah/client";

const centre = new Centre(new Node());

/// Deliveries nobody has said what they are yet.
///
/// Goods exist here before anybody knows what they are: they were counted and
/// accepted at a warehouse, and are waiting for head office to decide the
/// article, its colours and sizes, and what it sells for. Deciding that
/// publishes the price and makes the goods sellable — the two are one act.
export function SetupScreen() {
  const waiting = useQuery({
    queryKey: ["article-setups", "unidentified"],
    queryFn: ({ signal }) => centre.unidentified(signal),
  });

  if (waiting.isPending) {
    return <p>Memuat…</p>;
  }
  if (waiting.error) {
    return <Problem error={waiting.error} />;
  }

  const items = waiting.data?.items ?? [];
  if (items.length === 0) {
    // Empty means every delivery has an identity, not that the screen is
    // broken.
    return (
      <main>
        <h1>Barang baru</h1>
        <p>Tidak ada kiriman yang menunggu diidentifikasi.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Barang baru</h1>
      <table>
        <thead>
          <tr>
            <th>Kode pemasok</th>
            <th>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.receipt_line_id}>
              <td>{item.supplier_article_code}</td>
              <td>{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The setup form itself — colours, sizes, quantities that must sum to
          the delivery, and the base price that becomes the first price book —
          is the next screen to build. It is the one form in this system that
          genuinely needs TanStack Form. */}
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
