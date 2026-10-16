import {
  COINS,
  NOTES,
  kasbonSum,
  sumOf,
  valuesOf,
  type Counted,
} from "@/screens/money/cash-count-model"
import { dateIndonesian } from "@/screens/money/petty-book"
import { PAPER_CSS } from "@/screens/money/petty-paper-css"
import { units } from "@itulah/contract/money"

/// The paper the store signs after a petty cash count: Indonesian, every
/// denomination printed whether or not any were counted, the kas bon slips
/// itemised, and two signatures — the cash holder's left blank, the counter's
/// named.
///
/// Drawn in plain CSS (`petty-paper-css.ts`) because it is copied into a frame
/// to print, and shown as it will print in the print preview.
export function CountPaper({
  ref,
  count,
  on,
  shop,
  by,
  position,
}: {
  ref?: React.Ref<HTMLDivElement>
  count: Counted
  /// The day counted, `YYYY-MM-DD`.
  on: string
  /// The shop, as the paper names it.
  shop: string
  /// Who counted, as a full name.
  by: string
  /// Their position, when head office's list says it.
  position: string | null
}) {
  const date = dateIndonesian(on)
  const noteRows = [...new Set([...NOTES, ...valuesOf(count.notes)])].sort(
    (a, b) => b - a,
  )
  const coinRows = [...new Set([...COINS, ...valuesOf(count.coins)])].sort(
    (a, b) => b - a,
  )
  const slips = kasbonSum(count.kasbon)
  const difference = count.countedMinor - count.booksMinor
  const figure = (minor: number) => (minor === 0 ? "-" : units(minor))
  const row = (value: number, n: number) => (
    <tr key={value}>
      <td className="nm">{units(value)}</td>
      <td className="r">{n > 0 ? units(n) : ""}</td>
      <td className="r">{figure(value * n)}</td>
    </tr>
  )
  return (
    <div ref={ref} className="kp">
      <style>{PAPER_CSS}</style>
      <div className="kp-head">
        <b>Berita Acara Pemeriksaan Kas Kecil</b>
        <b>{shop.toUpperCase()}</b>
        <span>per tanggal : {date}</span>
      </div>

      <table className="kp-pt">
        <thead>
          <tr>
            <th>NOMINAL</th>
            <th>LEMBAR</th>
            <th>JUMLAH</th>
          </tr>
        </thead>
        <tbody>
          <tr className="g">
            <td colSpan={3}>UANG KERTAS</td>
          </tr>
          {noteRows.map((value) => row(value, count.notes[value] ?? 0))}
          <tr className="t">
            <td>TOTAL</td>
            <td />
            <td className="r">{figure(sumOf(count.notes))}</td>
          </tr>
          <tr className="g">
            <td colSpan={3}>UANG LOGAM</td>
          </tr>
          {coinRows.map((value) => row(value, count.coins[value] ?? 0))}
          <tr className="t">
            <td>TOTAL</td>
            <td />
            <td className="r">{figure(sumOf(count.coins))}</td>
          </tr>
          <tr className="t">
            <td>KAS BON SEMENTARA</td>
            <td />
            <td className="r">{figure(slips)}</td>
          </tr>
          <tr className="gt">
            <td>GRAND TOTAL</td>
            <td />
            <td className="r">{figure(count.countedMinor)}</td>
          </tr>
          <tr className="g m">
            <td colSpan={3}>SALDO BUKU SYSTEM</td>
          </tr>
          <tr className="t">
            <td>PETTY CASH</td>
            <td />
            <td className="r">{figure(count.booksMinor)}</td>
          </tr>
          <tr className="gt">
            <td>SELISIH, LEBIH ATAU (KURANG)</td>
            <td />
            <td className="r">
              {difference < 0 ? `(${units(-difference)})` : figure(difference)}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="kp-pt kb">
        <thead>
          <tr>
            <th>PERINCIAN KAS BON · NAMA</th>
            <th>JUMLAH</th>
          </tr>
        </thead>
        <tbody>
          {count.kasbon.map((slip, index) => (
            <tr key={index}>
              <td>{slip.who}</td>
              <td className="r">{units(slip.amountMinor)}</td>
            </tr>
          ))}
          {Array.from(
            { length: Math.max(1, 3 - count.kasbon.length) },
            (_, index) => (
              <tr key={`blank-${index}`}>
                <td>&nbsp;</td>
                <td />
              </tr>
            ),
          )}
        </tbody>
      </table>

      {count.note !== "" && <p className="kp-note">Keterangan: {count.note}</p>}

      <div className="kp-sig">
        <span>
          {shop}, {date}
        </span>
        <div className="kp-sg two">
          <div>
            <span>PEMEGANG KAS</span>
            <b className="blank">&nbsp;</b>
            <em>&nbsp;</em>
          </div>
          <div>
            <span>DIHITUNG OLEH</span>
            <b>{by.toUpperCase()}</b>
            <em>{position === null ? " " : position.toUpperCase()}</em>
          </div>
        </div>
      </div>
    </div>
  )
}
