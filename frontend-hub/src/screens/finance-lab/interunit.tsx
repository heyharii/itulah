import { PageHeader } from "@/components/ui/page-header"
import { Tag } from "@/components/ui/tag"
import { useBook } from "@/screens/finance-lab/state"
import {
  Amount,
  Blocked,
  Cell,
  Panel,
  Row,
  Section,
  SimBadge,
  Table,
} from "@/screens/finance-lab/parts"

/// Interunit & Principal — three balances that are not interchangeable.
///
/// # What the client's own July journal settles, and what it does not
///
/// C006 posts to all three affiliate families in one month, and each one has a
/// distinct cause:
///
///   `2012302 Hutang Affiliasi Atas Barang`   — GOODS. Raised by 147 Surat
///     Jalan Distribusi, reduced by 23 takings deposits. This is the account
///     the shop's daily cash actually pays down; the takings are not revenue
///     leaving, they are a debt for stock being settled.
///   `2012301 Hutang Affiliasi Pembiayaan`    — FINANCING. Five BKK repay it
///     from the shop's own bank.
///   `2012303 Hutang Lain-lain Principal`     — the principal's money. The
///     payroll float arrives against it.
///
/// What no evidence answers is the RULE that picks between financing and
/// principal for a given transfer. So `funding_type` is a required field on the
/// event and the engine refuses an event that does not carry one. That refusal
/// is the honest state of this question, and it is P0 in the revised matrix.
///
/// # Why the goods balance never comes down to zero here
///
/// Because BDP never clears. July shows Rp470,488,453 of `BDP Barang Dagangan`
/// debits across 147 dispatches and not one credit, while sales credit
/// `Persediaan` — so something moves goods in transit into inventory and the
/// journal that does it has not been supplied. Until it is, the receipt rule
/// stays off and this screen shows the gap rather than closing it with a guess.
export function LabInterunit() {
  const b = useBook()

  const legs: [string, string, string, string][] = [
    ["Hutang Affiliasi Atas Barang", "201230200106", "GOODS", "Naik saat Surat Jalan Distribusi, turun saat setoran hasil penjualan"],
    ["Hutang Affiliasi Pembiayaan", "201230100106", "FINANCING", "Pendanaan dari HO yang dikembalikan dari bank unit"],
    ["Hutang Lain-lain Principal", "201230300106", "PRINCIPAL", "Uang principal — dana gaji Juli masuk lewat sini"],
  ]

  const bdp = b.ledger.balance("101120300706", { unit_id: "C006" })
  const inventory = b.ledger.balance("101120100106", { unit_id: "C006" })

  return (
    <div>
      <PageHeader
        crumb="Finance lab"
        title="Interunit & Principal"
        sub="Tiga keluarga akun afiliasi yang tidak bisa saling menggantikan, dan satu yang belum bisa ditutup."
        actions={<SimBadge />}
      />

      <Section
        title="Posisi C006 terhadap HEAD OFFICE"
        sub="Dijumlah dari jurnal simulasi bulan Juli."
      >
        <Panel>
          <Table head={["Akun", "Kode", "Sifat", ">Saldo", "Apa yang menggerakkannya"]}>
            {legs.map(([name, code, kind, why]) => {
              const bal = b.ledger.balance(code, { unit_id: "C006" })
              return (
                <Row key={code}>
                  <Cell>{name}</Cell>
                  <Cell mono>{code}</Cell>
                  <Cell>
                    <Tag tone={kind === "GOODS" ? "accent" : kind === "FINANCING" ? "info" : "warn"}>
                      {kind}
                    </Tag>
                  </Cell>
                  <Cell right>
                    {/* A payable is credit-natured, so a negative debit-minus-credit
                        is what "owed" looks like. Shown signed rather than flipped:
                        a balance does not decide how to present itself. */}
                    <Amount minor={bal} />
                  </Cell>
                  <Cell className="text-mute">{why}</Cell>
                </Row>
              )
            })}
          </Table>
        </Panel>
        <p className="mt-2 text-[0.75rem] text-mute">
          Angka bertanda: debit dikurangi kredit. Utang bersifat kredit, jadi saldo negatif berarti
          C006 berutang sebesar itu ke HEAD OFFICE.
        </p>
      </Section>

      <Section
        title="Pemeriksaan dua sisi"
        sub="Satu-satunya angka di buku ini yang harus disepakati dua pihak."
      >
        <Blocked>
          <span className="font-semibold">Sisi HEAD OFFICE tidak bisa diperiksa.</span> Jurnal HO
          pasangan bulan Juli belum tersedia — dua file &ldquo;BY HO&rdquo; yang dikirim ternyata
          identik baris-per-baris dengan ekspor C006 (13.339 baris, 2.187 dokumen, 45 akun yang
          sama), jadi keduanya adalah jurnal unit yang sama, bukan pasangannya. Tanpa itu, klaim HO
          dan pengakuan unit tidak bisa diadu, dan itu justru satu-satunya hal yang membuat angka ini
          berarti.
        </Blocked>
      </Section>

      <Section
        title="Barang dalam perjalanan yang tidak pernah tiba"
        sub="Bukan backlog pembukuan — ini aturan yang hilang."
      >
        <Panel>
          <Table head={["Akun", "Kode", ">Debit", ">Kredit", "Keadaan"]}>
            <Row tone="warn">
              <Cell>BDP Barang Dagangan WIRAMODE - C006</Cell>
              <Cell mono>101120300706</Cell>
              <Cell right>
                <Amount minor={bdp} />
              </Cell>
              <Cell right>
                <Amount minor={0} muted />
              </Cell>
              <Cell className="text-mute">Naik terus. Tidak ada aturan yang menurunkannya.</Cell>
            </Row>
            <Row>
              <Cell>Persediaan Barang Dagang C006</Cell>
              <Cell mono>101120100106</Cell>
              <Cell right>
                <Amount minor={0} muted />
              </Cell>
              <Cell right>
                <Amount minor={-inventory} />
              </Cell>
              <Cell className="text-mute">
                Dikredit setiap penjualan, tapi tidak pernah didebit — barangnya masuk lewat mana?
              </Cell>
            </Row>
          </Table>
        </Panel>
        <p className="mt-2 text-[0.8125rem] text-body">
          Aturan <span className="font-mono text-[0.75rem]">interunit_receipt</span> sudah
          dideklarasikan lengkap dengan baris debit dan kreditnya, dan statusnya mati. Dua bentuk
          sama-sama masuk akal — BDP menjadi Persediaan saat barang diterima, atau saat barang
          terjual — dan selisih antara keduanya persis sebesar barang yang masih ada di rak. Itu
          bukan detail; itu arti dari akun persediaan. Bukti yang dibutuhkan: satu jurnal penerimaan
          barang di sisi unit.
        </p>
      </Section>
    </div>
  )
}
