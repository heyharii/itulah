import type {
  AdvanceKoliRequest,
  AllotmentPick,
  CaptureOutcome,
  CreateDispatchRequest,
  CreateKoliShipmentRequest,
  CreateShipmentRequest,
  CreatePicklistRequest,
  DestinationDemand,
  Dispatch,
  DispatchDetail,
  DispatchTripRequest,
  EdgeOfficialCountDetail,
  EdgeOfficialCountSummary,
  FulfillmentProgressResult,
  GoodsReceiptView,
  InspectReturnRequest,
  InspectReturnResult,
  IntakeRequest,
  InvoiceDocumentView,
  Koli,
  KoliManifest,
  LabelPreview,
  LabelPreviewRequest,
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
  PackRequest,
  PicklistLine,
  PicklistResult,
  PicklistSummary,
  PickRequest,
  PickResult,
  PickSessionSummary,
  PrintChunkReport,
  PrinterProbe,
  PrintKoliLabelRequest,
  PrintSessionSummary,
  PurchaseCountAwaitingVerification,
  PurchaseCountRequest,
  PurchaseCountBatchRequest,
  PurchaseCountBatchResult,
  PurchaseCountRecallRequest,
  PurchaseCountRecallResult,
  PurchaseCountResult,
  PurchaseVerifyRequest,
  PurchaseVerifyResult,
  PurchaseWorkLine,
  RecordInvoiceRequest,
  RepointPrinterRequest,
  ReprintRequest,
  ReturnInspectionDetail,
  ReturnInspectionList,
  ReturnToInspect,
  Session,
  Shipment,
  ShipmentDetail,
  StoreInboundCountRequest,
  StoreInboundDelivery,
  StoreInboundDetail,
  StoreInboundList,
  StoreInboundReceiveRequest,
  TaggingConfirmRequest,
  TaggingConfirmResult,
  TaggingWorkJob,
} from "../index";
import { Node } from "./node";

/// `GET /api/v1/dc/purchase-orders/summary`.
export interface PurchaseSummary {
  readonly orders: number;
  /// Orders being counted again: sent back by the buyer, or recalled by the
  /// bay (0950). A recall also says who took it back, when, and what the
  /// recalled counts came to; a DC server that cannot recall leaves them out.
  readonly recounts: readonly {
    po_number: string;
    reason: string;
    recalled_by?: string | null;
    recalled_at?: string | null;
    was?: number | null;
  }[];
}

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
/// One reading session as `GET /api/v1/rfid/sessions` lists it.
export interface RfidSessionBrief {
  readonly reader_session_id: string;
  /// Distinct tags: the honest count of garments seen.
  readonly tag_count: number;
  readonly device_count: number;
  readonly last_seen_at: string | null;
}

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

  /// Keep the supplier's invoice as the paper it is.
  ///
  /// The numbers off it go through `recordInvoice`, and they are what gets
  /// compared against the order. This is the page behind them — one per
  /// delivery, because one lorry brings one invoice, and a second upload
  /// replaces the first rather than piling up.
  ///
  /// Name and type travel as query parameters so the browser can hand the
  /// `File` straight to `fetch` without re-encoding a scan. See
  /// `edge/http.rs`.
  uploadInvoiceDocument(
    receiptId: string,
    file: File,
    actorId: string,
    signal?: AbortSignal,
  ): Promise<InvoiceDocumentView> {
    const params = new URLSearchParams({ name: file.name, actor: actorId });
    if (file.type !== "") params.set("type", file.type);
    return this.node.upload<InvoiceDocumentView>(
      `/api/v1/dc/goods-receipts/${encodeURIComponent(receiptId)}/invoice-document?${params.toString()}`,
      file,
      { signal },
    );
  }

  /// The stored page back, as bytes.
  ///
  /// Not a URL a page can link to: this node authenticates with a bearer
  /// token that only this client holds, so an `<img src>` or an anchor would
  /// arrive without it and be refused. The caller makes an object URL.
  invoiceDocument(receiptId: string, signal?: AbortSignal): Promise<Blob> {
    return this.node.download(
      `/api/v1/dc/goods-receipts/${encodeURIComponent(receiptId)}/invoice-document`,
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

  /// What the screens outside Receiving read off its work list, without the
  /// list: how many orders are still owed a delivery (the badge) and which
  /// were sent back to be counted again, with the reason (the order book).
  /// The list is a line per article and grows with the open book.
  async purchaseSummary(signal?: AbortSignal): Promise<PurchaseSummary> {
    return this.node.get<PurchaseSummary>(
      "/api/v1/dc/purchase-orders/summary",
      { signal },
    );
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

  /// A whole count sheet in one command: every counted line of one order,
  /// one delivery document, one transaction. The per-line
  /// [`countPurchase`] remains the shape of a single line; this is what a
  /// sheet submits, so N lines cost one round trip instead of N.
  countPurchases(
    request: PurchaseCountBatchRequest,
    signal?: AbortSignal,
  ): Promise<PurchaseCountBatchResult> {
    return this.node.post<PurchaseCountBatchResult>(
      "/api/v1/dc/purchase-counts/batch",
      request,
      { signal },
    );
  }

  /// Take back a count sheet nobody has decided on yet (0950): every count
  /// named, of one order, still waiting for review. Refused (409) once the
  /// buyer accepted it or sent it back. The counts stay, as RECALLED, and the
  /// lines are owed a count again.
  recallCounts(
    request: PurchaseCountRecallRequest,
    signal?: AbortSignal,
  ): Promise<PurchaseCountRecallResult> {
    return this.node.post<PurchaseCountRecallResult>(
      "/api/v1/dc/purchase-counts/recall",
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

  /// Ask whether the machine this bench is pointed at is actually there.
  ///
  /// Prints nothing, deliberately: a test that printed would drop a tag on the
  /// floor every time somebody checked a setting, and on RFID stock that tag
  /// carries an EPC. What comes back says a socket opened — not that a label
  /// will come out.
  ///
  /// The node opens the socket, not the browser: a page cannot reach a printer
  /// on the warehouse LAN, and it is the node that will have to reach it when
  /// the run starts. Testing from anywhere else would answer a question nobody
  /// asked.
  testPrinter(
    request: { printer_host: string; printer_port: number },
    signal?: AbortSignal,
  ): Promise<PrinterProbe> {
    return this.node.post<PrinterProbe>("/api/v1/dc/printer/test", request, {
      signal,
    });
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

  /// Draw one of a job's labels without printing it.
  ///
  /// A read, despite the POST — it carries a body (the stock in the machine,
  /// and which line of the job to draw) and claims nothing. Calling it twice
  /// costs a ribbon nothing, which is the point: until this existed, the first
  /// time anybody saw a hang tag was when it came off the printer.
  previewJobLabel(
    jobId: string,
    request: LabelPreviewRequest,
    signal?: AbortSignal,
  ): Promise<LabelPreview> {
    return this.node.post<LabelPreview>(
      `/api/v1/dc/tagging-jobs/${encodeURIComponent(jobId)}/label-preview`,
      request,
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

  /// Every picklist this DC has raised, newest first.
  ///
  /// The rounds themselves, which is a different question from `picklist()`
  /// above: that one says what is still owed, this one says what has been
  /// fetched and by whom.
  async picklists(signal?: AbortSignal): Promise<PicklistSummary[]> {
    const body = await this.node.get<{ items: PicklistSummary[] }>(
      "/api/v1/dc/picklists",
      { signal },
    );
    return body.items;
  }

  /// Every picklist still to pick, one per allotment × shop — nobody
  /// composes one (owner, 29 Sep 2026): it exists as soon as the allotment
  /// is here, and accepting it is the pick. Grouped by shop, oldest
  /// allotment first within it.
  async picklistsToPick(signal?: AbortSignal): Promise<AllotmentPick[]> {
    const body = await this.node.get<{ items: AllotmentPick[] }>(
      "/api/v1/dc/picklist/allotments",
      { signal },
    );
    return body.items;
  }

  /// Raise a picklist: a round opened, walked and closed in one act.
  ///
  /// One request rather than one per line. A round that dropped halfway
  /// through warehouse wifi would otherwise be half a document, and nothing on
  /// the sheet would say which half.
  createPicklist(
    request: CreatePicklistRequest,
    signal?: AbortSignal,
  ): Promise<PicklistResult> {
    return this.node.post<PicklistResult>("/api/v1/dc/picklists", request, {
      signal,
    });
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

  /// Pack a carton by saying how much, and let the node name the pieces.
  ///
  /// The EPC form below is the same act described by an RFID reader. This one
  /// is the act described by a person, which is what a bench without a reader
  /// has: quantities off a sheet, and the server chooses which garments answer
  /// to them — FIFO out of the picking area, exactly as picking chooses what
  /// comes off a rack.
  pack(request: PackRequest, signal?: AbortSignal): Promise<KoliManifest> {
    return this.node.post<KoliManifest>("/api/v1/dc/packs", request, {
      signal,
    });
  }

  /// Every shop this DC still owes something to — the packer's queue.
  ///
  /// **An edge node had no list of destinations until this.** Allotments are
  /// authored at the centre, so the packing screens asked somebody to type a
  /// store id and offered the shops the DC had previously packed for as a
  /// guess. The node knew all along: a shop it owes something to has lines in
  /// its own allotment work.
  async destinations(signal?: AbortSignal): Promise<DestinationDemand[]> {
    const body = await this.node.get<{ items: DestinationDemand[] }>(
      "/api/v1/dc/destinations",
      { signal },
    );
    return body.items;
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

  /// Every box opened against a target that no sweep has matched yet.
  async packingBoxes(signal?: AbortSignal): Promise<PackingBox[]> {
    const body = await this.node.get<{ items: PackingBox[] }>(
      "/api/v1/dc/packing-boxes",
      { signal },
    );
    return body.items;
  }

  packingBox(sessionId: string, signal?: AbortSignal): Promise<PackingBox> {
    return this.node.get<PackingBox>(
      `/api/v1/dc/packing-boxes/${encodeURIComponent(sessionId)}`,
      { signal },
    );
  }

  /// The reading sessions this node has heard from, newest first. A packer
  /// sweeps a box with a handheld or an arch; the sweep is filed under a
  /// reader session, and that id is what `captureBox` checks against.
  async rfidSessions(signal?: AbortSignal): Promise<RfidSessionBrief[]> {
    const body = await this.node.get<{ items: RfidSessionBrief[] }>(
      "/api/v1/rfid/sessions",
      { signal },
    );
    return body.items;
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

  /// Dispatch: sealed cartons onto one trip, in one act.
  ///
  /// Owner, 29 Sep 2026: there is no Shipments station. This one call groups
  /// the cartons ticked by shop, makes one surat jalan per shop, puts them on
  /// one trip and the goods are in transit — generating the surat jalan IS
  /// sending it.
  dispatchTrip(
    request: DispatchTripRequest,
    signal?: AbortSignal,
  ): Promise<DispatchDetail> {
    return this.node.post<DispatchDetail>(
      "/api/v1/dc/dispatch-trips",
      request,
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

  // ---------------------------------------------------------------------------
  // A store's return, received here blind and then inspected — 0625/0626.
  // ---------------------------------------------------------------------------

  /// Deliveries head office has announced to this warehouse: blind while
  /// IN_TRANSIT, compared once RECEIVED. `status` narrows the list;
  /// omit it (or pass `"ALL"`) for every delivery.
  async storeInboundList(
    status?: string,
    signal?: AbortSignal,
  ): Promise<StoreInboundDelivery[]> {
    const body = await this.node.get<StoreInboundList>(
      `/api/v1/dc/inbound${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      { signal },
    );
    return body.deliveries;
  }

  /// One delivery; its per-SKU comparison is only there once RECEIVED.
  storeInboundDetail(
    deliveryId: string,
    signal?: AbortSignal,
  ): Promise<StoreInboundDetail> {
    return this.node.get<StoreInboundDetail>(
      `/api/v1/dc/inbound/${encodeURIComponent(deliveryId)}`,
      { signal },
    );
  }

  /// Receive an announced delivery from what the handheld swept.
  receiveStoreInbound(
    deliveryId: string,
    request: StoreInboundReceiveRequest,
    signal?: AbortSignal,
  ): Promise<StoreInboundDetail> {
    return this.node.post<StoreInboundDetail>(
      `/api/v1/dc/inbound/${encodeURIComponent(deliveryId)}/receive`,
      request,
      { signal },
    );
  }

  /// Receive an announced delivery from a blind count per SKU, no reader
  /// (owner, 29 Sep 2026: receiving needs no RFID).
  receiveInboundByCount(
    deliveryId: string,
    request: StoreInboundCountRequest,
    signal?: AbortSignal,
  ): Promise<StoreInboundDetail> {
    return this.node.post<StoreInboundDetail>(
      `/api/v1/dc/inbound/${encodeURIComponent(deliveryId)}/receive-count`,
      request,
      { signal },
    );
  }

  /// Received returns with units still standing in their store's return pool.
  async returnInspections(signal?: AbortSignal): Promise<ReturnToInspect[]> {
    const body = await this.node.get<ReturnInspectionList>(
      "/api/v1/dc/inspections",
      { signal },
    );
    return body.deliveries;
  }

  /// One received return and the units still waiting in its return pool.
  returnInspection(
    deliveryId: string,
    signal?: AbortSignal,
  ): Promise<ReturnInspectionDetail> {
    return this.node.get<ReturnInspectionDetail>(
      `/api/v1/dc/inbound/${encodeURIComponent(deliveryId)}/inspection`,
      { signal },
    );
  }

  /// Inspect a received return: good goods to the racks, damaged to reject.
  inspectReturn(
    deliveryId: string,
    request: InspectReturnRequest,
    signal?: AbortSignal,
  ): Promise<InspectReturnResult> {
    return this.node.post<InspectReturnResult>(
      `/api/v1/dc/inbound/${encodeURIComponent(deliveryId)}/inspection`,
      request,
      { signal },
    );
  }
}
