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

    // The checkout a till declares before it asks a terminal for money. Named
    // here rather than left to the derive, for the reason `TaxRule` had to be:
    // `export_all` writes the type it is CALLED on and everything that type
    // reaches, and nothing reachable from `SaleRequest` mentions a checkout. A
    // derive with no caller writes nothing at all, silently.
    inventory_backend::edge::BeginCheckoutRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("BeginCheckoutRequest: {e}"));
    inventory_backend::edge::TenderOutcomeRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderOutcomeRequest: {e}"));
    inventory_backend::edge::ResolveCheckoutRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ResolveCheckoutRequest: {e}"));
    inventory_backend::edge::CheckoutResult::export_all(&config)
        .unwrap_or_else(|e| panic!("CheckoutResult: {e}"));
    // The recovery list a till reads when it starts. Reached from nothing else,
    // because nothing else asks the question.
    inventory_backend::edge::UnresolvedCheckout::export_all(&config)
        .unwrap_or_else(|e| panic!("UnresolvedCheckout: {e}"));
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
    inventory_backend::edge::pricing::StoreOffers::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreOffers: {e}"));

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

    // The tax rates a book publishes. Named here rather than left to the derive
    // because `export_all` writes the type it is CALLED on and everything that
    // type reaches — and nothing reachable from `Rule` mentions tax. A derive
    // with no caller writes nothing at all, silently, which is how a field
    // arrives in Rust and never in the browser.
    pricing_engine::TaxRule::export_all(&config).unwrap_or_else(|e| panic!("TaxRule: {e}"));

    // The three Commercial lists — Pricelist, Promotions, Campaign — each as an
    // envelope rather than a bare array: rows, a keyset cursor, the count of
    // everything that matched, and facet counts. The same shape `MoneyOverview`
    // set and `BillPage`, `PaymentPage` and `EmployeeList` followed, so one hook
    // in the browser draws every list in this estate.
    //
    // `export_all` brings the nested types in with each root — the rows, the
    // facets, `BookActivation`, `PriceRung` and the engine's own `PriceLevel` —
    // so this list is the set of things a screen actually fetches rather than
    // every struct in the module. A type NOT named here is never written, which
    // is a mistake that has already been made once.
    inventory_backend::cloud::postgres::PromotionPage::export_all(&config)
        .unwrap_or_else(|e| panic!("PromotionPage: {e}"));
    inventory_backend::cloud::postgres::CampaignPage::export_all(&config)
        .unwrap_or_else(|e| panic!("CampaignPage: {e}"));

    // What one shop has charged for one product over time. Named here rather
    // than left to the derive, for the reason `TaxRule` had to be: nothing
    // already exported reaches it, and a derive with no caller writes nothing
    // at all — silently. `PricePeriod` comes in with it.
    inventory_backend::cloud::postgres::PriceHistory::export_all(&config)
        .unwrap_or_else(|e| panic!("PriceHistory: {e}"));

    // Pricing changes still scheduled or running — UI-001 §6. Named for the
    // same reason as `PriceHistory`: nothing already exported reaches it, and a
    // derive with no caller writes nothing at all, silently. `ChangeKind`,
    // `ChangeStatus` and `RolloutProgress` come in with it.
    inventory_backend::cloud::postgres::PriceChange::export_all(&config)
        .unwrap_or_else(|e| panic!("PriceChange: {e}"));
    // How far one price book has reached each shop — told, in service, or
    // failed with the shop's own account of why (migration 0179). Named here
    // for the reason the two above are: nothing already exported reaches it, and
    // a derive with no caller writes nothing at all, silently — the trap this
    // file exists to close, and which has caught this repository four times.
    // `ShopRollout` and `RolloutState` come in with it.
    inventory_backend::cloud::postgres::PublicationRollout::export_all(&config)
        .unwrap_or_else(|e| panic!("PublicationRollout: {e}"));

    // The pricelist carries the cascade itself: every rung a shop could have
    // charged, with the losers as well as the winner. `applies_to` is the
    // engine's `PriceLevel`, so the browser reads a cascade in the vocabulary
    // that decides it rather than in a hand-written echo of it.
    inventory_backend::cloud::postgres::ArticlePricePage::export_all(&config)
        .unwrap_or_else(|e| panic!("ArticlePricePage: {e}"));

    // The half of a campaign that is not in any price book: what it runs, where
    // it was declared to run, the lines it must not cross, and the score against
    // the campaign it was meant to beat (migrations 0173 and 0174).
    //
    // Four roots rather than one, because they are four different requests and
    // `export_all` only writes what the type it is called on can reach. The
    // inputs are named separately from the views for the same reason: a struct
    // that is only ever DESERIALISED is reachable from nothing the server sends,
    // so leaving it out would export a screen that can read a campaign's plan
    // and cannot write one.
    inventory_backend::cloud::postgres::CampaignPlanView::export_all(&config)
        .unwrap_or_else(|e| panic!("CampaignPlanView: {e}"));
    inventory_backend::cloud::postgres::CampaignPlanInput::export_all(&config)
        .unwrap_or_else(|e| panic!("CampaignPlanInput: {e}"));
    inventory_backend::cloud::postgres::CampaignActivityInput::export_all(&config)
        .unwrap_or_else(|e| panic!("CampaignActivityInput: {e}"));
    inventory_backend::cloud::postgres::CampaignOutcomeView::export_all(&config)
        .unwrap_or_else(|e| panic!("CampaignOutcomeView: {e}"));
    inventory_backend::cloud::postgres::CampaignTargetInput::export_all(&config)
        .unwrap_or_else(|e| panic!("CampaignTargetInput: {e}"));
    inventory_backend::cloud::postgres::GuardrailCheckReport::export_all(&config)
        .unwrap_or_else(|e| panic!("GuardrailCheckReport: {e}"));

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
    inventory_backend::edge::contracts::PackRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PackRequest: {e}"));
    inventory_backend::edge::contracts::CreatePicklistRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreatePicklistRequest: {e}"));
    inventory_backend::edge::contracts::PicklistResult::export_all(&config)
        .unwrap_or_else(|e| panic!("PicklistResult: {e}"));
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
    inventory_backend::edge::InvoiceDocumentView::export_all(&config)
        .unwrap_or_else(|e| panic!("InvoiceDocumentView: {e}"));

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
    inventory_backend::edge::outbound::PicklistSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("PicklistSummary: {e}"));
    inventory_backend::edge::outbound::DestinationDemand::export_all(&config)
        .unwrap_or_else(|e| panic!("DestinationDemand: {e}"));
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
    inventory_backend::edge::printing::PrinterProbe::export_all(&config)
        .unwrap_or_else(|e| panic!("PrinterProbe: {e}"));

    // Sourcing and suppliers: the first screens the centre gets.
    inventory_backend::cloud::domain::Supplier::export_all(&config)
        .unwrap_or_else(|e| panic!("Supplier: {e}"));
    inventory_backend::cloud::domain::SupplierItem::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierItem: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateSupplierRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateSupplierRequest: {e}"));
    // Where a supplier's money is supposed to land. A bilyet giro names the
    // payee's account, so the print screen reads these.
    inventory_backend::cloud::postgres::SupplierBankAccount::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierBankAccount: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierBankAccountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierBankAccountRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateSupplierBankAccountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateSupplierBankAccountRequest: {e}"));
    // Where the words go on a bank's own giro leaf.
    inventory_backend::cloud::postgres::GiroPrintTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("GiroPrintTemplate: {e}"));
    inventory_backend::cloud::postgres::GiroPrintPlacement::export_all(&config)
        .unwrap_or_else(|e| panic!("GiroPrintPlacement: {e}"));
    inventory_backend::cloud::postgres::CreateGiroPrintTemplateRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateGiroPrintTemplateRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateGiroPrintTemplateRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGiroPrintTemplateRequest: {e}"));
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
    // The directory itself, which the hub had been transcribing by hand since
    // it was written — the derive was on the struct and the type was never
    // named here, so nothing was ever generated and nothing said so.
    inventory_backend::cloud::postgres::MemberRow::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberRow: {e}"));
    inventory_backend::cloud::postgres::MemberDirectory::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberDirectory: {e}"));
    inventory_backend::cloud::postgres::MemberFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberFacets: {e}"));
    inventory_backend::cloud::postgres::MemberFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("MemberFacet: {e}"));
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
    // The envelope the feed and the sheets both read: a page, an exact total
    // and exact facet counts. Exact because this is an audit surface — an
    // approximate count of who did what reads as a fact and is not one.
    inventory_backend::cloud::postgres::AuditFeed::export_all(&config)
        .unwrap_or_else(|e| panic!("AuditFeed: {e}"));
    inventory_backend::cloud::postgres::AuditFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("AuditFacets: {e}"));
    inventory_backend::cloud::postgres::AuditFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("AuditFacet: {e}"));

    // The vocabulary itself, as a union the browser can be held to.
    //
    // Worth exporting for one reason: the hub keeps a map from sheet key to
    // record kind, and it was a `Record<SheetKey, string>`. Two of its
    // twenty-five entries were words this server has never had — `user` for
    // what is `app_user`, and a promotion spelled with no kind behind it at
    // all — and nothing could say so, because `string` accepts anything.
    // Typed against this, `tsc` says so.
    inventory_backend::cloud::domain::RecordKind::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordKind: {e}"));

    // One record's surroundings, in one answer: comments, tags, history, the
    // documents filed against it and the threads arguing about it. This is the
    // shape a generic `<Sheet>` reads, so twenty-four screens depend on it and
    // not one of them may keep its own copy of it.
    inventory_backend::cloud::postgres::RecordInfo::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordInfo: {e}"));
    inventory_backend::cloud::postgres::RecordComment::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordComment: {e}"));
    inventory_backend::cloud::postgres::RecordTag::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordTag: {e}"));
    inventory_backend::cloud::postgres::NewComment::export_all(&config)
        .unwrap_or_else(|e| panic!("NewComment: {e}"));
    inventory_backend::cloud::postgres::NotificationFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("NotificationFacets: {e}"));
    inventory_backend::cloud::postgres::NotificationFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("NotificationFacet: {e}"));

    // The System module's own three lists, each an envelope with EXACT counts.
    // They answer "who can sign in, where, and with what reader", and a rough
    // count of that reads as a fact without being one — so `total` and every
    // facet is a `COUNT(*)`, never an estimate.
    inventory_backend::cloud::postgres::UserList::export_all(&config)
        .unwrap_or_else(|e| panic!("UserList: {e}"));
    inventory_backend::cloud::postgres::UserRow::export_all(&config)
        .unwrap_or_else(|e| panic!("UserRow: {e}"));
    inventory_backend::cloud::postgres::UserFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("UserFacets: {e}"));
    inventory_backend::cloud::postgres::UserFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("UserFacet: {e}"));
    inventory_backend::cloud::postgres::EdgeAssignmentList::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeAssignmentList: {e}"));
    inventory_backend::cloud::postgres::EdgeAssignmentRow::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeAssignmentRow: {e}"));
    inventory_backend::cloud::postgres::EdgeAssignmentFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeAssignmentFacets: {e}"));
    inventory_backend::cloud::postgres::RfidDeviceList::export_all(&config)
        .unwrap_or_else(|e| panic!("RfidDeviceList: {e}"));
    inventory_backend::cloud::postgres::RfidDeviceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("RfidDeviceRow: {e}"));
    inventory_backend::cloud::postgres::RfidDeviceFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("RfidDeviceFacets: {e}"));
    inventory_backend::cloud::postgres::AccessFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("AccessFacet: {e}"));
    // What the fleet sent that this server would not take.
    inventory_backend::cloud::postgres::DeadLetterList::export_all(&config)
        .unwrap_or_else(|e| panic!("DeadLetterList: {e}"));
    inventory_backend::cloud::postgres::DeadLetterRow::export_all(&config)
        .unwrap_or_else(|e| panic!("DeadLetterRow: {e}"));
    inventory_backend::cloud::postgres::DeadLetterFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("DeadLetterFacets: {e}"));
    inventory_backend::cloud::postgres::DeadLetterFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("DeadLetterFacet: {e}"));
    // The sync health board: both lanes, every node, the security posture.
    inventory_backend::cloud::postgres::SyncFleetHealth::export_all(&config)
        .unwrap_or_else(|e| panic!("SyncFleetHealth: {e}"));
    inventory_backend::cloud::postgres::SyncOriginHealth::export_all(&config)
        .unwrap_or_else(|e| panic!("SyncOriginHealth: {e}"));
    inventory_backend::cloud::postgres::FleetCounts::export_all(&config)
        .unwrap_or_else(|e| panic!("FleetCounts: {e}"));
    inventory_backend::cloud::postgres::DownstreamHealth::export_all(&config)
        .unwrap_or_else(|e| panic!("DownstreamHealth: {e}"));
    inventory_backend::cloud::postgres::UpstreamHealth::export_all(&config)
        .unwrap_or_else(|e| panic!("UpstreamHealth: {e}"));
    inventory_backend::cloud::postgres::HourlyFlow::export_all(&config)
        .unwrap_or_else(|e| panic!("HourlyFlow: {e}"));
    inventory_backend::cloud::postgres::SecurityPosture::export_all(&config)
        .unwrap_or_else(|e| panic!("SecurityPosture: {e}"));
    inventory_backend::cloud::postgres::SecurityCheck::export_all(&config)
        .unwrap_or_else(|e| panic!("SecurityCheck: {e}"));
    inventory_backend::cloud::postgres::LaneBlock::export_all(&config)
        .unwrap_or_else(|e| panic!("LaneBlock: {e}"));
    inventory_backend::cloud::postgres::StuckCommand::export_all(&config)
        .unwrap_or_else(|e| panic!("StuckCommand: {e}"));
    inventory_backend::cloud::postgres::LaneStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("LaneStatus: {e}"));
    inventory_backend::cloud::postgres::HealthVerdict::export_all(&config)
        .unwrap_or_else(|e| panic!("HealthVerdict: {e}"));
    inventory_backend::cloud::postgres::CheckTone::export_all(&config)
        .unwrap_or_else(|e| panic!("CheckTone: {e}"));

    // Refunds. The storeops list, an envelope rather than `{items, limit}`:
    // echoing the ceiling back told a caller what it had asked for and never
    // whether the answer was all of them.
    inventory_backend::cloud::postgres::SaleReturnList::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleReturnList: {e}"));
    inventory_backend::cloud::postgres::SaleReturnRow::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleReturnRow: {e}"));
    inventory_backend::cloud::postgres::SaleReturnFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleReturnFacets: {e}"));
    inventory_backend::cloud::postgres::SaleReturnFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleReturnFacet: {e}"));

    // The two master-data vocabularies. Their row types were already written;
    // the facets and the envelope fields beside them were not.
    inventory_backend::cloud::postgres::ColourFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("ColourFacets: {e}"));
    inventory_backend::cloud::postgres::ColourFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("ColourFacet: {e}"));
    inventory_backend::cloud::postgres::MasterFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("MasterFacets: {e}"));
    inventory_backend::cloud::postgres::MasterFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("MasterFacet: {e}"));
    // What speaks for one master value, and whether it may therefore be
    // deleted. The browser must not be deciding this for itself: the screen
    // that draws a Delete button and the handler that honours one have to be
    // reading the same answer.
    inventory_backend::cloud::postgres::MasterUsage::export_all(&config)
        .unwrap_or_else(|e| panic!("MasterUsage: {e}"));
    inventory_backend::cloud::postgres::MasterReference::export_all(&config)
        .unwrap_or_else(|e| panic!("MasterReference: {e}"));
    // What an edit to an article would do to the promotions around it. The
    // browser asks this before a save and prints the answer, so the shape of
    // the answer is not something a screen should be transcribing.
    inventory_backend::cloud::postgres::ArticleConsequences::export_all(&config)
        .unwrap_or_else(|e| panic!("ArticleConsequences: {e}"));
    inventory_backend::cloud::postgres::ArticleConsequence::export_all(&config)
        .unwrap_or_else(|e| panic!("ArticleConsequence: {e}"));
    inventory_backend::cloud::postgres::ProposedArticle::export_all(&config)
        .unwrap_or_else(|e| panic!("ProposedArticle: {e}"));
    inventory_backend::cloud::postgres::RulePhase::export_all(&config)
        .unwrap_or_else(|e| panic!("RulePhase: {e}"));
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
    // The expense half of a bill. `RecordBillLine` names the account, because
    // only the person holding the paper knows which one; `SupplierBillLine` is
    // what comes back, with the client's own name for it beside the code.
    inventory_backend::cloud::postgres::RecordBillLine::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordBillLine: {e}"));
    inventory_backend::cloud::postgres::SupplierBillLine::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierBillLine: {e}"));
    inventory_backend::cloud::postgres::UnbilledReceipt::export_all(&config)
        .unwrap_or_else(|e| panic!("UnbilledReceipt: {e}"));
    // What `GET /finance/bills` actually answers: a page of bills in an
    // envelope, not a bare array. The envelope is `MoneyOverview`'s — rows, a
    // cursor, the count of everything that matched, and the facet counts — so
    // that one hook in the browser draws all three lists. `export_all` pulls
    // `BillFacets` and `PayableFacet` in with it.
    inventory_backend::cloud::postgres::BillPage::export_all(&config)
        .unwrap_or_else(|e| panic!("BillPage: {e}"));

    // Supplier payments: the other half of a bill. `SupplierPayment` carries
    // its allocations inline because a payment without them is meaningless —
    // the header says only that money left.
    inventory_backend::cloud::postgres::SupplierPayment::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierPayment: {e}"));
    inventory_backend::cloud::postgres::PaymentAllocation::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentAllocation: {e}"));
    // The register's envelope, the same shape as `BillPage`. Its facets count
    // the method as well as the status: "what still has to be booked" and
    // "what left by giro this month" are both asked of this list.
    inventory_backend::cloud::postgres::PaymentPage::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentPage: {e}"));
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
    inventory_backend::cloud::domain::ChargeKind::export_all(&config)
        .unwrap_or_else(|e| panic!("ChargeKind: {e}"));
    inventory_backend::cloud::domain::SkipReason::export_all(&config)
        .unwrap_or_else(|e| panic!("SkipReason: {e}"));
    // The other end of an asset's life, and the record of the one it had.
    // `AssetSchedule` carries both what was charged and what is left, because
    // the gap between the two is the only way to see a run quietly skipping an
    // asset.
    inventory_backend::cloud::postgres::DisposeAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("DisposeAssetRequest: {e}"));
    inventory_backend::cloud::postgres::TransferAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("TransferAssetRequest: {e}"));
    inventory_backend::cloud::postgres::AssetSchedule::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetSchedule: {e}"));
    inventory_backend::cloud::postgres::AssetScheduleRow::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetScheduleRow: {e}"));
    // Where the register and the books disagree about what was bought. Two
    // lists and not one number: an unbacked asset and an unclaimed capital
    // purchase are different faults with different fixes.
    inventory_backend::cloud::postgres::AcquisitionGap::export_all(&config)
        .unwrap_or_else(|e| panic!("AcquisitionGap: {e}"));
    inventory_backend::cloud::postgres::UnbackedAsset::export_all(&config)
        .unwrap_or_else(|e| panic!("UnbackedAsset: {e}"));
    inventory_backend::cloud::postgres::UnclaimedAcquisitionLine::export_all(&config)
        .unwrap_or_else(|e| panic!("UnclaimedAcquisitionLine: {e}"));

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
    inventory_backend::cloud::postgres::UpdateBankLineRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateBankLineRequest: {e}"));
    inventory_backend::cloud::postgres::CashCountRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CashCountRow: {e}"));
    inventory_backend::cloud::postgres::RecordCountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordCountRequest: {e}"));
    inventory_backend::cloud::postgres::PostCountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PostCountRequest: {e}"));

    // A day's takings reaching the ledger. `SaleDayPage` pulls `SaleDayRow` in
    // with it, and it is named here anyway for the reason the comment below
    // gives: a derive writes nothing until something asks it to.
    inventory_backend::cloud::postgres::SaleDayRow::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleDayRow: {e}"));
    inventory_backend::cloud::postgres::SaleDayPage::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleDayPage: {e}"));
    inventory_backend::cloud::postgres::PostSaleDayRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PostSaleDayRequest: {e}"));

    inventory_backend::cloud::postgres::CompanyBankAccount::export_all(&config)
        .unwrap_or_else(|e| panic!("CompanyBankAccount: {e}"));
    inventory_backend::cloud::postgres::DescribeBankAccountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("DescribeBankAccountRequest: {e}"));
    inventory_backend::cloud::postgres::BankInstitution::export_all(&config)
        .unwrap_or_else(|e| panic!("BankInstitution: {e}"));
    inventory_backend::cloud::postgres::BookBankLineRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("BookBankLineRequest: {e}"));

    // A shop asking head office to pay something. Named here and not merely
    // derived: `ts_rs::TS` on the struct generates nothing unless something
    // asks it to, so a type that is only derived is silently never written and
    // the screen built against it imports a name that does not exist.
    //
    // `InstructionPage` pulls `PaymentInstruction` and `PayableFacet` in with
    // it through `export_all`; both are named anyway, because a type that
    // arrives only as somebody else's field disappears the day that field
    // does.
    inventory_backend::cloud::postgres::PaymentInstruction::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentInstruction: {e}"));
    inventory_backend::cloud::postgres::InstructionPage::export_all(&config)
        .unwrap_or_else(|e| panic!("InstructionPage: {e}"));
    inventory_backend::cloud::postgres::InstructionFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("InstructionFacets: {e}"));
    inventory_backend::cloud::postgres::RaiseInstructionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RaiseInstructionRequest: {e}"));
    inventory_backend::cloud::postgres::DecideInstructionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("DecideInstructionRequest: {e}"));
    inventory_backend::cloud::postgres::SettleInstructionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SettleInstructionRequest: {e}"));

    // Takings between a drawer and a bank account.
    inventory_backend::cloud::postgres::StoreDeposit::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreDeposit: {e}"));
    inventory_backend::cloud::postgres::DepositPage::export_all(&config)
        .unwrap_or_else(|e| panic!("DepositPage: {e}"));
    inventory_backend::cloud::postgres::DepositFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("DepositFacets: {e}"));
    inventory_backend::cloud::postgres::RecordDepositRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordDepositRequest: {e}"));
    inventory_backend::cloud::postgres::LandDepositRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("LandDepositRequest: {e}"));
    // The mail gateway. `settings` is deliberately `Record<string, unknown>`
    // on the wire: the three readers want overlapping but different mappings,
    // and a union that had to be widened every time a bank moved a column is
    // a type that would be wrong more often than it was right.
    inventory_backend::cloud::postgres::BankStatementSourceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BankStatementSourceRow: {e}"));
    inventory_backend::cloud::postgres::SaveStatementSourceRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveStatementSourceRequest: {e}"));
    inventory_backend::cloud::postgres::StatementIntakeRow::export_all(&config)
        .unwrap_or_else(|e| panic!("StatementIntakeRow: {e}"));
    inventory_backend::cloud::intake::parse::StatementFormat::export_all(&config)
        .unwrap_or_else(|e| panic!("StatementFormat: {e}"));
    inventory_backend::cloud::http::statement_intake::IntakeRunOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("IntakeRunOutcome: {e}"));
    // Where the money is. Driven off `account_map`, so a meaning nobody has
    // mapped produces no row — which is the honest answer and a visible one.
    inventory_backend::cloud::postgres::MoneyOverview::export_all(&config)
        .unwrap_or_else(|e| panic!("MoneyOverview: {e}"));
    inventory_backend::cloud::postgres::MoneyAccountRow::export_all(&config)
        .unwrap_or_else(|e| panic!("MoneyAccountRow: {e}"));
    inventory_backend::cloud::postgres::MoneyStatementRef::export_all(&config)
        .unwrap_or_else(|e| panic!("MoneyStatementRef: {e}"));
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
    // The workforce list's envelope — the cursor, the total and the facets —
    // the same shape `BillPage` and `PaymentPage` have. `export_all` brings
    // `EmployeeSummary` and the facet types with it; the summary is named
    // separately below because single-employee reads return it on its own.
    inventory_backend::cloud::postgres::EmployeeList::export_all(&config)
        .unwrap_or_else(|e| panic!("EmployeeList: {e}"));
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
    // *Karyawan baru*: a shop's request for an employee, and head office's
    // answer. One root view, because a proposal is read as a whole — its
    // versions and its steps are what make a returned-then-revised request
    // legible, and a list of summaries that dropped them would lose the only
    // thing worth showing.
    //
    // The comment that stood here described a proposed-hires feature the owner
    // decided against on 2026-09-04, and said its view "carries the NIK and the
    // home address a proposal has to state". The form he approved on 2026-09-13
    // deliberately carries neither, and there is no column for either: a
    // candidate who may never be employed here has nothing here but a name.
    //
    // The four request bodies are generated rather than left to the browser,
    // because two of them are where the statutory shape lives:
    // `contract_ends_on` is required for a PKWT and refused for a PKWTT, and a
    // hand-written pair of optional fields is how that becomes a runtime
    // surprise instead of a type error.
    inventory_backend::cloud::http::hire::HireProposalView::export_all(&config)
        .unwrap_or_else(|e| panic!("HireProposalView: {e}"));
    inventory_backend::cloud::http::hire::HireProposalVersionView::export_all(&config)
        .unwrap_or_else(|e| panic!("HireProposalVersionView: {e}"));
    inventory_backend::cloud::http::hire::HireProposalStepView::export_all(&config)
        .unwrap_or_else(|e| panic!("HireProposalStepView: {e}"));
    inventory_backend::cloud::http::hire::ProposeBody::export_all(&config)
        .unwrap_or_else(|e| panic!("ProposeBody: {e}"));
    inventory_backend::cloud::http::hire::ReviseBody::export_all(&config)
        .unwrap_or_else(|e| panic!("ReviseBody: {e}"));
    inventory_backend::cloud::http::hire::DecisionBody::export_all(&config)
        .unwrap_or_else(|e| panic!("DecisionBody: {e}"));
    inventory_backend::cloud::http::hire::OpenEmploymentBody::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenEmploymentBody: {e}"));
    // Issuing a login: which tills a person's place is served by, what the
    // request looks like, and what came back. The two rungs — one at the centre
    // and one at the till — are separate fields on the request, and a
    // hand-written shape that collapsed them into one is precisely the mistake
    // this generation exists to prevent.
    inventory_backend::cloud::postgres::EdgeTarget::export_all(&config)
        .unwrap_or_else(|e| panic!("EdgeTarget: {e}"));
    inventory_backend::contract::ProvisionAccountRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ProvisionAccountRequest: {e}"));
    inventory_backend::contract::ProvisionedAccount::export_all(&config)
        .unwrap_or_else(|e| panic!("ProvisionedAccount: {e}"));
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
    // Shift patterns, the roster and the close boundary. `CloseReadinessView`
    // carries `Option<u32>` where the reference carries `u32`, and that is the
    // whole point: `null` means the punch checks were not made, `0` would mean
    // somebody looked and found none, and there is no punch source to look
    // with. Generated rather than transcribed so a browser cannot flatten the
    // distinction back to a number.
    inventory_backend::cloud::http::roster::ShiftView::export_all(&config)
        .unwrap_or_else(|e| panic!("ShiftView: {e}"));
    inventory_backend::cloud::http::roster::RosterDayView::export_all(&config)
        .unwrap_or_else(|e| panic!("RosterDayView: {e}"));
    inventory_backend::cloud::http::roster::PeriodView::export_all(&config)
        .unwrap_or_else(|e| panic!("PeriodView: {e}"));
    // Pay and payroll. `PayrollSlipRow` carries no deduction and no net, and
    // it is generated rather than transcribed for exactly that reason: a
    // hand-written type could grow a `net_minor` that nothing produces, and a
    // screen would then show a zero as though somebody had computed it.
    //
    // `bank_account_masked` is the only account field on any of these. There is
    // no view anywhere that serves the number whole.
    inventory_backend::cloud::http::pay::PayRecordView::export_all(&config)
        .unwrap_or_else(|e| panic!("PayRecordView: {e}"));
    inventory_backend::cloud::http::pay::PayrollIdentityView::export_all(&config)
        .unwrap_or_else(|e| panic!("PayrollIdentityView: {e}"));
    inventory_backend::cloud::http::pay::PayrollRunView::export_all(&config)
        .unwrap_or_else(|e| panic!("PayrollRunView: {e}"));
    inventory_backend::cloud::postgres::PayrollSlipRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PayrollSlipRow: {e}"));
    inventory_backend::cloud::postgres::RunReconciliation::export_all(&config)
        .unwrap_or_else(|e| panic!("RunReconciliation: {e}"));
    // The component engine (0250, 0251). Named here rather than left to the
    // derives, because a derive alone writes nothing — a type has to be
    // reached from this file or it is silently absent from the browser's
    // barrel, which is how a screen ends up hand-typing a shape the server
    // then changes underneath it.
    //
    // `SlipLineRow` comes in behind `PayrollSlipRow`'s `export_all`, and it is
    // the type that matters most on this list: it carries every input a line
    // was computed from, so a payslip screen can show *why* a figure is what
    // it is rather than only what it is.
    //
    // `PayComponentView` and `ComponentRateView` are the settings screen. Every
    // number on the rate is `Option`, and a hand-written mirror of that would
    // sooner or later make one of them required — which would be a screen
    // asking for an hours divisor on a BPJS percentage.
    inventory_backend::cloud::http::components::PayComponentView::export_all(&config)
        .unwrap_or_else(|e| panic!("PayComponentView: {e}"));
    inventory_backend::cloud::http::components::ComponentRateView::export_all(&config)
        .unwrap_or_else(|e| panic!("ComponentRateView: {e}"));
    // What a place filed, and whether it can still take it back. `withdrawable`
    // is a server fact — it is false once the batch has been submitted — and a
    // browser that computed it from the run's state would be a second answer
    // to a question the freeze already decides.
    inventory_backend::cloud::postgres::PayrollAdjustmentRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PayrollAdjustmentRow: {e}"));
    // The crossing to Finance, as the browser has to render it: what was
    // handed over, and whether Finance has said it is paid. Two different
    // facts, and the screen must not let "received" read as "paid".
    inventory_backend::cloud::http::pay::PayrollHandoverView::export_all(&config)
        .unwrap_or_else(|e| panic!("PayrollHandoverView: {e}"));
    // The attendance policy. One root: `export_all` pulls the version view and
    // `Minutes` in behind it.
    inventory_backend::cloud::http::attendance::PolicyScheduleView::export_all(&config)
        .unwrap_or_else(|e| panic!("PolicyScheduleView: {e}"));
    // What a punch becomes, and what a terminal is. Named here rather than
    // left to the derives, because a derive alone writes nothing — the type has
    // to be reached from this file or it is silently absent from the browser's
    // barrel, which is how a screen ends up hand-typing a shape the server
    // then changes underneath it.
    //
    // `AttendanceDayView` is the root that pulls `UnderivableDay` in behind it:
    // a day whose outcome cannot be derived says WHY rather than reporting
    // zero, and the browser has to be able to render that distinction.
    inventory_backend::cloud::http::punch::AttendanceDayView::export_all(&config)
        .unwrap_or_else(|e| panic!("AttendanceDayView: {e}"));
    inventory_backend::cloud::http::punch::AttendanceRangeView::export_all(&config)
        .unwrap_or_else(|e| panic!("AttendanceRangeView: {e}"));
    inventory_backend::cloud::http::punch::TodayView::export_all(&config)
        .unwrap_or_else(|e| panic!("TodayView: {e}"));
    // What the employee app gets back when somebody taps in or out. Named here
    // for the reason the comment above gives — a derive alone writes nothing —
    // and it matters more than usual for this one: it carries `source`, and the
    // screen's whole job is to not present a phone tap as a reading. A shape
    // the browser hand-typed would be a shape that could quietly lose that
    // field.
    inventory_backend::cloud::http::punch::PunchRecorded::export_all(&config)
        .unwrap_or_else(|e| panic!("PunchRecorded: {e}"));
    // Whether a place can be measured at all yet: a terminal that has never
    // reported, or a person with no finger on file, is a hole in the month
    // rather than an absence in it.
    inventory_backend::cloud::http::punch::PunchReadinessView::export_all(&config)
        .unwrap_or_else(|e| panic!("PunchReadinessView: {e}"));
    // Enrolment carries no template and no image — only that somebody has one,
    // who recorded it and when. The biometric itself is never on this wire.
    inventory_backend::cloud::http::terminal::EnrolmentView::export_all(&config)
        .unwrap_or_else(|e| panic!("EnrolmentView: {e}"));
    inventory_backend::cloud::http::terminal::BookPublished::export_all(&config)
        .unwrap_or_else(|e| panic!("BookPublished: {e}"));
    // The two lists those screens are made of. `CorrectionRow` carries the
    // name as well as the id, because a correction queue whose rows read
    // `emp_174c7e88…` is a queue nobody can triage; `TerminalRow` carries when
    // a station last synced and last saw a finger, which is the difference
    // between "no punches" and "that shop's reader has been unplugged since
    // Monday".
    inventory_backend::cloud::postgres::CorrectionRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CorrectionRow: {e}"));
    inventory_backend::cloud::postgres::TerminalRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TerminalRow: {e}"));
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

    // The till's day. The drawer, the reversal, and the paper the customer
    // walks out with. Every one of these is posted by a screen a cashier uses
    // while somebody waits, which is the worst possible place to discover that
    // a hand-written shape had a field spelled differently.
    inventory_backend::edge::till::OpenShiftRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenShiftRequest: {e}"));
    inventory_backend::edge::till::CashMovementRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CashMovementRequest: {e}"));
    inventory_backend::edge::till::CloseShiftRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CloseShiftRequest: {e}"));
    // One root: `export_all` pulls `CashMovementView` and `TenderTotal` in
    // behind the report.
    inventory_backend::edge::till::ShiftReport::export_all(&config)
        .unwrap_or_else(|e| panic!("ShiftReport: {e}"));
    inventory_backend::edge::till::VoidSaleRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("VoidSaleRequest: {e}"));
    inventory_backend::edge::till::VoidResult::export_all(&config)
        .unwrap_or_else(|e| panic!("VoidResult: {e}"));
    inventory_backend::edge::till::ReturnRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReturnRequest: {e}"));
    inventory_backend::edge::till::ReturnResult::export_all(&config)
        .unwrap_or_else(|e| panic!("ReturnResult: {e}"));
    inventory_backend::edge::till::PrintReceiptRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PrintReceiptRequest: {e}"));
    inventory_backend::edge::escpos::ReceiptDocument::export_all(&config)
        .unwrap_or_else(|e| panic!("ReceiptDocument: {e}"));

    // The shop's small money. Petty cash and nothing that can reach the
    // drawer — see `edge/petty.rs` for the three pots.
    //
    // Named here and not merely derived, which is the trap this file exists
    // for: a `#[derive(TS)]` that nothing calls `export_all` on writes no file
    // at all, and the browser then cannot name a type the server has been
    // sending. `TaxRule` and `MarkdownPolicy` both went that way.
    //
    // `export_all` on the two envelopes pulls `StoreExpenseView`,
    // `PettyCashTopUpView` and `PettyCashPosition` in behind them; the two
    // requests and the position are named separately because a screen posts
    // and reads them directly.
    inventory_backend::edge::petty::RecordExpenseRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordExpenseRequest: {e}"));
    inventory_backend::edge::petty::PettyCashTopUpRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PettyCashTopUpRequest: {e}"));
    inventory_backend::edge::petty::PettyCashPosition::export_all(&config)
        .unwrap_or_else(|e| panic!("PettyCashPosition: {e}"));
    inventory_backend::edge::petty::ExpenseRecorded::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpenseRecorded: {e}"));
    inventory_backend::edge::petty::PettyCashTopUpRecorded::export_all(&config)
        .unwrap_or_else(|e| panic!("PettyCashTopUpRecorded: {e}"));
    inventory_backend::edge::petty::ExpenseWindow::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpenseWindow: {e}"));

    // The finance lists, as envelopes.
    //
    // Eight routes that answered with a bare array — or, for the map and the
    // saved reports, with a hand-built `json!` the browser mirrored by hand —
    // brought to the shape `MoneyOverview` set and `BillPage`, `PaymentPage`
    // and `EmployeeList` followed: rows, a keyset `next_cursor`, a `total` over
    // everything that matched, and facet counts. One root each; `export_all`
    // pulls the facet types and the row types in behind it.
    //
    // `GeneralLedger` is already named above and does not need a second line —
    // but it now carries `GeneralLedgerFacets` and a `line_id` per row, and it
    // is the one envelope here whose totals deliberately do NOT move under the
    // search: a trial balance that shrank when somebody typed would be a proof
    // that could be talked out of itself.
    inventory_backend::cloud::postgres::AccountPage::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountPage: {e}"));
    inventory_backend::cloud::postgres::JournalPage::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalPage: {e}"));
    inventory_backend::cloud::postgres::AssetPage::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetPage: {e}"));
    inventory_backend::cloud::postgres::PeriodPage::export_all(&config)
        .unwrap_or_else(|e| panic!("PeriodPage: {e}"));
    inventory_backend::cloud::postgres::BankStatementPage::export_all(&config)
        .unwrap_or_else(|e| panic!("BankStatementPage: {e}"));
    inventory_backend::cloud::postgres::AccountMapPage::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountMapPage: {e}"));
    inventory_backend::cloud::postgres::SavedReportPage::export_all(&config)
        .unwrap_or_else(|e| panic!("SavedReportPage: {e}"));

    // The inventory lists, as envelopes.
    //
    // Eight routes that answered with a hand-built `json!` the browser
    // mirrored by hand in `frontend-hub/src/lib/queries/inventory.ts` —
    // every interface in that file was transcribed rather than generated,
    // because there was no struct to generate from. There is now, and these
    // are the roots; `export_all` pulls the row and facet types in behind
    // them, `InventoryFacet` included.
    inventory_backend::cloud::postgres::PoolPage::export_all(&config)
        .unwrap_or_else(|e| panic!("PoolPage: {e}"));
    inventory_backend::cloud::postgres::MovementPage::export_all(&config)
        .unwrap_or_else(|e| panic!("MovementPage: {e}"));
    inventory_backend::cloud::postgres::SightingPage::export_all(&config)
        .unwrap_or_else(|e| panic!("SightingPage: {e}"));
    inventory_backend::cloud::postgres::CountPage::export_all(&config)
        .unwrap_or_else(|e| panic!("CountPage: {e}"));
    inventory_backend::cloud::postgres::MissingPage::export_all(&config)
        .unwrap_or_else(|e| panic!("MissingPage: {e}"));
    inventory_backend::cloud::postgres::ReconciliationPage::export_all(&config)
        .unwrap_or_else(|e| panic!("ReconciliationPage: {e}"));
    inventory_backend::cloud::postgres::ControlStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("ControlStatus: {e}"));
    // And the trial balance, which is the same override written larger: its
    // `total_debit_minor` and `total_credit_minor` are the whole ledger's, and
    // its cursor bounds the response rather than the scan.
    inventory_backend::cloud::postgres::TrialBalance::export_all(&config)
        .unwrap_or_else(|e| panic!("TrialBalance: {e}"));

    // Procurement and commercial, brought to the same envelope everything above
    // already speaks: rows, a keyset `next_cursor`, a `total` over the whole
    // matched set, and facets counted over what the search leaves.
    //
    // `PurchaseOrderPage` and `PriceAmendmentPage` are the two that were
    // hand-built JSON on the way out AND hand-written TypeScript on the way in
    // — twice each, once in the hub and once in the cloud console, which is the
    // disease this file exists to cure. Both roots; `export_all` pulls the row
    // and facet types in behind them.
    // Payment terms. Named here and not merely derived: `#[ts(export)]` alone
    // writes nothing, which is how `MasterTerm` has a derive and no file.
    inventory_backend::cloud::postgres::PaymentTermsBook::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentTermsBook: {e}"));

    inventory_backend::cloud::postgres::PurchaseOrderPage::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseOrderPage: {e}"));
    inventory_backend::cloud::postgres::PurchaseOrderRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseOrderRow: {e}"));
    inventory_backend::cloud::postgres::PriceAmendmentPage::export_all(&config)
        .unwrap_or_else(|e| panic!("PriceAmendmentPage: {e}"));
    inventory_backend::cloud::postgres::PriceAmendmentRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PriceAmendmentRow: {e}"));
    // The supplier book. `Supplier` itself was already named above; this is the
    // envelope it now arrives in, because a bare array has nowhere to put a
    // cursor on the day thirty suppliers are three hundred.
    inventory_backend::cloud::postgres::SupplierList::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierList: {e}"));
    // Letters — the register, one letter, and the three requests that change
    // one. `export_all` pulls `LetterRow` and `LetterLine` in behind the two
    // envelopes, so the browser's table of goods is the struct the server
    // serialises rather than a shape somebody read off a screenshot.
    inventory_backend::cloud::postgres::LetterList::export_all(&config)
        .unwrap_or_else(|e| panic!("LetterList: {e}"));
    inventory_backend::cloud::postgres::LetterDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("LetterDetail: {e}"));
    inventory_backend::cloud::postgres::LetterSource::export_all(&config)
        .unwrap_or_else(|e| panic!("LetterSource: {e}"));
    inventory_backend::cloud::postgres::NewLetter::export_all(&config)
        .unwrap_or_else(|e| panic!("NewLetter: {e}"));
    inventory_backend::cloud::postgres::LetterEdit::export_all(&config)
        .unwrap_or_else(|e| panic!("LetterEdit: {e}"));
    inventory_backend::cloud::postgres::VoidLetter::export_all(&config)
        .unwrap_or_else(|e| panic!("VoidLetter: {e}"));
    // The patterns a letter can be written from.
    inventory_backend::cloud::postgres::LetterTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("LetterTemplate: {e}"));
    inventory_backend::cloud::postgres::NewTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("NewTemplate: {e}"));
    // Vouchers, and this entry is the point of the comment at the top of this
    // file. `VoucherRow` and `VoucherList` have carried the `ts_rs` derive since
    // they were written and were never named HERE — so the derive was present,
    // inert, and generated nothing, while the browser's copies were typed by
    // hand beside them. The test passed the whole time: a type this file does
    // not name is simply never written, and nothing fails to say so.
    inventory_backend::cloud::postgres::VoucherList::export_all(&config)
        .unwrap_or_else(|e| panic!("VoucherList: {e}"));
    inventory_backend::cloud::postgres::VoucherRow::export_all(&config)
        .unwrap_or_else(|e| panic!("VoucherRow: {e}"));
    // The detail route behind it, which is the same shape one card at a time —
    // `export_all` pulls `VoucherMovementRow` in behind it.
    inventory_backend::cloud::postgres::VoucherDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("VoucherDetail: {e}"));
    inventory_backend::cloud::postgres::VoucherLedger::export_all(&config)
        .unwrap_or_else(|e| panic!("VoucherLedger: {e}"));
    inventory_backend::cloud::postgres::IssueVoucherRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("IssueVoucherRequest: {e}"));
    inventory_backend::cloud::postgres::RedeemVoucherRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RedeemVoucherRequest: {e}"));
    inventory_backend::cloud::postgres::VoidVoucherRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("VoidVoucherRequest: {e}"));

    // Coupons (migration 0170). Named here for the reason the paragraph above
    // gives, which has now cost this repository twice: a derive nobody names is
    // a derive that writes nothing, and the failure is a browser import that
    // does not resolve for a type the server has been sending all week.
    //
    // `export_all` pulls the enums in behind the structs that hold them —
    // `CouponSetKind` behind `CouponSetRow`, `CouponState` behind
    // `CouponCodeRow` — and `CouponCodeDetail` pulls `CouponRedemptionRow`.
    inventory_backend::cloud::postgres::CouponSetRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CouponSetRow: {e}"));
    inventory_backend::cloud::postgres::CouponCodeRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CouponCodeRow: {e}"));
    inventory_backend::cloud::postgres::CouponCodeDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("CouponCodeDetail: {e}"));
    inventory_backend::cloud::postgres::CouponRedemptionRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CouponRedemptionRow: {e}"));
    inventory_backend::cloud::postgres::CouponSetKind::export_all(&config)
        .unwrap_or_else(|e| panic!("CouponSetKind: {e}"));
    inventory_backend::cloud::postgres::CouponState::export_all(&config)
        .unwrap_or_else(|e| panic!("CouponState: {e}"));
    inventory_backend::cloud::postgres::CreateCouponSetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateCouponSetRequest: {e}"));
    inventory_backend::cloud::postgres::MintCouponsRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MintCouponsRequest: {e}"));
    inventory_backend::cloud::postgres::MintedCoupons::export_all(&config)
        .unwrap_or_else(|e| panic!("MintedCoupons: {e}"));
    inventory_backend::cloud::postgres::AuthorizeCouponRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("AuthorizeCouponRequest: {e}"));
    inventory_backend::cloud::postgres::CommitCouponRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CommitCouponRequest: {e}"));
    inventory_backend::cloud::postgres::ReleaseCouponRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReleaseCouponRequest: {e}"));
    inventory_backend::cloud::postgres::CancelCouponRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CancelCouponRequest: {e}"));
}
