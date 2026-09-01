/// Money on screen.
///
/// The server deals in the smallest unit and so does this: a rupiah amount is
/// an integer count of rupiah, never a decimal. Formatting happens once, here,
/// at the moment of display — a number that has been through a string and back
/// is a number that can be wrong.
export function rupiah(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const digits = Math.abs(minor).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}Rp ${grouped}`;
}

/// Where a price came from, in words a cashier can repeat to a customer.
///
/// The server sends a code; a shopper asking "why is it this price" needs a
/// sentence. Anything unrecognised is shown as it arrived rather than hidden:
/// a code nobody translated is still more use than silence.
export function priceSource(code: string): string {
  switch (code) {
    case "SITE_PRICE":
      return "harga toko ini";
    case "SITE_GROUP_PRICE":
      return "harga kelompok toko";
    case "TIER_PRICE":
      return "harga tier member";
    case "COMPANY_PRICE":
      return "harga pusat";
    case "MARKDOWN":
      return "harga turun";
    case "MANUAL_OVERRIDE":
      return "harga diketik kasir";
    case "INTAKE_PRICE":
      return "harga saat barang diterima";
    default:
      return code;
  }
}
