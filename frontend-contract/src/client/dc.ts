import type {
  AdvanceKoliRequest,
  CaptureOutcome,
  CreateDispatchRequest,
  CreateKoliShipmentRequest,
  CreateShipmentRequest,
  Dispatch,
  DispatchDetail,
  EdgeOfficialCountDetail,
  EdgeOfficialCountSummary,
  FulfillmentProgressResult,
  GoodsReceiptView,
  IntakeRequest,
  Koli,
  KoliManifest,
  LinePosition,
  MovementView,
  MoveRequest,
  OfficialCountEntriesRequest,
  OfficialCountSubmitRequest,
  OfficialCountSubmitResult,
  OpenGoodsReceiptRequest,
  OpenPackingBoxRequest,
  OpenPrintSessionRequest,
  OpenSessionRequest,
  OutstandingLine,
  PackingBox,
  PackingSessionSummary,
  PackKoliRequest,
  PicklistLine,
  PickRequest,
  PickResult,
  PickSessionSummary,
  PrintChunkReport,
  PrintKoliLabelRequest,
  PrintSessionSummary,
  PurchaseCountAwaitingVerification,
  PurchaseCountRequest,
  PurchaseCountResult,
  PurchaseVerifyRequest,
  PurchaseVerifyResult,
  PurchaseWorkLine,
  RecordInvoiceRequest,
  RepointPrinterRequest,
  ReprintRequest,
  Session,
  Shipment,
  ShipmentDetail,
  TaggingConfirmRequest,
  TaggingConfirmResult,
  TaggingWorkJob,
} from "../index";
import { Node } from "./node";

/// Narrow a listing to the rows one decision cares about.
///
/// Mirrors `ListFilter` in `backend/src/edge/outbound.rs`. Both default to
/// false server-side, so only a true is worth putting on the wire — a
/// `?ready=false` reads as a deliberate choice when it is merely the default.
export interface ListFilter {
  /// Only rows not yet gathered into their parent: koli with no shipment,
  /// shipments with no dispatch.
  readonly unassigned?: boolean;
  /// Only sealed koli / only open sessions / only dispatches still here.
  readonly ready?: boolean;
}

function query(filter: ListFilter = {}): string {
  const parts: string[] = [];
  if (filter.unassigned === true) {
    parts.push("unassigned=true");
  }
  if (filter.ready === true) {
    parts.push("ready=true");
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/// A fresh key for a write that must not be applied twice.
///
/// Minted in the browser before the first attempt, so a retry after a dropped
/// connection — the ordinary case on warehouse wifi — lands once. Generating
/// it inside the request instead would mint a new one per attempt and defeat
/// the whole mechanism.
export function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Older WebViews on handhelds. Not a UUID and not pretending to be one;
  // what matters is that two attempts at the same write share it and two
  // different writes do not.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/// Everything a DC Edge does, as the DC Edge declares it.
///
/// One class rather than a module of loose functions because every call needs
/// the same node, and because the envelopes are part of the wire: this node
/// answers a listing as `{items: [...]}` or `{lines: [...]}` depending on the
/// route, and unwrapping that at forty call sites is forty chances to unwrap
/// the wrong key. It is done once, here.
///
/// Routes are `backend/src/edge/http.rs`; nothing here invents a path.
export class Dc {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  // -------------------------------------------------------------------------
  // Receiving. A delivery is opened, counted blind, then verified by someone
  // else — and only that last step turns goods into stock.
  // -------------------------------------------------------------------------

  /// Deliveries still being worked through on the loading bay.
  async goodsReceipts(signal?: AbortSignal): Promise<GoodsReceiptView[]> {
    const body = await this.node.get<{ items: GoodsReceiptView[] }>(
      "/api/v1/dc/goods-receipts",
      { signal },
    );
    return body.items;
  }

  /// Open a delivery document when the lorry arrives, before anything is
  /// counted. The number is minted at this DC, so this works with the network
  /// down.
  openGoodsReceipt(
    request: OpenGoodsReceiptRequest,
    signal?: AbortSignal,
  ): Promise<GoodsReceiptView> {
    return this.node.post<GoodsReceiptView>(
      "/api/v1/dc/goods-receipts",
      request,
      {
        signal,
      },
    );
  }

  /// Record the supplier's invoice against a delivery. The verifier is holding
  /// the paper; nothing else in the estate can see it.
  recordInvoice(
    receiptId: string,
    request: RecordInvoiceRequest,
    signal?: AbortSignal,
  ): Promise<GoodsReceiptView> {
    return this.node.post<GoodsReceiptView>(
      `/api/v1/dc/goods-receipts/${encodeURIComponent(receiptId)}/invoice`,
      request,
      { signal },
    );
  }

  /// The checker's work list: which articles this DC still owes a supplier
  /// delivery against. Deliberately carries no ordered quantity.
  async purchaseWork(signal?: AbortSignal): Promise<PurchaseWorkLine[]> {
    const body = await this.node.get<{ items: PurchaseWorkLine[] }>(
      "/api/v1/dc/purchase-orders",
      { signal },
    );
    return body.items;
  }

  /// Write down what physically arrived. A document, not a movement: nothing
  /// becomes stock here.
  countPurchase(
    request: PurchaseCountRequest,
    signal?: AbortSignal,
  ): Promise<PurchaseCountResult> {
    return this.node.post<PurchaseCountResult>(
      "/api/v1/dc/purchase-counts",
      request,
      { signal },
    );
  }

  /// The verifier's queue. Same lines as `purchaseWork`, a different shape:
  /// this one carries the ordered quantity and the agreed price, because a
  /// verifier is comparing rather than counting.
  async countsAwaitingVerification(
    signal?: AbortSignal,
  ): Promise<PurchaseCountAwaitingVerification[]> {
    const body = await this.node.get<{
      items: PurchaseCountAwaitingVerification[];
    }>("/api/v1/dc/purchase-counts", { signal });
    return body.items;
  }

  /// Accept a count, or send it back to be counted again. Accepting is the
  /// moment the goods first exist as stock.
  verifyPurchase(
    request: PurchaseVerifyRequest,
    signal?: AbortSignal,
  ): Promise<PurchaseVerifyResult> {
    return this.node.post<PurchaseVerifyResult>(
      "/api/v1/dc/purchase-verifications",
      request,
      { signal },
    );
  }

  // -------------------------------------------------------------------------
  // Tagging. Accepted goods are counted quantities; tagging is where each
  // piece becomes an individually tracked unit.
  // -------------------------------------------------------------------------

  /// The print queue: jobs head office has sent and the warehouse has not
  /// finished. Each line carries finished EPC strings minted at the centre.
  async taggingJobs(signal?: AbortSignal): Promise<TaggingWorkJob[]> {
    const body = await this.node.get<{ items: TaggingWorkJob[] }>(
      "/api/v1/dc/tagging-jobs",
      { signal },
    );
    return body.items;
  }

  /// Queue the labels for one job.
  openPrintSession(
    request: OpenPrintSessionRequest,
    signal?: AbortSignal,
  ): Promise<PrintSessionSummary> {
    return this.node.post<PrintSessionSummary>(
      "/api/v1/dc/print-sessions",
      request,
      { signal },
    );
  }

  printSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<PrintSessionSummary> {
    return this.node.get<PrintSessionSummary>(
      `/api/v1/dc/print-sessions/${encodeURIComponent(sessionId)}`,
      { signal },
    );
  }

  /// The run this job already has, or null if nobody has queued it yet.
  ///
  /// A screen asks this rather than remembering a session id of its own: the
  /// job is only ever given one run, and a handheld that slept must come back
  /// to it rather than to a queue button that will be refused.
  async jobPrintSession(
    jobId: string,
    signal?: AbortSignal,
  ): Promise<PrintSessionSummary | null> {
    const body = await this.node.get<{ session: PrintSessionSummary | null }>(
      `/api/v1/dc/tagging-jobs/${encodeURIComponent(jobId)}/print-session`,
      { signal },
    );
    return body.session;
  }

  /// Move a run to the printer in front of whoever picked it up.
  repointPrintSession(
    sessionId: string,
    request: RepointPrinterRequest,
    signal?: AbortSignal,
  ): Promise<PrintSessionSummary> {
    return this.node.post<PrintSessionSummary>(
      `/api/v1/dc/print-sessions/${encodeURIComponent(sessionId)}/printer`,
      request,
      { signal },
    );
  }

  /// Put labels that already printed back in the queue.
  ///
  /// The same EPCs, never fresh ones: a tag that was destroyed after it
  /// printed still belongs to a unit the ledger knows about, and a second EPC
  /// for one garment reads downstream as a second garment.
  reprintLabels(
    sessionId: string,
    request: ReprintRequest,
    signal?: AbortSignal,
  ): Promise<PrintSessionSummary> {
    return this.node.post<PrintSessionSummary>(
      `/api/v1/dc/print-sessions/${encodeURIComponent(sessionId)}/reprint`,
      request,
      { signal },
    );
  }

  /// Print the next chunk. Called again until nothing is pending; a chunk the
  /// printer refused comes back around on a later call.
  runPrintChunk(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<PrintChunkReport> {
    return this.node.post<PrintChunkReport>(
      `/api/v1/dc/print-sessions/${encodeURIComponent(sessionId)}/run`,
      {},
      { signal },
    );
  }

  /// The tags are on the goods, said once for the whole job by the person who
  /// attached them. This is where a counted quantity becomes that many tracked
  /// units and enters the warehouse.
  confirmTagging(
    request: TaggingConfirmRequest,
    signal?: AbortSignal,
  ): Promise<TaggingConfirmResult> {
    return this.node.post<TaggingConfirmResult>(
      "/api/v1/dc/tagging-confirmations",
      request,
      { signal },
    );
  }

  // -------------------------------------------------------------------------
  // Picking. A SKU and a number, off a rack. No destination: which store each
  // piece serves is decided at the box.
  // -------------------------------------------------------------------------

  /// What is still owed, added up by SKU. Recomputed on every read — nobody
  /// authors this list.
  async picklist(signal?: AbortSignal): Promise<PicklistLine[]> {
    const body = await this.node.get<{ lines: PicklistLine[] }>(
      "/api/v1/dc/picklist",
      { signal },
    );
    return body.lines;
  }

  async pickSessions(
    filter?: ListFilter,
    signal?: AbortSignal,
  ): Promise<Session[]> {
    const body = await this.node.get<{ items: Session[] }>(
      `/api/v1/dc/pick-sessions${query(filter)}`,
      { signal },
    );
    return body.items;
  }

  openPickSession(
    request: OpenSessionRequest,
    signal?: AbortSignal,
  ): Promise<Session> {
    return this.node.post<Session>("/api/v1/dc/pick-sessions", request, {
      signal,
    });
  }

  pickSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<PickSessionSummary> {
    return this.node.get<PickSessionSummary>(
      `/api/v1/dc/pick-sessions/${encodeURIComponent(sessionId)}`,
      { signal },
    );
  }

  closePickSession(sessionId: string, signal?: AbortSignal): Promise<Session> {
    return this.node.post<Session>(
      `/api/v1/dc/pick-sessions/${encodeURIComponent(sessionId)}/close`,
      {},
      { signal },
    );
  }

  /// Take stock off a rack. `pick_session_id` is optional on purpose: fetching
  /// one thing without opening a round is ordinary work, and refusing it would
  /// make the paperwork the point instead of the goods.
  pick(request: PickRequest, signal?: AbortSignal): Promise<PickResult> {
    return this.node.post<PickResult>("/api/v1/dc/picks", request, { signal });
  }

  // -------------------------------------------------------------------------
  // Packing. The box is where a destination is chosen and an allotment line is
  // finally fulfilled.
  // -------------------------------------------------------------------------

  /// What can honestly go in a box for this store right now: what it still has
  /// coming, what is off the racks, and the smaller of the two.
  async outstandingFor(
    destinationStoreId: string,
    signal?: AbortSignal,
  ): Promise<OutstandingLine[]> {
    const body = await this.node.get<{ lines: OutstandingLine[] }>(
      `/api/v1/dc/destinations/${encodeURIComponent(destinationStoreId)}/outstanding`,
      { signal },
    );
    return body.lines;
  }

  async packingSessions(
    filter?: ListFilter,
    signal?: AbortSignal,
  ): Promise<Session[]> {
    const body = await this.node.get<{ items: Session[] }>(
      `/api/v1/dc/packing-sessions${query(filter)}`,
      { signal },
    );
    return body.items;
  }

  openPackingSession(
    request: OpenSessionRequest,
    signal?: AbortSignal,
  ): Promise<Session> {
    return this.node.post<Session>("/api/v1/dc/packing-sessions", request, {
      signal,
    });
  }

  packingSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<PackingSessionSummary> {
    return this.node.get<PackingSessionSummary>(
      `/api/v1/dc/packing-sessions/${encodeURIComponent(sessionId)}`,
      { signal },
    );
  }

  closePackingSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<Session> {
    return this.node.post<Session>(
      `/api/v1/dc/packing-sessions/${encodeURIComponent(sessionId)}/close`,
      {},
      { signal },
    );
  }

  async koli(filter?: ListFilter, signal?: AbortSignal): Promise<Koli[]> {
    const body = await this.node.get<{ items: Koli[] }>(
      `/api/v1/dc/koli${query(filter)}`,
      { signal },
    );
    return body.items;
  }

  /// Put swept EPCs into a box for one store. The answer names the allotment
  /// line each piece went to — attribution happens here, not at the rack.
  packKoli(
    request: PackKoliRequest,
    signal?: AbortSignal,
  ): Promise<FulfillmentProgressResult> {
    return this.node.post<FulfillmentProgressResult>(
      "/api/v1/dc/koli",
      request,
      {
        signal,
      },
    );
  }

  /// The packing list: what is in this box, its QR, and the sticker's ZPL —
  /// all three from one answer, so they cannot disagree.
  koliManifest(koliId: string, signal?: AbortSignal): Promise<KoliManifest> {
    return this.node.get<KoliManifest>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}`,
      { signal },
    );
  }

  assignKoli(
    koliId: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<Koli> {
    return this.node.post<Koli>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}/session`,
      { session_id: sessionId },
      { signal },
    );
  }

  /// Close the box. Its contents become final here, which is what makes the
  /// packing list worth printing.
  sealKoli(koliId: string, signal?: AbortSignal): Promise<KoliManifest> {
    return this.node.post<KoliManifest>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}/seal`,
      {},
      { signal },
    );
  }

  printKoliLabel(
    koliId: string,
    request: PrintKoliLabelRequest,
    signal?: AbortSignal,
  ): Promise<KoliManifest> {
    return this.node.post<KoliManifest>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}/label`,
      request,
      { signal },
    );
  }

  /// Open one box against a fixed target. The target is not editable
  /// afterwards: a target edited to match the sweep is not a target.
  openPackingBox(
    request: OpenPackingBoxRequest,
    signal?: AbortSignal,
  ): Promise<PackingBox> {
    return this.node.post<PackingBox>("/api/v1/dc/packing-boxes", request, {
      signal,
    });
  }

  packingBox(sessionId: string, signal?: AbortSignal): Promise<PackingBox> {
    return this.node.get<PackingBox>(
      `/api/v1/dc/packing-boxes/${encodeURIComponent(sessionId)}`,
      { signal },
    );
  }

  /// The sweep. A box that does not add up comes back 200 with the detail,
  /// because that is an ordinary answer a packer acts on.
  captureBox(
    sessionId: string,
    readerSessionId: string,
    signal?: AbortSignal,
  ): Promise<CaptureOutcome> {
    return this.node.post<CaptureOutcome>(
      `/api/v1/dc/packing-boxes/${encodeURIComponent(sessionId)}/capture`,
      { reader_session_id: readerSessionId },
      { signal },
    );
  }

  // -------------------------------------------------------------------------
  // Shipping. Boxes gather into a consignment; consignments gather onto a
  // truck; the truck leaving is the one stage change that moves goods in the
  // world.
  // -------------------------------------------------------------------------

  async shipments(
    filter?: ListFilter,
    signal?: AbortSignal,
  ): Promise<Shipment[]> {
    const body = await this.node.get<{ items: Shipment[] }>(
      `/api/v1/dc/shipments${query(filter)}`,
      { signal },
    );
    return body.items;
  }

  createShipment(
    request: CreateShipmentRequest,
    signal?: AbortSignal,
  ): Promise<Shipment> {
    return this.node.post<Shipment>("/api/v1/dc/shipments", request, {
      signal,
    });
  }

  shipment(shipmentId: string, signal?: AbortSignal): Promise<ShipmentDetail> {
    return this.node.get<ShipmentDetail>(
      `/api/v1/dc/shipments/${encodeURIComponent(shipmentId)}`,
      { signal },
    );
  }

  async dispatches(
    filter?: ListFilter,
    signal?: AbortSignal,
  ): Promise<Dispatch[]> {
    const body = await this.node.get<{ items: Dispatch[] }>(
      `/api/v1/dc/dispatches${query(filter)}`,
      { signal },
    );
    return body.items;
  }

  createDispatch(
    request: CreateDispatchRequest,
    signal?: AbortSignal,
  ): Promise<Dispatch> {
    return this.node.post<Dispatch>("/api/v1/dc/dispatches", request, {
      signal,
    });
  }

  dispatch(dispatchId: string, signal?: AbortSignal): Promise<DispatchDetail> {
    return this.node.get<DispatchDetail>(
      `/api/v1/dc/dispatches/${encodeURIComponent(dispatchId)}`,
      { signal },
    );
  }

  departDispatch(dispatchId: string, signal?: AbortSignal): Promise<Dispatch> {
    return this.node.post<Dispatch>(
      `/api/v1/dc/dispatches/${encodeURIComponent(dispatchId)}/depart`,
      {},
      { signal },
    );
  }

  /// Walk one carton to the next outbound stage.
  ///
  /// These are not the same thing as the shipment and dispatch documents above,
  /// and the difference has caught people out. A shipment says who is carrying
  /// a box; these three move the stock — each writes a movement group, taking
  /// the units from one outbound pool to the next. A warehouse that only files
  /// the paperwork leaves its goods sitting in `outbound.packed` while the
  /// consignment note claims they are on the road.
  koliToShipment(
    koliId: string,
    request: CreateKoliShipmentRequest,
    signal?: AbortSignal,
  ): Promise<FulfillmentProgressResult> {
    return this.node.post<FulfillmentProgressResult>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}/shipment`,
      request,
      { signal },
    );
  }

  /// Onto the truck, still on the yard.
  koliLoaded(
    koliId: string,
    request: AdvanceKoliRequest,
    signal?: AbortSignal,
  ): Promise<FulfillmentProgressResult> {
    return this.node.post<FulfillmentProgressResult>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}/dispatch`,
      request,
      { signal },
    );
  }

  /// Gone. The stock leaves this DC's pools here and nowhere else.
  koliInTransit(
    koliId: string,
    request: AdvanceKoliRequest,
    signal?: AbortSignal,
  ): Promise<FulfillmentProgressResult> {
    return this.node.post<FulfillmentProgressResult>(
      `/api/v1/dc/koli/${encodeURIComponent(koliId)}/in-transit`,
      request,
      { signal },
    );
  }

  /// Has the stock for this allotment line reached the store, or is it still
  /// on the road? Counted from containment, not from a tally kept beside it.
  allotmentLinePosition(
    allotmentLineId: string,
    signal?: AbortSignal,
  ): Promise<LinePosition> {
    return this.node.get<LinePosition>(
      `/api/v1/dc/allotment-lines/${encodeURIComponent(allotmentLineId)}/position`,
      { signal },
    );
  }

  // -------------------------------------------------------------------------
  // Stock itself: what is here, what happened to it, and the two writes a
  // warehouse makes directly rather than as a side effect of a document.
  // -------------------------------------------------------------------------

  /// Put one tagged piece into this DC.
  ///
  /// The ordinary way stock arrives is receiving and then tagging, and both of
  /// those write their own movements. This is the direct path — an opening
  /// balance, a piece recovered, a bench test — and it is deliberately one EPC
  /// at a time.
  intake(request: IntakeRequest, signal?: AbortSignal): Promise<unknown> {
    return this.node.post<unknown>("/api/v1/dc/intake", request, { signal });
  }

  /// Move stock between two pools this node owns.
  ///
  /// The ledger is append-only: a mistake is corrected by another movement
  /// that says what it is correcting, never by editing the one before it.
  move(request: MoveRequest, signal?: AbortSignal): Promise<unknown> {
    return this.node.post<unknown>("/api/v1/dc/movements", request, { signal });
  }

  /// The ledger, newest first. Capped by the node at 500.
  async movements(limit = 100, signal?: AbortSignal): Promise<MovementView[]> {
    const body = await this.node.get<{ items: MovementView[] }>(
      `/api/v1/inventory/movements?limit=${Math.trunc(limit)}`,
      { signal },
    );
    return body.items;
  }

  // -------------------------------------------------------------------------
  // Official counts. Authored and activated at the centre, executed here.
  // -------------------------------------------------------------------------

  async officialCounts(
    signal?: AbortSignal,
  ): Promise<EdgeOfficialCountSummary[]> {
    const body = await this.node.get<{ items: EdgeOfficialCountSummary[] }>(
      "/api/v1/dc/official-counts",
      { signal },
    );
    return body.items;
  }

  officialCount(
    countId: string,
    signal?: AbortSignal,
  ): Promise<EdgeOfficialCountDetail> {
    return this.node.get<EdgeOfficialCountDetail>(
      `/api/v1/dc/official-counts/${encodeURIComponent(countId)}`,
      { signal },
    );
  }

  recordCountEntries(
    countId: string,
    request: OfficialCountEntriesRequest,
    signal?: AbortSignal,
  ): Promise<EdgeOfficialCountDetail> {
    return this.node.post<EdgeOfficialCountDetail>(
      `/api/v1/dc/official-counts/${encodeURIComponent(countId)}/entries`,
      request,
      { signal },
    );
  }

  /// Submitting is what makes a difference a fact. Approval still happens at
  /// the centre.
  submitOfficialCount(
    countId: string,
    request: OfficialCountSubmitRequest,
    signal?: AbortSignal,
  ): Promise<OfficialCountSubmitResult> {
    return this.node.post<OfficialCountSubmitResult>(
      `/api/v1/dc/official-counts/${encodeURIComponent(countId)}/submit`,
      request,
      { signal },
    );
  }
}
