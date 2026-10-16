/// The two printed papers' stylesheet — the voucher slip and the Berita Acara.
///
/// Plain CSS under `kp-` rather than utility classes: a paper is copied into a
/// frame of its own to be printed (`printNode`), where the page's utilities do
/// not exist, and it must look the same on the screen and on the sheet. Black on
/// white, 14px, whatever the theme.
export const PAPER_CSS = `
@page{size:A4;margin:14mm}
.kp{box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;padding:30px 34px;background:#fff;color:#111;font:14px/1.3 Inter,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.kp *{box-sizing:border-box}
.kp b{font-weight:700}
.kp-head{display:flex;flex-direction:column;gap:2px;margin-bottom:16px}
.kp-head span{font-weight:600}
.kp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:8px;margin-bottom:14px;border-bottom:2px solid #111}
.kp-top .r{text-align:right}
.kp-top .id{font-family:ui-monospace,Menlo,monospace}
.kp-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:12px}
.kp-fields .w{grid-column:1/-1}
.kp-f small{display:block;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:#555}
.kp-f div{margin-top:2px;padding-bottom:2px;border-bottom:1px dotted #777;min-height:20px;overflow-wrap:anywhere}
.kp-words{margin:12px 0;padding:8px 12px;border:1px solid #444;background:#f7f7f7}
.kp-words small{display:block;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:#555}
.kp-words i{display:block;margin-top:2px}
.kp-pt{width:100%;border-collapse:collapse;margin-bottom:16px}
.kp-pt th,.kp-pt td{border:1px solid #444;padding:3px 8px;font-size:14px;line-height:1.3;text-align:left}
.kp-pt th{font-weight:700;text-align:center;background:#f2f2f2}
.kp-pt .nm{text-align:right;padding-right:28px}
.kp-pt .r{text-align:right}
.kp-pt .c{text-align:center}
.kp-pt tr.g td{font-weight:700}
.kp-pt tr.g.m td{text-align:center;background:#f2f2f2}
.kp-pt tr.t td{font-weight:700}
.kp-pt tr.gt td{font-weight:800;background:#f7f7f7}
.kp-pt.kb{width:72%}
.kp-note{margin:-6px 0 12px;overflow-wrap:anywhere}
.kp-sig{margin-top:20px}
.kp-sg{display:grid;gap:24px;margin-top:14px;text-align:center}
.kp-sg.two{grid-template-columns:1fr 1fr}
.kp-sg.three{grid-template-columns:1fr 1fr 1fr}
.kp-sg div{display:flex;flex-direction:column;gap:2px}
.kp-sg span{margin-bottom:52px}
.kp-sg b{text-decoration:underline}
.kp-sg b.blank{text-decoration:none;border-bottom:1px solid #111;width:60%;margin:0 auto}
.kp-sg em{font-style:normal}
@media (max-width:520px){.kp{padding:18px 14px}.kp-pt.kb{width:100%}.kp-fields{grid-template-columns:1fr}}
@media print{.kp{max-width:none;padding:0}}
`
