import type { AppId } from "@/components/apps"

import articlesIcon from "@/assets/apps/articles_identity.svg"
import commercialIcon from "@/assets/apps/commercial_price.svg"
import customersIcon from "@/assets/apps/customers.svg"
import financeIcon from "@/assets/apps/finance.svg"
import inventoryIcon from "@/assets/apps/inventory.svg"
import marketingIcon from "@/assets/apps/marketing.svg"
import operationsIcon from "@/assets/apps/operations.svg"
import peopleIcon from "@/assets/apps/people.svg"
import procurementIcon from "@/assets/apps/procurement_sourcing.svg"
import systemIcon from "@/assets/apps/system.svg"
import workplaceIcon from "@/assets/apps/workplace_ga.svg"

/** One artwork per app — apps in the same domain share a mark. */
export const APP_ICON: Record<AppId, string> = {
  buying: operationsIcon,
  forum: marketingIcon,
  chat: workplaceIcon,
  files: workplaceIcon,
  articles: articlesIcon,
  sourcing: procurementIcon,
  "hr-ho": peopleIcon,
  "hr-store": peopleIcon,
  inventory: inventoryIcon,
  finance: financeIcon,
  accounting: financeIcon,
  commercial: commercialIcon,
  customers: customersIcon,
  system: systemIcon,
}
