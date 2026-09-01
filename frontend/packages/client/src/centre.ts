import { Node } from "./node";

/// The centre's own answers.
///
/// Almost none of these are generated. The cloud's routes reply with JSON
/// literals rather than serialised structs, so there is nothing for the
/// generator to read and the shapes below are written by hand.
///
/// That is a real gap, not a style choice: a hand-written shape can drift from
/// the route that produces it and nothing will say so — the same failure the
/// generated half of this contract exists to prevent. Giving those routes
/// response structs is server work worth doing.
export interface PublicationSummary {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly offer_count: number;
  readonly published_at: string | null;
}

export interface ResolvedOffer {
  readonly sku_id: string | null;
  readonly sku_code: string;
  readonly article_code: string;
  readonly article_name: string;
  readonly version: number;
  readonly currency: string;
  readonly unit_price_minor: number;
  readonly base_unit_price_minor: number;
  readonly price_source: string;
  readonly markdown_id: string | null;
  readonly tax_category: string;
}

export interface UnidentifiedReceipt {
  readonly receipt_line_id: string;
  readonly supplier_article_code: string;
  readonly quantity: number;
}

export interface TakingsBySite {
  readonly site_id: string;
  readonly sale_count: number;
  readonly gross_minor: number;
  readonly last_sale_at: string | null;
}

/// What head office does.
export class Centre {
  constructor(private readonly node: Node) {}

  publications(signal?: AbortSignal): Promise<{ items: readonly PublicationSummary[] }> {
    return this.node.get("/api/v1/commercial/publications", { signal });
  }

  /// What one shop may sell, at that shop's prices.
  ///
  /// The same evaluator the till runs, so this screen and the counter cannot
  /// quote different numbers — which they did until recently, on exactly the
  /// days a clearance was running.
  offers(
    siteId: string,
    channel = "STORE",
    signal?: AbortSignal,
  ): Promise<{ site_id: string; item_count: number; items: readonly ResolvedOffer[] }> {
    const query = new URLSearchParams({ site_id: siteId, channel });
    return this.node.get(`/api/v1/commercial/offers?${query.toString()}`, { signal });
  }

  publish(publicationId: string, actorId: string): Promise<unknown> {
    return this.node.post(`/api/v1/commercial/publications/${publicationId}/publish`, {
      actor_id: actorId,
      idempotency_key: crypto.randomUUID(),
    });
  }

  /// Deliveries nobody has said what they are yet.
  unidentified(signal?: AbortSignal): Promise<{ items: readonly UnidentifiedReceipt[] }> {
    return this.node.get("/api/v1/article-setups/unidentified", { signal });
  }

  purchaseOrders(signal?: AbortSignal): Promise<{ items: readonly unknown[] }> {
    return this.node.get("/api/v1/purchase-orders", { signal });
  }

  fleetPools(signal?: AbortSignal): Promise<{ items: readonly unknown[] }> {
    return this.node.get("/api/v1/inventory/fleet-pools", { signal });
  }
}

// ---------------------------------------------------------------------------
// Sourcing and suppliers
// ---------------------------------------------------------------------------

import type {
  CatalogPurchaseOrderRequest,
  SourcedItem,
  CreateSupplierItemRequest,
  CreateSupplierRequest,
  Supplier,
  SupplierItem,
  UpdateSupplierRequest,
} from "@itulah/contract";

/// Who the company buys from, and what they offer.
///
/// Two ideas that are easy to run together and must not be: a SUPPLIER is a
/// relationship — a name, a contact, a status — and a SUPPLIER ITEM is
/// something they sell, at their code and their price. The company's own
/// article code is a separate thing again, decided when goods arrive; a
/// supplier item may name one or not.
export class Sourcing {
  constructor(private readonly node: Node) {}

  suppliers(status?: "ACTIVE" | "INACTIVE", signal?: AbortSignal): Promise<Supplier[]> {
    const query = status ? `?status=${status}` : "";
    return this.node.get<Supplier[]>(`/api/v1/suppliers${query}`, { signal });
  }

  supplier(id: string, signal?: AbortSignal): Promise<Supplier> {
    return this.node.get<Supplier>(`/api/v1/suppliers/${id}`, { signal });
  }

  createSupplier(request: CreateSupplierRequest): Promise<Supplier> {
    return this.node.post<Supplier>("/api/v1/suppliers", request);
  }

  updateSupplier(id: string, patch: UpdateSupplierRequest): Promise<Supplier> {
    return this.node.request<Supplier>("PATCH", `/api/v1/suppliers/${id}`, patch);
  }

  /// Stop or resume buying from someone.
  ///
  /// Deactivating is not deleting: a supplier who is no longer used still owns
  /// the history of everything ever bought from them, and a purchase order
  /// from last year must still name somebody.
  setSupplierActive(id: string, active: boolean): Promise<Supplier> {
    const verb = active ? "activate" : "deactivate";
    return this.node.post<Supplier>(`/api/v1/suppliers/${id}/${verb}`, {});
  }

  items(supplierId: string, signal?: AbortSignal): Promise<SupplierItem[]> {
    return this.node.get<SupplierItem[]>(`/api/v1/suppliers/${supplierId}/items`, { signal });
  }

  createItem(supplierId: string, request: CreateSupplierItemRequest): Promise<SupplierItem> {
    return this.node.post<SupplierItem>(`/api/v1/suppliers/${supplierId}/items`, request);
  }

  setItemActive(itemId: string, active: boolean): Promise<SupplierItem> {
    const verb = active ? "activate" : "deactivate";
    return this.node.post<SupplierItem>(`/api/v1/supplier-items/${itemId}/${verb}`, {});
  }

  /// Everything on offer, across every supplier.
  ///
  /// Sourcing asks a question no single supplier can answer — "who sells this,
  /// and for how much" — so the answer carries who.
  searchItems(
    options: { needle?: string; supplierId?: string | null } = {},
    signal?: AbortSignal,
  ): Promise<SourcedItem[]> {
    const query = new URLSearchParams({ status: "ACTIVE" });
    if (options.needle && options.needle.trim() !== "") {
      query.set("q", options.needle.trim());
    }
    if (options.supplierId) {
      query.set("supplier_id", options.supplierId);
    }
    return this.node.get<SourcedItem[]>(`/api/v1/supplier-items?${query.toString()}`, {
      signal,
    });
  }

  /// Turn a shortlist of supplier items into an order.
  ///
  /// The whole point of sourcing: browsing is only useful if it ends in a
  /// purchase order, and building that order by retyping the supplier's own
  /// codes is where the errors come from.
  orderFromCatalog(request: CatalogPurchaseOrderRequest): Promise<unknown> {
    return this.node.post("/api/v1/purchase-orders/catalog", request);
  }
}

/// Everything on offer, across every supplier.
///
/// One request, and the matching happens where the data is. This used to ask
/// for each supplier's items in turn and stitch them together here — one round
/// trip per supplier, and a browser deciding what "matches" means. A search
/// rule that lives in a screen is a search rule nobody else can see.
export async function sourceCatalogue(
  sourcing: Sourcing,
  options: { needle?: string; supplierId?: string | null } = {},
  signal?: AbortSignal,
): Promise<SourcedItem[]> {
  return sourcing.searchItems(options, signal);
}
