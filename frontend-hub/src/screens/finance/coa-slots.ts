/// 7Soft's Setting COA slots: the 23 names its screen prints, each with the
/// hub posting role that answers it — or none, and why.
///
/// See `setting-coa.tsx` for what a slot is here.

export interface Slot {
  /// 7Soft's name for the slot, as its Setting COA screen prints it.
  readonly name: string
  /// The posting role that answers it, or `null` when the hub has none.
  readonly role: string | null
  /// What 7Soft uses the slot for — section 2.18 of the manual.
  readonly use: string
  /// Why a slot without a role has none, and where its job goes instead.
  readonly instead?: { text: string; to?: string; toLabel?: string }
}

export const SLOTS: readonly Slot[] = [
  {
    name: "Default Kas Kecil",
    role: "petty_cash",
    use: "Default cash account in BKM and BKK",
  },
  {
    name: "Disc Pembelian",
    role: "purchase_discount",
    use: "Purchase discount on goods items",
  },
  {
    name: "Disc Penjualan",
    role: "sales_discount",
    use: "Sales discount on goods items",
  },
  { name: "HPP", role: "cogs", use: "Cost of goods on items" },
  {
    name: "Hutang",
    role: "trade_payable",
    use: "Payable of a new supplier",
  },
  {
    name: "Hutang Suspend",
    role: null,
    use: "Goods received, not yet invoiced",
    instead: {
      text: "The hub books a purchase when the supplier bill is posted, so there is no goods-received payable to hold.",
    },
  },
  {
    name: "Laba",
    role: null,
    use: "Current profit on the balance sheet",
    instead: {
      text: "The balance sheet computes the year's profit from the ledger; there is no account for it.",
      to: "/finance/reports/balance-sheet",
      toLabel: "Open the balance sheet",
    },
  },
  {
    name: "Laba Ditahan",
    role: "retained_earnings",
    use: "Retained earnings on the balance sheet",
  },
  {
    name: "Pembelian Jasa",
    role: null,
    use: "Purchase account of service items",
    instead: {
      text: "A service bought is an expense line on the bill; its account comes from the expense category.",
      to: "/finance/setup/expense-categories",
      toLabel: "Open Expense categories",
    },
  },
  {
    name: "Penjualan",
    role: "revenue_cash",
    use: "Sales account of goods items",
  },
  {
    name: "Penjualan Jasa",
    role: null,
    use: "Sales account of service items",
    instead: {
      text: "The hub sells goods through the tills; there is no service sale to give a default account.",
    },
  },
  {
    name: "Persediaan Barang",
    role: "inventory",
    use: "Stock account of goods items",
  },
  {
    name: "Piutang",
    role: null,
    use: "Receivable of a new customer",
    instead: {
      text: "There is no debtor book: card and QRIS takings wait on the acquirer's receivable, and a shop sale is paid at the till.",
    },
  },
  {
    name: "Potongan Hutang",
    role: "settlement_discount",
    use: "Potongan column in BKK",
  },
  {
    name: "Potongan Piutang",
    role: null,
    use: "Potongan column in BKM",
    instead: {
      text: "With no debtor book there is no receivable to take a discount against.",
    },
  },
  {
    name: "PPN Pembelian",
    role: "vat_in",
    use: "VAT on purchases",
  },
  {
    name: "PPN Penjualan",
    role: "vat_out",
    use: "VAT on sales",
  },
  {
    name: "Retur Pembelian",
    role: "inventory",
    use: "Purchase returns of goods items",
  },
  {
    name: "Retur Penjualan",
    role: "sales_return",
    use: "Sales returns of goods items",
  },
  {
    name: "Stok Adjustment",
    role: "stock_loss",
    use: "Default in Stock adjustment",
  },
  {
    name: "Stok Opname",
    role: "stock_loss",
    use: "Default in Stock opname",
  },
  {
    name: "Uang Muka Pembelian",
    role: "advance_purchase",
    use: "Down payment items, purchases",
  },
  {
    name: "Uang Muka Penjualan",
    role: null,
    use: "Down payment items, sales",
    instead: {
      text: "With no debtor book there is no customer down payment to hold.",
    },
  },
]

/// The slots a role answers to, so the posting role's sheet can name them.
export function slotsOfRole(role: string): readonly string[] {
  return SLOTS.filter((slot) => slot.role === role).map((slot) => slot.name)
}
