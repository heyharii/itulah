/* Figures the way the hub prints them (frontend-hub/src/lib/format.ts):
   Indonesian grouping, "pcs" after a count, the minus as a real minus. */
const group = new Intl.NumberFormat("id-ID")

export const num = (n: number) => group.format(n)
export const pcs = (n: number) => `${group.format(n)} pcs`
export const rp = (n: number) => `Rp ${group.format(n)}`
export const signed = (n: number) =>
  n > 0 ? `+${pcs(n)}` : n < 0 ? `−${pcs(-n)}` : pcs(0)
