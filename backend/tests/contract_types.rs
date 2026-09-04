//! The browser's types come from Rust, not from a person copying them.
//!
//! Everything the till and the consoles receive is declared once, in the
//! structs the server actually serialises. Hand-written TypeScript mirroring
//! those structs is the same disease this system has had three times already —
//! two implementations of one truth, agreeing on every ordinary day and parting
//! company on the day somebody adds a field.
//!
//! Running this test writes the bindings. It is a test rather than a build
//! script so that generating them is a deliberate act (`make contract`) and so
//! that CI fails when the committed files no longer match the structs: run it,
//! and if `git status` is dirty, somebody changed the wire and did not
//! regenerate.

#![cfg(feature = "ts")]

use ts_rs::TS;

#[test]
fn the_wire_types_are_written_for_the_browser() {
    // Where the browser's package expects them.
    let config = ts_rs::Config::new()
        .with_out_dir("../frontend-contract/src")
        // 64-bit integers as `number`, not `bigint`.
        //
        // `bigint` is the technically faithful mapping and it would be a lie
        // here: `JSON.parse` produces a `number`, so a type saying `bigint`
        // describes a value the browser never actually receives, and every
        // comparison against it would be wrong in a way TypeScript would call
        // correct.
        //
        // `number` is safe for what these fields hold. They are money in the
        // smallest unit, quantities, and version counters; the largest exactly
        // representable integer in JavaScript is about nine quadrillion, which
        // is more rupiah than exists. Anything that could genuinely exceed it
        // would have to be modelled as a string on the wire, deliberately.
        .with_large_int("number");

    // Signing in. Every node speaks this, and it is the one exchange whose
    // types being wrong is invisible until nobody can log in.
    inventory_backend::contract::LoginRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("LoginRequest: {e}"));
    inventory_backend::contract::LoginResponse::export_all(&config)
        .unwrap_or_else(|e| panic!("LoginResponse: {e}"));
    inventory_backend::contract::SessionUser::export_all(&config)
        .unwrap_or_else(|e| panic!("SessionUser: {e}"));
    inventory_backend::contract::CloudMe::export_all(&config)
        .unwrap_or_else(|e| panic!("CloudMe: {e}"));
    inventory_backend::contract::EdgeMe::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeMe: {e}"));
    inventory_backend::contract::Role::export_all(&config).unwrap_or_else(|e| panic!("Role: {e}"));

    // What an Edge says about its own outbox, and what "send it now" answers.
    inventory_backend::contract::EdgeSyncStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeSyncStatus: {e}"));
    inventory_backend::contract::EdgeSyncTriggered::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeSyncTriggered: {e}"));

    // Account administration. An admin screen posts these, and until they were
    // exported the only way to build one was to hand-write the shapes beside
    // the Rust that parses them.
    inventory_backend::contract::CreateUserRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateUserRequest: {e}"));
    inventory_backend::contract::SetUserActiveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetUserActiveRequest: {e}"));
    inventory_backend::contract::SetUserRoleRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetUserRoleRequest: {e}"));
    inventory_backend::contract::ChangePasswordRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ChangePasswordRequest: {e}"));
    inventory_backend::contract::ResetPasswordRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ResetPasswordRequest: {e}"));
    inventory_backend::contract::UpsertEdgeAssignmentRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpsertEdgeAssignmentRequest: {e}"));
    inventory_backend::contract::SetEdgeAssignmentActiveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetEdgeAssignmentActiveRequest: {e}"));

    // Each of these is something a browser is handed by an HTTP route. The
    // list is the contract; anything not on it is server-side only.
    inventory_backend::edge::SaleRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleRequest: {e}"));
    inventory_backend::edge::SaleResult::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleResult: {e}"));
    inventory_backend::edge::ReceiveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReceiveRequest: {e}"));
    inventory_backend::edge::MoveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MoveRequest: {e}"));
    inventory_backend::edge::PoolBalance::export_all(&config)
        .unwrap_or_else(|e| panic!("PoolBalance: {e}"));
    inventory_backend::edge::pricing::CatalogRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CatalogRow: {e}"));
    inventory_backend::edge::pricing::Quote::export_all(&config)
        .unwrap_or_else(|e| panic!("Quote: {e}"));

    // The promotion document itself, exported from the engine that reads it.
    //
    // `CreateCommercialPublicationRequest.rules` is `Vec<pricing_engine::Rule>`,
    // so a book's promotions are deserialised straight into the engine's own
    // type — `Money` and all, which is `{minor}` and not a bare number. The
    // Cloud composer transcribed these by hand and got that wrong, and because
    // the mismatch is caught by axum's JSON extractor rather than by any
    // validator, every promotion a merchandiser wrote came back as a serde
    // error naming a Rust type. Generated from the struct, that cannot recur.
    pricing_engine::Rule::export_all(&config).unwrap_or_else(|e| panic!("Rule: {e}"));

    // What a warehouse screen is handed.
    inventory_backend::edge::PurchaseWorkLine::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseWorkLine: {e}"));
    inventory_backend::edge::PurchaseCountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseCountRequest: {e}"));
    inventory_backend::edge::PurchaseVerifyRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseVerifyRequest: {e}"));
    inventory_backend::edge::GoodsReceiptView::export_all(&config)
        .unwrap_or_else(|e| panic!("GoodsReceiptView: {e}"));
    inventory_backend::edge::OpenGoodsReceiptRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenGoodsReceiptRequest: {e}"));
    inventory_backend::edge::TaggingWorkJob::export_all(&config)
        .unwrap_or_else(|e| panic!("TaggingWorkJob: {e}"));
    inventory_backend::edge::TaggingConfirmRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("TaggingConfirmRequest: {e}"));
    inventory_backend::edge::TaggingConfirmResult::export_all(&config)
        .unwrap_or_else(|e| panic!("TaggingConfirmResult: {e}"));
    // Putting a tagged piece into this DC, and walking one carton through the
    // outbound stages. The stage advances are what actually move stock; the
    // shipment and dispatch documents only say who is carrying it.
    inventory_backend::edge::IntakeRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("IntakeRequest: {e}"));
    inventory_backend::edge::CreateKoliShipmentRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateKoliShipmentRequest: {e}"));
    inventory_backend::edge::AdvanceKoliRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("AdvanceKoliRequest: {e}"));
    inventory_backend::edge::PickRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PickRequest: {e}"));
    inventory_backend::edge::PickResult::export_all(&config)
        .unwrap_or_else(|e| panic!("PickResult: {e}"));
    inventory_backend::edge::PackKoliRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PackKoliRequest: {e}"));
    // What packing answers: which allotment line each EPC in the box went
    // to. Attribution happens at the box, not at the rack, so this is the
    // only place a packer can see it.
    inventory_backend::edge::FulfillmentProgressResult::export_all(&config)
        .unwrap_or_else(|e| panic!("FulfillmentProgressResult: {e}"));
    inventory_backend::edge::MovementView::export_all(&config)
        .unwrap_or_else(|e| panic!("MovementView: {e}"));
    inventory_backend::edge::EdgeOfficialCountSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeOfficialCountSummary: {e}"));

    // Receiving, past the count: what the verifier decides on, what the
    // decision answers, and the supplier's invoice recorded against the
    // delivery.
    inventory_backend::edge::PurchaseCountResult::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseCountResult: {e}"));
    inventory_backend::edge::PurchaseVerifyResult::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseVerifyResult: {e}"));
    inventory_backend::edge::PurchaseCountAwaitingVerification::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseCountAwaitingVerification: {e}"));
    inventory_backend::edge::RecordInvoiceRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordInvoiceRequest: {e}"));

    // An Official Count as the warehouse works it: the sheet, the entries it
    // posts, and what submitting one answers.
    inventory_backend::edge::EdgeOfficialCountLine::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeOfficialCountLine: {e}"));
    inventory_backend::edge::EdgeOfficialCountDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeOfficialCountDetail: {e}"));
    inventory_backend::edge::OfficialCountEntryInput::export_all(&config)
        .unwrap_or_else(|e| panic!("OfficialCountEntryInput: {e}"));
    inventory_backend::edge::OfficialCountEntriesRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OfficialCountEntriesRequest: {e}"));
    inventory_backend::edge::OfficialCountSubmitRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OfficialCountSubmitRequest: {e}"));
    inventory_backend::edge::OfficialCountSubmitResult::export_all(&config)
        .unwrap_or_else(|e| panic!("OfficialCountSubmitResult: {e}"));

    // Outbound, end to end: the two session kinds, the picker's sheet, the
    // box and its manifest, and the consignment and truck run they roll up
    // into. A warehouse screen drives all of it, and every one of these was
    // previously reachable only by hand-writing its shape beside the Rust.
    inventory_backend::edge::outbound::Session::export_all(&config)
        .unwrap_or_else(|e| panic!("Session: {e}"));
    inventory_backend::edge::outbound::OpenSessionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenSessionRequest: {e}"));
    inventory_backend::edge::outbound::PickedLine::export_all(&config)
        .unwrap_or_else(|e| panic!("PickedLine: {e}"));
    inventory_backend::edge::outbound::PickSessionSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("PickSessionSummary: {e}"));
    inventory_backend::edge::outbound::PicklistLine::export_all(&config)
        .unwrap_or_else(|e| panic!("PicklistLine: {e}"));
    inventory_backend::edge::outbound::OutstandingLine::export_all(&config)
        .unwrap_or_else(|e| panic!("OutstandingLine: {e}"));
    inventory_backend::edge::outbound::TargetLine::export_all(&config)
        .unwrap_or_else(|e| panic!("TargetLine: {e}"));
    inventory_backend::edge::outbound::OpenPackingBoxRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenPackingBoxRequest: {e}"));
    inventory_backend::edge::outbound::PackingBox::export_all(&config)
        .unwrap_or_else(|e| panic!("PackingBox: {e}"));
    inventory_backend::edge::outbound::CaptureLine::export_all(&config)
        .unwrap_or_else(|e| panic!("CaptureLine: {e}"));
    inventory_backend::edge::outbound::CaptureOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("CaptureOutcome: {e}"));
    inventory_backend::edge::outbound::ManifestLine::export_all(&config)
        .unwrap_or_else(|e| panic!("ManifestLine: {e}"));
    inventory_backend::edge::outbound::Koli::export_all(&config)
        .unwrap_or_else(|e| panic!("Koli: {e}"));
    inventory_backend::edge::outbound::KoliManifest::export_all(&config)
        .unwrap_or_else(|e| panic!("KoliManifest: {e}"));
    inventory_backend::edge::outbound::PackingSessionSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("PackingSessionSummary: {e}"));
    inventory_backend::edge::outbound::PrintKoliLabelRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PrintKoliLabelRequest: {e}"));
    inventory_backend::edge::outbound::Shipment::export_all(&config)
        .unwrap_or_else(|e| panic!("Shipment: {e}"));
    inventory_backend::edge::outbound::CreateShipmentRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateShipmentRequest: {e}"));
    inventory_backend::edge::outbound::ShipmentDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("ShipmentDetail: {e}"));
    inventory_backend::edge::outbound::Dispatch::export_all(&config)
        .unwrap_or_else(|e| panic!("Dispatch: {e}"));
    inventory_backend::edge::outbound::CreateDispatchRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateDispatchRequest: {e}"));
    inventory_backend::edge::outbound::DispatchDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("DispatchDetail: {e}"));
    inventory_backend::edge::outbound::LinePosition::export_all(&config)
        .unwrap_or_else(|e| panic!("LinePosition: {e}"));

    // The label queue: what the warehouse asks the printer for, and how far
    // it has got.
    inventory_backend::edge::printing::OpenPrintSessionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenPrintSessionRequest: {e}"));
    inventory_backend::edge::printing::PrintSessionSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("PrintSessionSummary: {e}"));
    inventory_backend::edge::printing::RepointPrinterRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RepointPrinterRequest: {e}"));
    inventory_backend::edge::printing::LabelPreviewRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("LabelPreviewRequest: {e}"));
    inventory_backend::edge::printing::LabelPreview::export_all(&config)
        .unwrap_or_else(|e| panic!("LabelPreview: {e}"));
    inventory_backend::edge::printing::ReprintRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReprintRequest: {e}"));
    inventory_backend::edge::printing::PrintChunkReport::export_all(&config)
        .unwrap_or_else(|e| panic!("PrintChunkReport: {e}"));

    // Sourcing and suppliers: the first screens the centre gets.
    inventory_backend::cloud::domain::Supplier::export_all(&config)
        .unwrap_or_else(|e| panic!("Supplier: {e}"));
    inventory_backend::cloud::domain::SupplierItem::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierItem: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateSupplierRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateSupplierRequest: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierItemRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierItemRequest: {e}"));
    inventory_backend::cloud::postgres::CatalogPurchaseOrderRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CatalogPurchaseOrderRequest: {e}"));
    inventory_backend::cloud::postgres::SourcedItem::export_all(&config)
        .unwrap_or_else(|e| panic!("SourcedItem: {e}"));
    inventory_backend::cloud::postgres::SourcingPage::export_all(&config)
        .unwrap_or_else(|e| panic!("SourcingPage: {e}"));
    inventory_backend::cloud::postgres::SourcingFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("SourcingFacets: {e}"));
    inventory_backend::cloud::postgres::FacetCount::export_all(&config)
        .unwrap_or_else(|e| panic!("FacetCount: {e}"));
    inventory_backend::cloud::postgres::CatalogueVocabulary::export_all(&config)
        .unwrap_or_else(|e| panic!("CatalogueVocabulary: {e}"));
    inventory_backend::cloud::postgres::VocabularyTerm::export_all(&config)
        .unwrap_or_else(|e| panic!("VocabularyTerm: {e}"));

    // The buyer's basket. Picked out, not yet ordered — and now a record the
    // server keeps rather than a set of ids in one browser's storage.
    inventory_backend::cloud::postgres::BasketLine::export_all(&config)
        .unwrap_or_else(|e| panic!("BasketLine: {e}"));
    inventory_backend::cloud::postgres::AddToBasketRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("AddToBasketRequest: {e}"));
    inventory_backend::cloud::postgres::SetBasketQuantityRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetBasketQuantityRequest: {e}"));

    // What a member sees of their own custom: points earned, purchases, one
    // receipt. Read-only, and derived entirely from sales the shops reported —
    // so a member's screen and the centre's revenue cannot disagree.
    inventory_backend::cloud::postgres::CustomerSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("CustomerSummary: {e}"));
    inventory_backend::cloud::postgres::CustomerTransaction::export_all(&config)
        .unwrap_or_else(|e| panic!("CustomerTransaction: {e}"));
    inventory_backend::cloud::postgres::CustomerTransactionLine::export_all(&config)
        .unwrap_or_else(|e| panic!("CustomerTransactionLine: {e}"));
    inventory_backend::cloud::postgres::CustomerTransactionDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("CustomerTransactionDetail: {e}"));
    inventory_backend::cloud::postgres::CustomerTransactionPage::export_all(&config)
        .unwrap_or_else(|e| panic!("CustomerTransactionPage: {e}"));
    inventory_backend::cloud::postgres::MemberIdentity::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberIdentity: {e}"));
    inventory_backend::cloud::postgres::IssuedPairingCode::export_all(&config)
        .unwrap_or_else(|e| panic!("IssuedPairingCode: {e}"));
    inventory_backend::cloud::http::member::MemberSessionResponse::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberSessionResponse: {e}"));

    // Where an order can be delivered — the purchasing question, asked without
    // the administration privilege the sync origin register requires.
    inventory_backend::cloud::postgres::PurchaseDestination::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseDestination: {e}"));

    // Talking: conversations, discussions, and the files both carry.
    //
    // These matter here more than most. A conversation's `latest_message_seq`
    // and `last_read_seq` are the two numbers that place the unread line, and
    // a browser that hand-mirrored them one field apart would draw that line
    // in the wrong place without anything failing.
    inventory_backend::cloud::postgres::ChatConversation::export_all(&config)
        .unwrap_or_else(|e| panic!("ChatConversation: {e}"));
    inventory_backend::cloud::postgres::ChatMessage::export_all(&config)
        .unwrap_or_else(|e| panic!("ChatMessage: {e}"));
    inventory_backend::cloud::postgres::StartConversationRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("StartConversationRequest: {e}"));
    inventory_backend::cloud::postgres::SendMessageRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SendMessageRequest: {e}"));
    inventory_backend::cloud::postgres::MarkReadRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MarkReadRequest: {e}"));
    inventory_backend::cloud::postgres::CollaborationEvent::export_all(&config)
        .unwrap_or_else(|e| panic!("CollaborationEvent: {e}"));

    inventory_backend::cloud::postgres::DiscussionThread::export_all(&config)
        .unwrap_or_else(|e| panic!("DiscussionThread: {e}"));
    inventory_backend::cloud::postgres::DiscussionPost::export_all(&config)
        .unwrap_or_else(|e| panic!("DiscussionPost: {e}"));
    inventory_backend::cloud::postgres::OpenThreadRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenThreadRequest: {e}"));
    inventory_backend::cloud::postgres::ReplyRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReplyRequest: {e}"));
    inventory_backend::cloud::postgres::SubjectCount::export_all(&config)
        .unwrap_or_else(|e| panic!("SubjectCount: {e}"));
    inventory_backend::cloud::http::discussion::AcceptSolutionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("AcceptSolutionRequest: {e}"));
    inventory_backend::cloud::http::discussion::SetThreadStatusRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetThreadStatusRequest: {e}"));
    inventory_backend::cloud::http::discussion::SetBookmarkRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetBookmarkRequest: {e}"));

    // Work that found a person. The read state is per reader, which is why
    // `read_at` sits on the notification a reader is handed rather than on the
    // notification itself — a browser mirroring this by hand would sooner or
    // later show one person's cleared badge to everybody.
    inventory_backend::cloud::postgres::Notification::export_all(&config)
        .unwrap_or_else(|e| panic!("Notification: {e}"));
    inventory_backend::cloud::postgres::NotificationPage::export_all(&config)
        .unwrap_or_else(|e| panic!("NotificationPage: {e}"));
    // One line of the activity log. Read by every record sheet, so the browser
    // must not be transcribing its shape.
    inventory_backend::cloud::postgres::AuditEntry::export_all(&config)
        .unwrap_or_else(|e| panic!("AuditEntry: {e}"));
    // What a buyer has already ordered of one supplier item. Carried on every
    // sourcing row, so the browser must not be transcribing its shape.
    inventory_backend::cloud::postgres::PurchaseHistory::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseHistory: {e}"));

    inventory_backend::cloud::postgres::StoredFile::export_all(&config)
        .unwrap_or_else(|e| panic!("StoredFile: {e}"));
    inventory_backend::cloud::postgres::FileInContext::export_all(&config)
        .unwrap_or_else(|e| panic!("FileInContext: {e}"));

    // Finance.
    //
    // The chart of accounts is the client's own — 7,528 accounts, imported
    // verbatim — so `LedgerAccount.name` is Indonesian and stays that way. A
    // browser that translated it would be showing an account the accountant
    // cannot find in their own books.
    //
    // `SemanticKeyDoc` is the one that has to be generated rather than
    // hand-written: it is the list of meanings the posting rules ask for, and
    // the Account Map screen renders it directly. A copy that drifted would
    // quietly stop asking somebody to map a key, and the failure would arrive
    // weeks later as a refused posting.
    inventory_backend::cloud::postgres::LedgerAccount::export_all(&config)
        .unwrap_or_else(|e| panic!("LedgerAccount: {e}"));
    inventory_backend::cloud::postgres::AccountBalance::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountBalance: {e}"));
    inventory_backend::cloud::postgres::TrialBalance::export_all(&config)
        .unwrap_or_else(|e| panic!("TrialBalance: {e}"));
    inventory_backend::cloud::postgres::TrialBalanceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TrialBalanceRow: {e}"));
    inventory_backend::cloud::postgres::AccountMapping::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountMapping: {e}"));
    inventory_backend::cloud::postgres::SetAccountMappingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetAccountMappingRequest: {e}"));
    inventory_backend::cloud::postgres::SemanticKeyDoc::export_all(&config)
        .unwrap_or_else(|e| panic!("SemanticKeyDoc: {e}"));
    inventory_backend::cloud::postgres::BookLocation::export_all(&config)
        .unwrap_or_else(|e| panic!("BookLocation: {e}"));
    inventory_backend::cloud::postgres::FiscalPeriod::export_all(&config)
        .unwrap_or_else(|e| panic!("FiscalPeriod: {e}"));
    inventory_backend::cloud::postgres::JournalEntryRow::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalEntryRow: {e}"));
    inventory_backend::cloud::postgres::JournalLineView::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalLineView: {e}"));
    inventory_backend::cloud::postgres::JournalEntryDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalEntryDetail: {e}"));
    inventory_backend::cloud::postgres::GeneralLedger::export_all(&config)
        .unwrap_or_else(|e| panic!("GeneralLedger: {e}"));
    inventory_backend::cloud::postgres::GeneralLedgerRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GeneralLedgerRow: {e}"));
    inventory_backend::cloud::http::finance::AccountDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountDetail: {e}"));
    inventory_backend::cloud::http::finance::PeriodRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PeriodRequest: {e}"));

    // Positions and statements. One matrix shape serves every "what is this
    // family worth, per location" screen, and one statement shape serves the
    // balance sheet and the profit and loss — which differ only in which of the
    // client's root classes they cover and whether the window has a start.
    inventory_backend::cloud::postgres::BalanceMatrix::export_all(&config)
        .unwrap_or_else(|e| panic!("BalanceMatrix: {e}"));
    inventory_backend::cloud::postgres::BalanceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BalanceRow: {e}"));
    inventory_backend::cloud::postgres::Statement::export_all(&config)
        .unwrap_or_else(|e| panic!("Statement: {e}"));
    inventory_backend::cloud::postgres::StatementSection::export_all(&config)
        .unwrap_or_else(|e| panic!("StatementSection: {e}"));
    inventory_backend::cloud::postgres::StatementLine::export_all(&config)
        .unwrap_or_else(|e| panic!("StatementLine: {e}"));

    // Supplier bills. `UnbilledReceipt` is the one that needs explaining: it is
    // not a balance and has no account behind it, because the client has no
    // goods-received-not-invoiced account. It is the exposure that the books
    // cannot carry, reported so somebody can see it anyway.
    inventory_backend::cloud::postgres::SupplierBill::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierBill: {e}"));
    inventory_backend::cloud::postgres::RecordBillRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordBillRequest: {e}"));
    inventory_backend::cloud::postgres::UnbilledReceipt::export_all(&config)
        .unwrap_or_else(|e| panic!("UnbilledReceipt: {e}"));

    // Supplier payments: the other half of a bill. `SupplierPayment` carries
    // its allocations inline because a payment without them is meaningless —
    // the header says only that money left.
    inventory_backend::cloud::postgres::SupplierPayment::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierPayment: {e}"));
    inventory_backend::cloud::postgres::PaymentAllocation::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentAllocation: {e}"));
    inventory_backend::cloud::postgres::RecordPaymentRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordPaymentRequest: {e}"));
    inventory_backend::cloud::postgres::AllocateToBill::export_all(&config)
        .unwrap_or_else(|e| panic!("AllocateToBill: {e}"));

    // Payables ageing. `AgingBuckets` is one shape used twice — per supplier
    // and for the footer — so the total does not have to invent a supplier id.
    inventory_backend::cloud::postgres::PayablesAging::export_all(&config)
        .unwrap_or_else(|e| panic!("PayablesAging: {e}"));
    inventory_backend::cloud::postgres::PayablesAgingRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PayablesAgingRow: {e}"));
    inventory_backend::cloud::postgres::AgingBuckets::export_all(&config)
        .unwrap_or_else(|e| panic!("AgingBuckets: {e}"));

    // Fixed assets. `AssetRow.decision` is an Option on purpose: absent means
    // nobody has assessed the asset, which is an open control gap and must not
    // render the same as "assessed and expensed".
    inventory_backend::cloud::postgres::AssetRow::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetRow: {e}"));
    inventory_backend::cloud::postgres::RegisterAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RegisterAssetRequest: {e}"));
    inventory_backend::cloud::postgres::AssessAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("AssessAssetRequest: {e}"));
    inventory_backend::cloud::postgres::DepreciationRun::export_all(&config)
        .unwrap_or_else(|e| panic!("DepreciationRun: {e}"));
    inventory_backend::cloud::postgres::DepreciationLine::export_all(&config)
        .unwrap_or_else(|e| panic!("DepreciationLine: {e}"));
    inventory_backend::cloud::domain::DepreciationMethod::export_all(&config)
        .unwrap_or_else(|e| panic!("DepreciationMethod: {e}"));
    inventory_backend::cloud::domain::SkipReason::export_all(&config)
        .unwrap_or_else(|e| panic!("SkipReason: {e}"));

    // Bank reconciliation. `Suggestion.reasons` is the field that matters: a
    // 0-100 score explains nothing about which field agreed, and the person
    // accepting a match is reading the reasons, not the number.
    inventory_backend::cloud::postgres::BankStatementRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BankStatementRow: {e}"));
    inventory_backend::cloud::postgres::BankStatementLineRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BankStatementLineRow: {e}"));
    inventory_backend::cloud::postgres::ImportStatementRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ImportStatementRequest: {e}"));
    inventory_backend::cloud::postgres::ImportStatementLine::export_all(&config)
        .unwrap_or_else(|e| panic!("ImportStatementLine: {e}"));
    inventory_backend::cloud::postgres::ImportOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("ImportOutcome: {e}"));
    inventory_backend::cloud::postgres::LineSuggestions::export_all(&config)
        .unwrap_or_else(|e| panic!("LineSuggestions: {e}"));
    inventory_backend::cloud::postgres::ConfirmMatchRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ConfirmMatchRequest: {e}"));
    inventory_backend::cloud::domain::Suggestion::export_all(&config)
        .unwrap_or_else(|e| panic!("Suggestion: {e}"));
    inventory_backend::cloud::domain::Assignment::export_all(&config)
        .unwrap_or_else(|e| panic!("Assignment: {e}"));
    // Employment. `export_all` pulls the nested views in with each root, so the
    // list below is the set of things a screen actually fetches rather than
    // every struct in the module.
    //
    // Both profiles are here on purpose: they are different shapes, at
    // different routes, behind different grants. A generated pair is what stops
    // the browser confusing them the way the hand-written proposal did.
    inventory_backend::cloud::postgres::EmployeeSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("EmployeeSummary: {e}"));
    inventory_backend::cloud::postgres::ExpiringContract::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpiringContract: {e}"));
    inventory_backend::cloud::http::employment::EmployeeView::export_all(&config)
        .unwrap_or_else(|e| panic!("EmployeeView: {e}"));
    inventory_backend::cloud::http::employment::EmploymentProfileView::export_all(&config)
        .unwrap_or_else(|e| panic!("EmploymentProfileView: {e}"));
    inventory_backend::cloud::http::employment::PersonalDataView::export_all(&config)
        .unwrap_or_else(|e| panic!("PersonalDataView: {e}"));
    inventory_backend::cloud::http::employment::ContractsView::export_all(&config)
        .unwrap_or_else(|e| panic!("ContractsView: {e}"));
    // How far the caller reaches. The head-office console draws a different
    // People module for a shop manager than for HR, and the difference is this
    // answer — generated rather than transcribed, because a browser that
    // guessed the rule would be a second place the bound is decided.
    inventory_backend::cloud::http::employment::ReachView::export_all(&config)
        .unwrap_or_else(|e| panic!("ReachView: {e}"));
    // Leave, and the calendar it is counted against. Both roots pull their
    // nested views in behind them, so this is the set a screen fetches rather
    // than every struct in the two modules.
    //
    // `LeaveBalanceRow` carries centidays rather than days, and it is generated
    // rather than transcribed for exactly that reason: a browser that assumed
    // days would be wrong by a factor of a hundred on every half day.
    inventory_backend::cloud::http::holiday::CalendarView::export_all(&config)
        .unwrap_or_else(|e| panic!("CalendarView: {e}"));
    inventory_backend::cloud::http::holiday::CalendarYearsView::export_all(&config)
        .unwrap_or_else(|e| panic!("CalendarYearsView: {e}"));
    inventory_backend::cloud::http::holiday::HolidayOnDayView::export_all(&config)
        .unwrap_or_else(|e| panic!("HolidayOnDayView: {e}"));
    inventory_backend::cloud::http::leave::LeaveTypeView::export_all(&config)
        .unwrap_or_else(|e| panic!("LeaveTypeView: {e}"));
    inventory_backend::cloud::http::leave::LeaveRequestView::export_all(&config)
        .unwrap_or_else(|e| panic!("LeaveRequestView: {e}"));
    inventory_backend::cloud::http::leave::LeavePolicyView::export_all(&config)
        .unwrap_or_else(|e| panic!("LeavePolicyView: {e}"));
    inventory_backend::cloud::postgres::LeaveBalanceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("LeaveBalanceRow: {e}"));
    // Overtime. `authorized_minutes` is null in every state but AGREED, and it
    // is generated rather than transcribed for exactly that reason: a browser
    // that read `planned_minutes` as the authorized figure would be showing
    // hours nobody agreed to.
    inventory_backend::cloud::http::overtime::OvertimeOrderView::export_all(&config)
        .unwrap_or_else(|e| panic!("OvertimeOrderView: {e}"));
    inventory_backend::cloud::http::overtime::OvertimePolicyView::export_all(&config)
        .unwrap_or_else(|e| panic!("OvertimePolicyView: {e}"));
    // The attendance policy. One root: `export_all` pulls the version view and
    // `Minutes` in behind it.
    inventory_backend::cloud::http::attendance::PolicyScheduleView::export_all(&config)
        .unwrap_or_else(|e| panic!("PolicyScheduleView: {e}"));
    // A shopper's own surface. The pairing code is issued at a till and read
    // out loud, so the cashier's screen and the shopper's app are two
    // different clients of one exchange — which is exactly the shape that goes
    // wrong when either side describes it by hand.
    inventory_backend::cloud::postgres::MemberIdentity::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberIdentity: {e}"));
    inventory_backend::cloud::postgres::IssuedPairingCode::export_all(&config)
        .unwrap_or_else(|e| panic!("IssuedPairingCode: {e}"));
    inventory_backend::cloud::http::member::MemberSessionResponse::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberSessionResponse: {e}"));
}
