import type { CatalogRow, PoolBalance, SaleRequest, SaleResult } from "@itulah/contract";
import { Node } from "./node";

/// What a shop's own edge answers about its catalogue.
///
/// An empty list has two very different causes and the response distinguishes
/// them: `has_price_book: false` means no publication has reached this shop,
/// which is a sync problem; `true` with no items means the price book is here
/// and lists nothing this shop stocks, which is a merchandising one.
export interface StoreCatalog {
  readonly site_id: string;
  readonly channel: string;
  readonly as_of: string;
  readonly has_price_book: boolean;
  readonly publication_version: number | null;
  readonly currency: string;
  readonly item_count: number;
  readonly items: readonly CatalogRow[];
}

export interface PoolsView {
  readonly items: readonly PoolBalance[];
}

/// The operations a till performs.
export class Till {
  constructor(private readonly node: Node) {}

  catalog(signal?: AbortSignal): Promise<StoreCatalog> {
    return this.node.get<StoreCatalog>("/api/v1/store/catalog", { signal });
  }

  pools(signal?: AbortSignal): Promise<PoolsView> {
    return this.node.get<PoolsView>("/api/v1/inventory/pools", { signal });
  }

  /// Ring up a basket.
  ///
  /// The whole sale in one call, and deliberately so: the price of a basket
  /// depends on everything in it — a promotion is a statement about the cart —
  /// so there is no correct answer to "what does this line cost" until the
  /// basket is final.
  completeSale(request: SaleRequest, signal?: AbortSignal): Promise<SaleResult> {
    return this.node.post<SaleResult>("/api/v1/store/sales", request, { signal });
  }
}
