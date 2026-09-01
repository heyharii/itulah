/** Every app in the suite, in the order the rail lists them. */
export type AppId =
  | "buying"
  | "forum"
  | "chat"
  | "files"
  | "articles"
  | "sourcing"
  | "hr-ho"
  | "hr-store"
  | "inventory"
  | "finance"
  | "commercial"
  | "customers"
  | "accounting"
  | "system"

export const APPS: { id: AppId; label: string; hint: string }[] = [
  {
    id: "forum",
    label: "Community",
    hint: "Discussion forum",
  },
  {
    id: "chat",
    label: "Messages",
    hint: "Channels and direct messages",
  },
  {
    id: "files",
    label: "Drive",
    hint: "Files and folders",
  },
  {
    id: "articles",
    label: "Articles",
    hint: "The article master — what we sell",
  },
  {
    id: "sourcing",
    label: "Sourcing",
    hint: "The style catalogue, and what is staged for ordering",
  },
  {
    id: "buying",
    label: "Buying",
    hint: "Suppliers and the purchase orders placed with them",
  },
  {
    id: "hr-ho",
    label: "People · HO",
    hint: "Headcount, hires, exits and payroll",
  },
  {
    id: "hr-store",
    label: "People · Store",
    hint: "Roster, team and leave for one location",
  },
  {
    id: "inventory",
    label: "Inventory",
    hint: "Stock, observation, missing units and the ledger",
  },
  {
    id: "finance",
    label: "Finance",
    hint: "What is owed to suppliers, and what has been paid",
  },
  {
    id: "commercial",
    label: "Commercial",
    hint: "Prices, campaigns, vouchers and return policy",
  },
  {
    id: "accounting",
    label: "Accounting",
    hint: "The general ledger, its accounts and its periods",
  },
  {
    id: "customers",
    label: "Customers",
    hint: "Members, what they buy, and what they are owed",
  },
  {
    id: "system",
    label: "System",
    hint: "Accounts, roles, permissions and the audit log",
  },
]
