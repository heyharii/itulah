import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, Node, Warehouse } from "@itulah/client";

const warehouse = new Warehouse(new Node());
const jobsKey = ["dc", "tagging-jobs"] as const;

/// The print queue: what head office has identified and the floor must tag.
///
/// Every label is already computed at the centre and merely carried here, so
/// there is nothing to decide on this screen — only to confirm that the tags
/// are physically on the goods.
export function TaggingScreen() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: jobsKey,
    queryFn: ({ signal }) => warehouse.taggingJobs(signal),
  });

  const confirm = useMutation({
    mutationFn: (jobId: string) =>
      warehouse.confirmTagging({
        job_id: jobId,
        actor_id: "petugas-tag",
        idempotency_key: crypto.randomUUID(),
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey });
    },
  });

  if (jobs.isPending) {
    return <p>Memuat antrean cetak…</p>;
  }
  if (jobs.error) {
    return <Problem error={jobs.error} />;
  }

  const items = jobs.data?.items ?? [];
  if (items.length === 0) {
    // An empty queue means the work is done, not that something is missing.
    return (
      <main>
        <h1>Tagging</h1>
        <p>Antrean kosong — tidak ada yang menunggu ditag.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Tagging</h1>
      {items.map((job) => (
        <section key={job.job_id}>
          <h2>{job.article_name}</h2>
          <p>{job.total_quantity} unit</p>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Warna</th>
                <th>Ukuran</th>
                <th>Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {job.lines.map((line) => (
                <tr key={line.sku_code}>
                  <td>
                    <code>{line.sku_code}</code>
                  </td>
                  <td>{line.colour_label}</td>
                  <td>{line.size_label}</td>
                  <td>{line.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate(job.job_id)}
          >
            {confirm.isPending ? "Menyimpan…" : "Tag sudah menempel"}
          </button>
        </section>
      ))}
      {confirm.error ? <Problem error={confirm.error} /> : null}
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
