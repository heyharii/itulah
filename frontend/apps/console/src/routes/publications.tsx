import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, Centre, Node } from "@itulah/client";

const centre = new Centre(new Node());
const key = ["commercial", "publications"] as const;

/// Every price book the company has, newest first.
///
/// A book is a list of CHANGES, not a replacement: one that does not mention a
/// product leaves it at whatever the last book said. So a short list here is
/// normal and a long one is not better.
export function PublicationsScreen() {
  const queryClient = useQueryClient();
  const publications = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => centre.publications(signal),
  });

  const publish = useMutation({
    mutationFn: (id: string) => centre.publish(id, "merchandiser"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (publications.isPending) {
    return <p>Memuat buku harga…</p>;
  }
  if (publications.error) {
    return <Problem error={publications.error} />;
  }

  const items = publications.data?.items ?? [];
  return (
    <main>
      <h1>Buku harga</h1>
      <table>
        <thead>
          <tr>
            <th>Versi</th>
            <th>Nama</th>
            <th>Status</th>
            <th>Aturan</th>
            <th>Berlaku dari</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((publication) => (
            <tr key={publication.id}>
              <td>{publication.version}</td>
              <td>{publication.name}</td>
              <td>{publication.status}</td>
              <td>{publication.offer_count}</td>
              <td>{publication.effective_from.slice(0, 10)}</td>
              <td>
                {publication.status === "DRAFT" ? (
                  <button
                    type="button"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate(publication.id)}
                  >
                    Terbitkan
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Publishing sends the book to every shop and cannot be undone: a
          published version is immutable. The refusal, if it comes, explains
          itself — an incomplete book names what is missing. */}
      {publish.error ? <Problem error={publish.error} /> : null}
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
