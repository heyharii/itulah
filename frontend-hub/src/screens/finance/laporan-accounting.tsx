/// Finance › Reports (7Soft's "Laporan Accounting", `scr-rep.js`).
///
/// The screen already lives in `finance-final/reports/laporan-accounting.tsx`:
/// **Statements** (Profit and loss, Balance sheet, Cash flow, Gross margin by
/// article) with the period, the Combined | By shop switch and the KPI strip,
/// and **7Soft numbers**, the searchable index of the numbered reports that
/// lands on the hub screen answering each one. This file is the route's door
/// in `finance/`, not a second renderer — every figure still comes from
/// `GET /finance/statement` and the books the other report screens read.
export {
  LaporanAccounting,
  LaporanKeuangan,
  LaporanManajerial,
} from "@/screens/finance-final/reports/laporan-accounting"
