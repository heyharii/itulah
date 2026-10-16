import {
  dateIndonesian,
  kindWordId,
  rupiahWords,
  type Voucher,
} from "@/screens/money/petty-book"
import { PAPER_CSS } from "@/screens/money/petty-paper-css"
import { units } from "@itulah/contract/money"

/// The slip a BKM or BKK is printed on: Indonesian, one page, every line.
///
/// Drawn in plain CSS (`petty-paper-css.ts`) because it is copied into a frame
/// to print. It stays out of sight on the voucher page and is printed from
/// there.
export function VoucherPaper({
  ref,
  voucher,
  shop,
  by,
  countedWith,
}: {
  ref?: React.Ref<HTMLDivElement>
  voucher: Voucher
  /// The shop, as the paper names it.
  shop: string
  /// The person who made it and, for a BKM, who counted it with them — as
  /// full names.
  by: string
  countedWith: string | null
}) {
  const out = voucher.kind === "BKK"
  const date = dateIndonesian(voucher.at)
  return (
    <div ref={ref} className="kp">
      <style>{PAPER_CSS}</style>
      <div className="kp-top">
        <b>{shop.toUpperCase()}</b>
        <div className="r">
          <b>{out ? "BUKTI KAS KELUAR (BKK)" : "BUKTI KAS MASUK (BKM)"}</b>
          <div>
            <span className="id">{voucher.no}</span> · {date}
          </div>
        </div>
      </div>

      <div className="kp-fields">
        <div className="kp-f w">
          <small>{out ? "Dibayarkan kepada" : "Diterima dari"}</small>
          <div>{voucher.party === "" ? " " : voucher.party}</div>
        </div>
        <div className="kp-f">
          <small>Referensi</small>
          <div>{voucher.reference === "" ? " " : voucher.reference}</div>
        </div>
        {voucher.approval !== null && (
          <div className="kp-f">
            <small>Kode Finance</small>
            <div>{voucher.approval.code}</div>
          </div>
        )}
        {voucher.note !== "" && (
          <div className="kp-f w">
            <small>Keterangan</small>
            <div>{voucher.note}</div>
          </div>
        )}
      </div>

      <table className="kp-pt">
        <thead>
          <tr>
            <th style={{ width: "8%" }}>No</th>
            <th style={{ width: "34%" }}>Akun</th>
            <th>Keterangan</th>
            <th style={{ width: "22%" }}>Jumlah (Rp)</th>
          </tr>
        </thead>
        <tbody>
          {voucher.lines.map((line, index) => (
            <tr key={line.id}>
              <td className="c">{index + 1}</td>
              <td>{kindWordId(line.code)}</td>
              <td>{line.note}</td>
              <td className="r">{units(line.amountMinor)}</td>
            </tr>
          ))}
          <tr className="gt">
            <td colSpan={3}>TOTAL</td>
            <td className="r">{units(voucher.totalMinor)}</td>
          </tr>
        </tbody>
      </table>

      <div className="kp-words">
        <small>Terbilang</small>
        <i># {rupiahWords(voucher.totalMinor)} #</i>
      </div>

      <div className="kp-sig">
        <span>
          {shop}, {date}
        </span>
        <div className="kp-sg three">
          <div>
            <span>DIBUAT OLEH</span>
            <b>{by.toUpperCase()}</b>
            <em>&nbsp;</em>
          </div>
          <div>
            <span>{out ? "DISETUJUI" : "DIHITUNG BERSAMA"}</span>
            {out || countedWith === null ? (
              <b className="blank">&nbsp;</b>
            ) : (
              <b>{countedWith.toUpperCase()}</b>
            )}
            <em>&nbsp;</em>
          </div>
          <div>
            <span>{out ? "PENERIMA" : "DITERIMA OLEH"}</span>
            <b className="blank">&nbsp;</b>
            <em>&nbsp;</em>
          </div>
        </div>
      </div>
    </div>
  )
}
