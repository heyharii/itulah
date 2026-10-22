/// A SKU code as it is said aloud: no leading zeros.
export const shortCode = (sku: string) => sku.replace(/^0+(?=\d)/, "")
