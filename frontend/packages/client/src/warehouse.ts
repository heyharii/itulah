import type {
  EdgeOfficialCountSummary,
  GoodsReceiptView,
  MovementView,
  PickRequest,
  PickResult,
  PurchaseCountRequest,
  PurchaseVerifyRequest,
  PurchaseWorkLine,
  TaggingConfirmRequest,
  TaggingConfirmResult,
  TaggingWorkJob,
} from "@itulah/contract";
import { Node } from "./node";

/// Responses the server builds ad hoc rather than from a struct.
///
/// Everything above is generated from the Rust type the server serialises.
/// These are not: the routes behind them answer with a JSON literal, so there
/// is no struct to generate from and the shape below is written by hand.
///
/// That means these CAN drift, and nothing will notice — which is exactly the
/// failure the generated half exists to prevent. The fix is on the server: give
/// those routes a response struct. Until then, treat anything in this block as
/// unverified.
export interface PicklistLine {
  readonly sku_code: string;
  readonly outstanding: number;
}
export interface Picklist {
  readonly lines: readonly PicklistLine[];
}

/// The operations a warehouse performs.
export class Warehouse {
  constructor(private readonly node: Node) {}

  /// What has been ordered and not yet counted.
  ///
  /// The expected quantity is deliberately absent from these rows: a blind
  /// count is only blind if the checker is not shown the number they are
  /// meant to produce.
  purchaseLines(signal?: AbortSignal): Promise<{ items: readonly PurchaseWorkLine[] }> {
    return this.node.get("/api/v1/dc/purchase-orders", { signal });
  }

  goodsReceipts(signal?: AbortSignal): Promise<{ items: readonly GoodsReceiptView[] }> {
    return this.node.get("/api/v1/dc/goods-receipts", { signal });
  }

  countPurchase(request: PurchaseCountRequest): Promise<unknown> {
    return this.node.post("/api/v1/dc/purchase-counts", request);
  }

  /// Counts waiting for a second person.
  ///
  /// The person who counted may not be the person who accepts it — that is a
  /// rule the server enforces, and this queue is what the second person works
  /// from.
  awaitingVerification(signal?: AbortSignal): Promise<{ items: readonly unknown[] }> {
    return this.node.get("/api/v1/dc/purchase-counts", { signal });
  }

  verifyPurchase(request: PurchaseVerifyRequest): Promise<unknown> {
    return this.node.post("/api/v1/dc/purchase-verifications", request);
  }

  taggingJobs(signal?: AbortSignal): Promise<{ items: readonly TaggingWorkJob[] }> {
    return this.node.get("/api/v1/dc/tagging-jobs", { signal });
  }

  confirmTagging(request: TaggingConfirmRequest): Promise<TaggingConfirmResult> {
    return this.node.post("/api/v1/dc/tagging-confirmations", request);
  }

  picklist(signal?: AbortSignal): Promise<Picklist> {
    return this.node.get("/api/v1/dc/picklist", { signal });
  }

  pick(request: PickRequest): Promise<PickResult> {
    return this.node.post("/api/v1/dc/picks", request);
  }

  movements(signal?: AbortSignal): Promise<{ items: readonly MovementView[] }> {
    return this.node.get("/api/v1/inventory/movements", { signal });
  }

  officialCounts(signal?: AbortSignal): Promise<{ items: readonly EdgeOfficialCountSummary[] }> {
    return this.node.get("/api/v1/dc/official-counts", { signal });
  }
}
