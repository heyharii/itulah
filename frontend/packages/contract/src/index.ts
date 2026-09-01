// The wire, as the server declares it.
//
// Every type here is generated from the Rust struct the server actually
// serialises — see backend/tests/contract_types.rs. Editing anything under
// `contract/` by hand is how the browser and the server come to disagree
// about a field that both of them are certain of.
//
// Regenerate with `make contract`.

export type { CatalogPurchaseLineRequest } from "./contract/CatalogPurchaseLineRequest";
export type { CatalogPurchaseOrderRequest } from "./contract/CatalogPurchaseOrderRequest";
export type { CatalogRow } from "./contract/CatalogRow";
export type { CreateSupplierItemRequest } from "./contract/CreateSupplierItemRequest";
export type { CreateSupplierRequest } from "./contract/CreateSupplierRequest";
export type { EdgeOfficialCountSummary } from "./contract/EdgeOfficialCountSummary";
export type { GoodsReceiptView } from "./contract/GoodsReceiptView";
export type { GrantedLine } from "./contract/GrantedLine";
export type { MoveRequest } from "./contract/MoveRequest";
export type { MovementCause } from "./contract/MovementCause";
export type { MovementView } from "./contract/MovementView";
export type { OfficialCountScope } from "./contract/OfficialCountScope";
export type { OpenGoodsReceiptRequest } from "./contract/OpenGoodsReceiptRequest";
export type { PackKoliRequest } from "./contract/PackKoliRequest";
export type { PickRequest } from "./contract/PickRequest";
export type { PickResult } from "./contract/PickResult";
export type { PoolBalance } from "./contract/PoolBalance";
export type { PromotionOutcome } from "./contract/PromotionOutcome";
export type { PurchaseCountRequest } from "./contract/PurchaseCountRequest";
export type { PurchaseVerifyDecision } from "./contract/PurchaseVerifyDecision";
export type { PurchaseVerifyRequest } from "./contract/PurchaseVerifyRequest";
export type { PurchaseWorkLine } from "./contract/PurchaseWorkLine";
export type { Quote } from "./contract/Quote";
export type { QuotedLine } from "./contract/QuotedLine";
export type { ReceiveRequest } from "./contract/ReceiveRequest";
export type { SaleRequest } from "./contract/SaleRequest";
export type { SaleResult } from "./contract/SaleResult";
export type { SiteId } from "./contract/SiteId";
export type { SourcedItem } from "./contract/SourcedItem";
export type { SubjectId } from "./contract/SubjectId";
export type { Supplier } from "./contract/Supplier";
export type { SupplierItem } from "./contract/SupplierItem";
export type { SupplierStatus } from "./contract/SupplierStatus";
export type { TaggingConfirmRequest } from "./contract/TaggingConfirmRequest";
export type { TaggingConfirmResult } from "./contract/TaggingConfirmResult";
export type { TaggingWorkJob } from "./contract/TaggingWorkJob";
export type { TaggingWorkLine } from "./contract/TaggingWorkLine";
export type { UpdateSupplierRequest } from "./contract/UpdateSupplierRequest";
