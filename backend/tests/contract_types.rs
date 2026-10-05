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

/// One name per line, exported the same way, so a new domain is a list and not
/// forty copies of the same three lines. A type NOT named here is not written,
/// whatever its derive says.
macro_rules! for_contract {
    ($config:expr, $($ty:ident),* $(,)?) => {
        $(
            inventory_backend::cloud::postgres::$ty::export_all($config)
                .unwrap_or_else(|e| panic!("{}: {e}", stringify!($ty)));
        )*
    };
}

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

    // The virtual business clock: what the hub's clock chip displays and what
    // its control panel posts. `export_all` pulls in `ClockMode` with
    // `ClockStatus`.
    inventory_backend::clock::ClockStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("ClockStatus: {e}"));
    inventory_backend::cloud::http::clock::ClockControlRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ClockControlRequest: {e}"));

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
    inventory_backend::cloud::postgres::SupplierContact::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierContact: {e}"));
    inventory_backend::cloud::postgres::CreateSupplierContactRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreateSupplierContactRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateSupplierContactRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateSupplierContactRequest: {e}"));
    // Units of measure and their conversions: what a buyer may order in, and
    // how many pieces each is.
    for_contract!(
        &config,
        UnitOfMeasure,
        UnitConversion,
        UnitsBook,
        CreateUnitRequest,
        UpdateUnitRequest,
        CreateUnitConversionRequest,
        UpdateUnitConversionRequest,
    );
    // Setting the company up from the hub: the wizard's three answers, the
    // stores it opens, and what is still to do before they trade.
    for_contract!(
        &config,
        SetupStatus,
        SetupCompany,
        SetupStore,
        SetupBooks,
        SetupTask,
        SaveSetupCompanyRequest,
        NewStore,
        OpenStoresRequest,
        OpenStoresAnswer,
        StartBooksRequest,
    );
    // Opening a store: the Stores list and page with their readiness checks,
    // head office's "Open store", the install code for the store's server,
    // and the device register with its test pages.
    for_contract!(
        &config,
        StoreList,
        StoreSummary,
        StoreDetail,
        StoreCheck,
        StoreServer,
        StoreTills,
        StorePic,
        StoreReadiness,
        OpenStoreRequest,
        OpenedStore,
        StoreServerInstall,
        RegistryDevice,
        TestPrintRequested,
    );
    // A store's Actions menu: what may be done to its server and devices,
    // asking for one, and where each got to (remote actions, 0643).
    for_contract!(
        &config,
        StoreActionMenu,
        StoreActionOption,
        StoreActionRequest,
        StoreActionAccepted,
        StoreActionHistory,
        StoreActionEntry,
    );
    // The store exceptions list: what goes wrong in stores, per store and
    // for all of them within reach, and the thresholds that decide it.
    for_contract!(
        &config,
        ExceptionList,
        ExceptionItem,
        ExceptionLink,
        ExceptionSummary,
        ExceptionKindCount,
        ExceptionUnitCount,
        AcknowledgeExceptionRequest,
        ExceptionSettings,
        ExceptionSettingsView,
    );
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
    // The other half of the pairing code's conversation: a shopper asks to
    // turn points into a voucher, and a cashier's confirm is what a request
    // becomes. See migration 0349.
    inventory_backend::cloud::postgres::RedeemRequestStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("RedeemRequestStatus: {e}"));
    inventory_backend::cloud::postgres::RedeemRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RedeemRequest: {e}"));
    inventory_backend::cloud::postgres::IssuedRedeemRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("IssuedRedeemRequest: {e}"));

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
    // Since `0476`: a message can be answered, edited, deleted, reacted to and
    // pinned, and a group has admins and a life after it is made.
    for_contract!(
        &config,
        ChatMember,
        ChatReplyPreview,
        ChatReaction,
        ChatSearchHit,
        EditMessageRequest,
        ReactRequest,
        PinMessageRequest,
        RenameConversationRequest,
        ConversationPreferencesRequest,
        AddParticipantsRequest,
        SetAdminRequest,
    );
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
    inventory_backend::cloud::http::discussion::SetSubscriptionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetSubscriptionRequest: {e}"));
    inventory_backend::cloud::http::discussion::SetPinRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetPinRequest: {e}"));
    // What 0490 added: corrections and their history, reactions, the post a
    // reply answers, and the board's tags and kinds.
    for_contract!(
        &config,
        PostReference,
        PostReaction,
        PostRevision,
        EditThreadRequest,
        EditPostRequest,
        ReactToPostRequest,
        TagCount,
        SubjectKindOption,
        DiscussionPerson,
        DismissedUnread,
    );

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
    // Job roles (0633), the servers a login signs in at (0635), and inviting
    // people by a link (0634) — with the manager a store is opened with.
    for_contract!(
        &config,
        UserNode,
        JobRole,
        JobRoleList,
        JobRolePatch,
        NumberSeries,
        NumberSeriesList,
        NumberSeriesPatch,
        JobStatus,
        JobList,
        JobRunRow,
        InvitePerson,
        InviteRequest,
        IssuedInvitation,
        IssuedInvitationList,
        InvitationRow,
        InvitationList,
        InvitationPreview,
        AcceptInvitationRequest,
        StoreManagerInvitation,
        NewStoreManager,
    );
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
    inventory_backend::cloud::postgres::AccountLink::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountLink: {e}"));
    inventory_backend::cloud::postgres::SetAccountLinkRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetAccountLinkRequest: {e}"));
    inventory_backend::cloud::postgres::AccountLinkChange::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountLinkChange: {e}"));
    inventory_backend::cloud::postgres::PostingReadiness::export_all(&config)
        .unwrap_or_else(|e| panic!("PostingReadiness: {e}"));
    inventory_backend::cloud::postgres::ChartChange::export_all(&config)
        .unwrap_or_else(|e| panic!("ChartChange: {e}"));
    inventory_backend::cloud::postgres::ChartChangeRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ChartChangeRequest: {e}"));
    inventory_backend::cloud::postgres::ExpenseCategory::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpenseCategory: {e}"));
    inventory_backend::cloud::postgres::SaveExpenseCategoryRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveExpenseCategoryRequest: {e}"));
    inventory_backend::cloud::postgres::PayComponentPosting::export_all(&config)
        .unwrap_or_else(|e| panic!("PayComponentPosting: {e}"));
    inventory_backend::cloud::postgres::SetPayComponentPostingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetPayComponentPostingRequest: {e}"));
    inventory_backend::cloud::postgres::SaveAssetClassRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveAssetClassRequest: {e}"));
    inventory_backend::cloud::postgres::PaymentMethod::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentMethod: {e}"));
    inventory_backend::cloud::postgres::SavePaymentMethodRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SavePaymentMethodRequest: {e}"));
    inventory_backend::cloud::postgres::TaxTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("TaxTemplate: {e}"));
    inventory_backend::cloud::postgres::TaxTypeSetting::export_all(&config)
        .unwrap_or_else(|e| panic!("TaxTypeSetting: {e}"));
    inventory_backend::cloud::postgres::AccountingDimension::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountingDimension: {e}"));
    inventory_backend::cloud::postgres::DimensionValue::export_all(&config)
        .unwrap_or_else(|e| panic!("DimensionValue: {e}"));
    inventory_backend::cloud::postgres::SaveDimensionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveDimensionRequest: {e}"));
    inventory_backend::cloud::postgres::DimensionResult::export_all(&config)
        .unwrap_or_else(|e| panic!("DimensionResult: {e}"));
    inventory_backend::cloud::postgres::AccountSourceRule::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountSourceRule: {e}"));
    inventory_backend::cloud::postgres::HeadOfficeAccount::export_all(&config)
        .unwrap_or_else(|e| panic!("HeadOfficeAccount: {e}"));
    inventory_backend::cloud::postgres::PostingSwitches::export_all(&config)
        .unwrap_or_else(|e| panic!("PostingSwitches: {e}"));
    inventory_backend::cloud::postgres::PostingSwitch::export_all(&config)
        .unwrap_or_else(|e| panic!("PostingSwitch: {e}"));
    inventory_backend::cloud::postgres::SetAutomaticPostingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetAutomaticPostingRequest: {e}"));
    inventory_backend::cloud::postgres::RolePermission::export_all(&config)
        .unwrap_or_else(|e| panic!("RolePermission: {e}"));
    inventory_backend::cloud::postgres::JournalTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalTemplate: {e}"));
    inventory_backend::cloud::postgres::SaveJournalTemplateRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveJournalTemplateRequest: {e}"));
    inventory_backend::cloud::postgres::JournalRepeat::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalRepeat: {e}"));
    inventory_backend::cloud::postgres::SaveJournalRepeatRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveJournalRepeatRequest: {e}"));
    inventory_backend::cloud::postgres::JournalRepeatSweep::export_all(&config)
        .unwrap_or_else(|e| panic!("JournalRepeatSweep: {e}"));
    // 1 Oct 2026: repeating BKK/BKM (0716), expenses by month, withholding report.
    inventory_backend::cloud::postgres::CashDocumentRepeat::export_all(&config)
        .unwrap_or_else(|e| panic!("CashDocumentRepeat: {e}"));
    inventory_backend::cloud::postgres::SaveCashDocumentRepeatRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveCashDocumentRepeatRequest: {e}"));
    inventory_backend::cloud::postgres::CashDocumentRepeatSweep::export_all(&config)
        .unwrap_or_else(|e| panic!("CashDocumentRepeatSweep: {e}"));
    inventory_backend::cloud::postgres::ExpenseMonthLine::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpenseMonthLine: {e}"));
    inventory_backend::cloud::postgres::ExpensesByMonth::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpensesByMonth: {e}"));
    inventory_backend::cloud::postgres::WithholdingRow::export_all(&config)
        .unwrap_or_else(|e| panic!("WithholdingRow: {e}"));
    inventory_backend::cloud::postgres::SitePaymentMethod::export_all(&config)
        .unwrap_or_else(|e| panic!("SitePaymentMethod: {e}"));
    inventory_backend::cloud::postgres::SetSitePaymentMethodsRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetSitePaymentMethodsRequest: {e}"));
    inventory_backend::cloud::domain::TillPaymentMethod::export_all(&config)
        .unwrap_or_else(|e| panic!("TillPaymentMethod: {e}"));
    inventory_backend::cloud::domain::PaymentMethodBook::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentMethodBook: {e}"));
    inventory_backend::cloud::postgres::PeriodClosingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PeriodClosingRequest: {e}"));
    inventory_backend::cloud::postgres::PeriodClosingVoucher::export_all(&config)
        .unwrap_or_else(|e| panic!("PeriodClosingVoucher: {e}"));
    inventory_backend::cloud::postgres::SemanticKeyDoc::export_all(&config)
        .unwrap_or_else(|e| panic!("SemanticKeyDoc: {e}"));

    // lane-A: a day of takings, and moving a settled tender. Exported for the
    // same reason everything above it is — the screens that generate a day,
    // read its working paper and retender a card have to agree with the server
    // about the shape of all three, and the only way to guarantee that is for
    // one of them to be written by the other.
    inventory_backend::cloud::postgres::SalesPosting::export_all(&config)
        .unwrap_or_else(|e| panic!("SalesPosting: {e}"));
    inventory_backend::cloud::postgres::SalesPostingLine::export_all(&config)
        .unwrap_or_else(|e| panic!("SalesPostingLine: {e}"));
    inventory_backend::cloud::postgres::SalesPostingDocument::export_all(&config)
        .unwrap_or_else(|e| panic!("SalesPostingDocument: {e}"));
    // Finance Connect: the sale-day exception queue and Finance's setup.
    for_contract!(
        &config,
        SalesPostingException,
        ResolveSalesExceptionRequest,
        EdcTerminal,
        UpsertEdcTerminalRequest,
        AcquirerFeeRate,
        SetAcquirerFeeRateRequest,
        FinanceSetting,
        SetFinanceSettingRequest,
        NewBankTerminal,
        AddBankRequest,
        AddBankOutcome,
    );
    inventory_backend::cloud::postgres::GenerateSalesPostingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("GenerateSalesPostingRequest: {e}"));
    inventory_backend::cloud::postgres::GenerateSalesDaysRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("GenerateSalesDaysRequest: {e}"));
    inventory_backend::cloud::postgres::GeneratedDay::export_all(&config)
        .unwrap_or_else(|e| panic!("GeneratedDay: {e}"));
    inventory_backend::cloud::postgres::ReverseSalesPostingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReverseSalesPostingRequest: {e}"));
    inventory_backend::cloud::postgres::RetenderRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RetenderRequest: {e}"));
    inventory_backend::cloud::postgres::RetenderOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("RetenderOutcome: {e}"));
    // end lane-A
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
    // The two-way check. Both sides of every head-office/shop balance, which
    // is the one figure in these books that two people have to agree about.
    inventory_backend::cloud::postgres::InterunitPair::export_all(&config)
        .unwrap_or_else(|e| panic!("InterunitPair: {e}"));
    inventory_backend::cloud::postgres::InterunitMovement::export_all(&config)
        .unwrap_or_else(|e| panic!("InterunitMovement: {e}"));
    inventory_backend::cloud::postgres::InterunitReport::export_all(&config)
        .unwrap_or_else(|e| panic!("InterunitReport: {e}"));
    inventory_backend::cloud::http::finance::AccountDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountDetail: {e}"));
    inventory_backend::cloud::http::finance::PeriodRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PeriodRequest: {e}"));

    // GA tahap 6, the Finance handoff: the six warnings before posting, and
    // the hold request that goes with them. `BillWarning` is named here and not
    // left to a derive — nothing else reaches it, and a type that is only
    // derived is silently never written.
    inventory_backend::cloud::postgres::BillWarning::export_all(&config)
        .unwrap_or_else(|e| panic!("BillWarning: {e}"));
    inventory_backend::cloud::http::finance::HoldBillRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("HoldBillRequest: {e}"));

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
    inventory_backend::cloud::postgres::UnbilledPage::export_all(&config)
        .unwrap_or_else(|e| panic!("UnbilledPage: {e}"));
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

    // The rest of the payables loop. `BillMatchRequest` and `BillMatchLine`
    // arrive on their own through `RecordBillRequest::export_all` above, so
    // they are not repeated here; everything else has to be asked for.
    //
    // `ReceiptAwaitingPosting` is the queue screen and `ThreeWayReport` the
    // exception report, and the two are different questions: the first is what
    // finance still has to do, the second is what the books and the warehouse
    // disagree about. `PaymentDeductions` is what a payment will actually move,
    // which a person has to be able to see before it posts rather than after.
    inventory_backend::cloud::postgres::ReceiptPosting::export_all(&config)
        .unwrap_or_else(|e| panic!("ReceiptPosting: {e}"));
    inventory_backend::cloud::postgres::ReceiptAwaitingPosting::export_all(&config)
        .unwrap_or_else(|e| panic!("ReceiptAwaitingPosting: {e}"));
    inventory_backend::cloud::postgres::BillMatch::export_all(&config)
        .unwrap_or_else(|e| panic!("BillMatch: {e}"));
    inventory_backend::cloud::postgres::ThreeWayReport::export_all(&config)
        .unwrap_or_else(|e| panic!("ThreeWayReport: {e}"));
    inventory_backend::cloud::postgres::CreditNote::export_all(&config)
        .unwrap_or_else(|e| panic!("CreditNote: {e}"));
    inventory_backend::cloud::postgres::CreditNoteRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreditNoteRequest: {e}"));
    inventory_backend::cloud::postgres::CreditNoteRefundRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreditNoteRefundRequest: {e}"));
    inventory_backend::cloud::postgres::SupplierAdvance::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierAdvance: {e}"));
    inventory_backend::cloud::postgres::SupplierAdvanceRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierAdvanceRequest: {e}"));
    inventory_backend::cloud::postgres::SupplierAdvanceApplyRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SupplierAdvanceApplyRequest: {e}"));
    inventory_backend::cloud::postgres::PaymentDeductions::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentDeductions: {e}"));
    inventory_backend::cloud::postgres::PaymentWithholdRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentWithholdRequest: {e}"));

    // Payables ageing. `AgingBuckets` is one shape used twice — per supplier
    // and for the footer — so the total does not have to invent a supplier id.
    inventory_backend::cloud::postgres::PayablesAging::export_all(&config)
        .unwrap_or_else(|e| panic!("PayablesAging: {e}"));
    inventory_backend::cloud::postgres::PayablesAgingRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PayablesAgingRow: {e}"));
    inventory_backend::cloud::postgres::AgingBuckets::export_all(&config)
        .unwrap_or_else(|e| panic!("AgingBuckets: {e}"));

    // lane-P — the Payment Ledger. Accounts Payable and Accounts Receivable are
    // two readings of one table, which is why `PaymentLedgerEntry` carries a
    // `side` rather than the browser knowing which screen it is on. Nothing
    // here has a request type, and that is the shape rather than an omission:
    // an open balance is opened by the posting rule that created the document,
    // never by a screen, so the wire runs one way.
    inventory_backend::cloud::postgres::PaymentLedgerEntry::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerEntry: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerSide::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerSide: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerPartyType::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerPartyType: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerAging::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerAging: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerAgingRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerAgingRow: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerPartyStatement::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerPartyStatement: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerSettlementRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerSettlementRow: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerSettled::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerSettled: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerRemainder::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerRemainder: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerDelinked::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerDelinked: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerOutstanding::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerOutstanding: {e}"));
    // The equation. `agrees` is sent rather than left for the browser to work
    // out, for the same reason `TrialBalance.balanced` is.
    inventory_backend::cloud::postgres::PaymentLedgerIntegrity::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerIntegrity: {e}"));
    inventory_backend::cloud::postgres::PaymentLedgerIntegrityRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerIntegrityRow: {e}"));
    inventory_backend::cloud::http::payment_ledger::PaymentLedgerView::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentLedgerView: {e}"));

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

    // Whether a month's depreciation is actually done, for the period-close
    // checklist. `missing` is a list and not a count: a screen saying "11
    // outstanding" sends somebody looking for which eleven.
    inventory_backend::cloud::postgres::AssetDepreciationStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetDepreciationStatus: {e}"));
    inventory_backend::cloud::postgres::AssetAwaitingCharge::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetAwaitingCharge: {e}"));
    inventory_backend::cloud::postgres::DepreciationRunRecord::export_all(&config)
        .unwrap_or_else(|e| panic!("DepreciationRunRecord: {e}"));

    // The replacement reserve. The client's seventh asset family is not
    // depreciated at all — their chart carries three parallel blocks of
    // thirty-six accounts for reserving against it instead.
    inventory_backend::cloud::postgres::AssetReserveClass::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetReserveClass: {e}"));
    inventory_backend::cloud::postgres::AssetReplacementRate::export_all(&config)
        .unwrap_or_else(|e| panic!("AssetReplacementRate: {e}"));
    inventory_backend::cloud::postgres::SetReplacementRateRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SetReplacementRateRequest: {e}"));
    inventory_backend::cloud::postgres::ReserveRun::export_all(&config)
        .unwrap_or_else(|e| panic!("ReserveRun: {e}"));
    inventory_backend::cloud::postgres::ReserveChargeLine::export_all(&config)
        .unwrap_or_else(|e| panic!("ReserveChargeLine: {e}"));
    inventory_backend::cloud::postgres::ReserveStatus::export_all(&config)
        .unwrap_or_else(|e| panic!("ReserveStatus: {e}"));

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

    // A day's takings, as the unposted-days list shows them. The request that
    // used to post one went with the retired writer in 0273; the authority's
    // own document is `SalesPosting`. `SaleDayPage` pulls `SaleDayRow` in
    // with it, and it is named here anyway for the reason the comment below
    // gives: a derive writes nothing until something asks it to.
    // The five subledgers 0278-0282 added, the control panel above them and the
    // two statements. A type not NAMED here is not written, whatever its derive
    // says — which is how `TaxRule` once reached the browser as a type nobody
    // could import.
    for_contract!(
        &config,
        PrepaidSchedule,
        PrepaidSchedulePage,
        PrepaidAllocation,
        PrepaidScheduleDocument,
        CreatePrepaidScheduleRequest,
        PrepaidAllocationRequest,
        PrepaidAllocationRun,
        PrepaidReconciliationRow,
        TaxType,
        TaxPeriod,
        TaxLedgerItem,
        TaxPeriodDocument,
        RecordTaxItemRequest,
        SettleTaxRequest,
        FileTaxPeriodRequest,
        TaxReconciliationRow,
        Advance,
        AdvancePage,
        AdvanceSettlement,
        AdvanceDocument,
        CreateAdvanceRequest,
        PayAdvanceRequest,
        SettleAdvanceRequest,
        AdvanceReconciliationRow,
        Principal,
        PrincipalTransaction,
        PrincipalDocument,
        CreatePrincipalRequest,
        PrincipalMovementRequest,
        FinancingFacility,
        FinancingInstallment,
        FinancingFacilityDocument,
        ScheduledInstallment,
        CreateFacilityRequest,
        PayInstallmentRequest,
        ControlRow,
        FinanceCloseCheck,
        FinanceCloseReadiness,
        FinancialStatementLine,
        BalanceSheet,
        ProfitAndLoss,
        UnitResult
    );

    // The forty-account chart's two new lists. Identity that used to be baked
    // into an account code is now a category on the line, and an asset's class
    // is the register's own code rather than a family under `10215` — so the
    // account picker needs to be told which categories an account admits, and
    // the register needs to be told what an asset may be filed as. Named here
    // and not merely derived, for the reason the whole file exists: a type that
    // is not named is silently not written.
    for_contract!(
        &config,
        LineCategory,
        CategoryAccount,
        CategoryFamily,
        CategoryPolicyOverride,
        LineCategoryDirectory,
        AssetClass,
        AssetClassList
    );
    inventory_backend::cloud::postgres::SaleDayRow::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleDayRow: {e}"));
    inventory_backend::cloud::postgres::SaleDayPage::export_all(&config)
        .unwrap_or_else(|e| panic!("SaleDayPage: {e}"));

    // General Affairs' own surface. One type today and the list grows with the
    // department — contracts, repairs, replacements, supplies — which is why it
    // is a named block rather than one line beside the asset ones.
    //
    // The overview is the screen that reads all of GA at once, so it is the
    // first thing here: what wants somebody's attention, with the thresholds
    // the server owns.
    inventory_backend::cloud::postgres::GaAttention::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAttention: {e}"));
    inventory_backend::cloud::postgres::GaOverview::export_all(&config)
        .unwrap_or_else(|e| panic!("GaOverview: {e}"));

    // The document drawer's four types, which were transcribed by hand in
    // `frontend-hub/src/lib/queries/workplace.ts` since the drawer landed —
    // with a comment saying the fix was to regenerate rather than edit the
    // shape. This is that regeneration: 0358 added an expiry to a document, and
    // a hand-written mirror would have gone on saying a STNK has no
    // `expires_on` while the server sent one.
    for_contract!(
        &config,
        Document,
        DocumentLink,
        DocumentUpload,
        DocumentUploadRequest,
        FileDocumentRequest
    );

    // GA's own half of the asset register — the upkeep side, and the history
    // that says how a thing got where it is. Named one by one rather than left
    // to a derive, for the reason this whole file exists: `export_all` writes
    // the type it is CALLED on and everything that type reaches, and nothing
    // above reaches an asset page. A derive with no caller writes nothing at
    // all, silently.
    //
    // The three request types are named for the same reason and not because a
    // server reads them: a client that can read a register and cannot write one
    // has half a screen, and a struct that is only ever deserialised is
    // reachable from nothing the server sends.
    inventory_backend::cloud::postgres::GaAssetRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAssetRow: {e}"));
    inventory_backend::cloud::postgres::GaAssetPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAssetPage: {e}"));
    inventory_backend::cloud::postgres::GaAssetFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAssetFacets: {e}"));
    inventory_backend::cloud::postgres::GaAssetFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAssetFacet: {e}"));
    inventory_backend::cloud::postgres::GaAssetEvent::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAssetEvent: {e}"));
    inventory_backend::cloud::postgres::GaAssetHub::export_all(&config)
        .unwrap_or_else(|e| panic!("GaAssetHub: {e}"));
    inventory_backend::cloud::postgres::GaDocument::export_all(&config)
        .unwrap_or_else(|e| panic!("GaDocument: {e}"));
    inventory_backend::cloud::postgres::RegisterGaAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RegisterGaAssetRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateGaAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGaAssetRequest: {e}"));
    inventory_backend::cloud::postgres::TransferGaAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("TransferGaAssetRequest: {e}"));
    inventory_backend::cloud::postgres::NoteGaAssetRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("NoteGaAssetRequest: {e}"));

    // The eleven forms — what the register's "new asset" screen draws itself
    // from. Exported from `domain` rather than `postgres` because that is where
    // the table lives: it is the same table `assert_specs` enforces, which is
    // the whole point of the route that serves it.
    inventory_backend::cloud::domain::GaBuildSchema::export_all(&config)
        .unwrap_or_else(|e| panic!("GaBuildSchema: {e}"));
    inventory_backend::cloud::domain::GaBuildSpec::export_all(&config)
        .unwrap_or_else(|e| panic!("GaBuildSpec: {e}"));
    inventory_backend::cloud::domain::GaBuildField::export_all(&config)
        .unwrap_or_else(|e| panic!("GaBuildField: {e}"));

    // GA tahap 3: the contract register, its hub, its meters and its two
    // vocabularies. Exported one by one for the reason every block here gives:
    // `export_all` writes the type it is called on and what that type reaches,
    // and a derive with no caller writes nothing.
    inventory_backend::cloud::postgres::GaContractRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractRow: {e}"));
    inventory_backend::cloud::postgres::GaContractPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractPage: {e}"));
    inventory_backend::cloud::postgres::GaContractSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractSummary: {e}"));
    inventory_backend::cloud::postgres::GaContractFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractFacets: {e}"));
    inventory_backend::cloud::postgres::GaContractFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractFacet: {e}"));
    inventory_backend::cloud::postgres::GaContractHub::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractHub: {e}"));
    inventory_backend::cloud::postgres::GaContractBill::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractBill: {e}"));
    inventory_backend::cloud::postgres::GaContractTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractTemplate: {e}"));
    inventory_backend::cloud::postgres::GaMeterReading::export_all(&config)
        .unwrap_or_else(|e| panic!("GaMeterReading: {e}"));
    inventory_backend::cloud::postgres::GaContractType::export_all(&config)
        .unwrap_or_else(|e| panic!("GaContractType: {e}"));
    inventory_backend::cloud::postgres::RecordGaContractRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordGaContractRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateGaContractRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGaContractRequest: {e}"));
    inventory_backend::cloud::postgres::ArchiveGaContractRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ArchiveGaContractRequest: {e}"));
    inventory_backend::cloud::postgres::RecordMeterReadingRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordMeterReadingRequest: {e}"));

    // GA tahap 4: the upkeep — the schedule, the walk-round, the repair, the
    // swap and the disposal. Exported one by one and not left to a derive, for
    // the reason the block above gives: `export_all` writes the type it is
    // CALLED on and everything that type reaches, and nothing above reaches
    // these. A derive with no caller writes nothing at all, silently.
    //
    // `GaMaintenanceFacet` is shared by all five lists, so it is named once;
    // each `Page` pulls its own facet set in behind it, and the request types
    // are named because a client that can read a list and cannot write one has
    // half a screen.
    inventory_backend::cloud::postgres::GaMaintenanceFacet::export_all(&config)
        .unwrap_or_else(|e| panic!("GaMaintenanceFacet: {e}"));
    inventory_backend::cloud::postgres::GaMaintenanceTask::export_all(&config)
        .unwrap_or_else(|e| panic!("GaMaintenanceTask: {e}"));
    inventory_backend::cloud::postgres::GaMaintenanceTaskRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaMaintenanceTaskRow: {e}"));
    inventory_backend::cloud::postgres::GaMaintenanceTaskPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaMaintenanceTaskPage: {e}"));
    inventory_backend::cloud::postgres::GaMaintenanceTaskFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaMaintenanceTaskFacets: {e}"));
    inventory_backend::cloud::postgres::RecordGaTaskRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordGaTaskRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateGaTaskRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGaTaskRequest: {e}"));

    inventory_backend::cloud::postgres::GaInspection::export_all(&config)
        .unwrap_or_else(|e| panic!("GaInspection: {e}"));
    inventory_backend::cloud::postgres::GaInspectionRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaInspectionRow: {e}"));
    inventory_backend::cloud::postgres::GaInspectionPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaInspectionPage: {e}"));
    inventory_backend::cloud::postgres::GaInspectionFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaInspectionFacets: {e}"));
    inventory_backend::cloud::postgres::RecordGaInspectionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordGaInspectionRequest: {e}"));

    inventory_backend::cloud::postgres::GaRepair::export_all(&config)
        .unwrap_or_else(|e| panic!("GaRepair: {e}"));
    inventory_backend::cloud::postgres::GaRepairRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaRepairRow: {e}"));
    inventory_backend::cloud::postgres::GaRepairPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaRepairPage: {e}"));
    inventory_backend::cloud::postgres::GaRepairSummary::export_all(&config)
        .unwrap_or_else(|e| panic!("GaRepairSummary: {e}"));
    inventory_backend::cloud::postgres::GaRepairFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaRepairFacets: {e}"));
    inventory_backend::cloud::postgres::RecordGaRepairRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordGaRepairRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateGaRepairRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGaRepairRequest: {e}"));
    inventory_backend::cloud::postgres::MoveGaRepairRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MoveGaRepairRequest: {e}"));
    inventory_backend::cloud::postgres::ApproveGaRepairRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ApproveGaRepairRequest: {e}"));

    inventory_backend::cloud::postgres::GaReplacement::export_all(&config)
        .unwrap_or_else(|e| panic!("GaReplacement: {e}"));
    inventory_backend::cloud::postgres::GaReplacementRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaReplacementRow: {e}"));
    inventory_backend::cloud::postgres::GaReplacementPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaReplacementPage: {e}"));
    inventory_backend::cloud::postgres::GaReplacementFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaReplacementFacets: {e}"));
    inventory_backend::cloud::postgres::RecordGaReplacementRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordGaReplacementRequest: {e}"));
    inventory_backend::cloud::postgres::MoveGaReplacementRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MoveGaReplacementRequest: {e}"));

    inventory_backend::cloud::postgres::GaDisposal::export_all(&config)
        .unwrap_or_else(|e| panic!("GaDisposal: {e}"));
    inventory_backend::cloud::postgres::GaDisposalRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaDisposalRow: {e}"));
    inventory_backend::cloud::postgres::GaDisposalPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaDisposalPage: {e}"));
    inventory_backend::cloud::postgres::GaDisposalFacets::export_all(&config)
        .unwrap_or_else(|e| panic!("GaDisposalFacets: {e}"));
    inventory_backend::cloud::postgres::RequestGaDisposalRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RequestGaDisposalRequest: {e}"));
    inventory_backend::cloud::postgres::DecideGaDisposalRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("DecideGaDisposalRequest: {e}"));
    inventory_backend::cloud::postgres::GaRepairObject::export_all(&config)
        .unwrap_or_else(|e| panic!("GaRepairObject: {e}"));

    // GA tahap 5: the places hub and the supplies register. Named one by one
    // for the reason the blocks above give — `export_all` writes only what the
    // type it is called on reaches.
    inventory_backend::cloud::postgres::GaLocationRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaLocationRow: {e}"));
    inventory_backend::cloud::postgres::GaLocationHub::export_all(&config)
        .unwrap_or_else(|e| panic!("GaLocationHub: {e}"));
    inventory_backend::cloud::postgres::UpdateGaLocationRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGaLocationRequest: {e}"));
    inventory_backend::cloud::postgres::GaSupplyRequestRow::export_all(&config)
        .unwrap_or_else(|e| panic!("GaSupplyRequestRow: {e}"));
    inventory_backend::cloud::postgres::GaSupplyPage::export_all(&config)
        .unwrap_or_else(|e| panic!("GaSupplyPage: {e}"));
    inventory_backend::cloud::postgres::GaSupplyCategory::export_all(&config)
        .unwrap_or_else(|e| panic!("GaSupplyCategory: {e}"));
    inventory_backend::cloud::postgres::RecordGaSupplyRequestRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordGaSupplyRequestRequest: {e}"));
    inventory_backend::cloud::postgres::MoveGaSupplyRequestRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("MoveGaSupplyRequestRequest: {e}"));
    inventory_backend::cloud::postgres::UpdateGaSupplyRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UpdateGaSupplyRequest: {e}"));

    // GA tahap 6: the account a line proposes (brief §8.2) and the draft GA
    // files (brief §8.3). Both are wire types the GA forms and the Finance
    // Inbox read; named here for the reason every block above gives.
    inventory_backend::cloud::postgres::AccountSuggestion::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountSuggestion: {e}"));
    inventory_backend::cloud::http::ga::GaBillRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("GaBillRequest: {e}"));
    inventory_backend::cloud::http::ga::GaBillLineRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("GaBillLineRequest: {e}"));

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
    // lane-C: the money documents, and the two things that make one without a
    // person typing it.
    //
    // The slip is exported as its own shape rather than assembled in the
    // browser from the row. Everything on it — the title, the account names,
    // the amount in words — is derived, and a page that re-derived them would
    // be a second implementation of the derivation: a slip whose words
    // disagreed with its figures is worse than one with no words at all.
    inventory_backend::cloud::postgres::RecordCashDocumentRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordCashDocumentRequest: {e}"));
    inventory_backend::cloud::postgres::CashDocumentRow::export_all(&config)
        .unwrap_or_else(|e| panic!("CashDocumentRow: {e}"));
    inventory_backend::cloud::postgres::CashDocumentSlip::export_all(&config)
        .unwrap_or_else(|e| panic!("CashDocumentSlip: {e}"));
    inventory_backend::cloud::postgres::RecordBankRuleRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordBankRuleRequest: {e}"));
    inventory_backend::cloud::postgres::BankRuleRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BankRuleRow: {e}"));
    inventory_backend::cloud::postgres::BankRuleProposalRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BankRuleProposalRow: {e}"));
    inventory_backend::cloud::postgres::BankRuleRunOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("BankRuleRunOutcome: {e}"));
    // One root: `export_all` pulls `GiroRow` and `GiroBankTotal` in behind the
    // board.
    inventory_backend::cloud::postgres::GiroBoard::export_all(&config)
        .unwrap_or_else(|e| panic!("GiroBoard: {e}"));
    inventory_backend::cloud::postgres::SettleGiroRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("SettleGiroRequest: {e}"));
    inventory_backend::cloud::postgres::UnclearGiroRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("UnclearGiroRequest: {e}"));
    inventory_backend::cloud::postgres::ReplaceGiroRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ReplaceGiroRequest: {e}"));

    // lane-N: the words a person explains money in, and the three doors out of
    // one bank statement line.
    //
    // `BankLineOptions` is exported as one root rather than three lists a page
    // assembles, because the ORDER of the three is the design: matches, then
    // documents to create, then categories. A browser type that let a page pick
    // the blocks up separately would be a type that let it show them in any
    // order, and the fastest of the three is the one that double-counts.
    inventory_backend::cloud::postgres::TransactionCategoryRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TransactionCategoryRow: {e}"));
    inventory_backend::cloud::postgres::RecordTransactionCategoryRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordTransactionCategoryRequest: {e}"));
    inventory_backend::cloud::postgres::BankLineOptions::export_all(&config)
        .unwrap_or_else(|e| panic!("BankLineOptions: {e}"));
    inventory_backend::cloud::postgres::CategoriseBankLineRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CategoriseBankLineRequest: {e}"));
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
    // People's next generation — swaps, change proposals, checklists, the
    // pipeline, performance, training, the rule numbers and the org masters.
    inventory_backend::cloud::http::people::RosterSwapView::export_all(&config)
        .unwrap_or_else(|e| panic!("RosterSwapView: {e}"));
    inventory_backend::cloud::http::people::FileSwapBody::export_all(&config)
        .unwrap_or_else(|e| panic!("FileSwapBody: {e}"));
    inventory_backend::cloud::http::people::SwapDecisionBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SwapDecisionBody: {e}"));
    inventory_backend::cloud::http::people::ChangeProposalView::export_all(&config)
        .unwrap_or_else(|e| panic!("ChangeProposalView: {e}"));
    inventory_backend::cloud::http::people::ChangePropView::export_all(&config)
        .unwrap_or_else(|e| panic!("ChangePropView: {e}"));
    inventory_backend::cloud::http::people::FileChangeBody::export_all(&config)
        .unwrap_or_else(|e| panic!("FileChangeBody: {e}"));
    inventory_backend::cloud::http::people::ChangeDecisionBody::export_all(&config)
        .unwrap_or_else(|e| panic!("ChangeDecisionBody: {e}"));
    inventory_backend::cloud::http::people::LifecycleTaskView::export_all(&config)
        .unwrap_or_else(|e| panic!("LifecycleTaskView: {e}"));
    inventory_backend::cloud::http::people::CompleteTaskBody::export_all(&config)
        .unwrap_or_else(|e| panic!("CompleteTaskBody: {e}"));
    inventory_backend::cloud::http::people::StaffingPlanView::export_all(&config)
        .unwrap_or_else(|e| panic!("StaffingPlanView: {e}"));
    inventory_backend::cloud::http::people::PlanBody::export_all(&config)
        .unwrap_or_else(|e| panic!("PlanBody: {e}"));
    inventory_backend::cloud::http::people::ApplicantView::export_all(&config)
        .unwrap_or_else(|e| panic!("ApplicantView: {e}"));
    inventory_backend::cloud::http::people::FileApplicantBody::export_all(&config)
        .unwrap_or_else(|e| panic!("FileApplicantBody: {e}"));
    inventory_backend::cloud::http::people::StageBody::export_all(&config)
        .unwrap_or_else(|e| panic!("StageBody: {e}"));
    inventory_backend::cloud::http::people::ScheduleInterviewBody::export_all(&config)
        .unwrap_or_else(|e| panic!("ScheduleInterviewBody: {e}"));
    inventory_backend::cloud::http::people::InterviewView::export_all(&config)
        .unwrap_or_else(|e| panic!("InterviewView: {e}"));
    inventory_backend::cloud::http::people::InterviewResultBody::export_all(&config)
        .unwrap_or_else(|e| panic!("InterviewResultBody: {e}"));
    inventory_backend::cloud::http::people::OfferView::export_all(&config)
        .unwrap_or_else(|e| panic!("OfferView: {e}"));
    inventory_backend::cloud::http::people::MakeOfferBody::export_all(&config)
        .unwrap_or_else(|e| panic!("MakeOfferBody: {e}"));
    inventory_backend::cloud::http::people::OfferDecisionBody::export_all(&config)
        .unwrap_or_else(|e| panic!("OfferDecisionBody: {e}"));
    inventory_backend::cloud::http::people::HireBody::export_all(&config)
        .unwrap_or_else(|e| panic!("HireBody: {e}"));
    inventory_backend::cloud::http::people::PerformanceTemplateView::export_all(&config)
        .unwrap_or_else(|e| panic!("PerformanceTemplateView: {e}"));
    inventory_backend::cloud::http::people::PerformanceScoreView::export_all(&config)
        .unwrap_or_else(|e| panic!("PerformanceScoreView: {e}"));
    inventory_backend::cloud::http::people::RecordScoreBody::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordScoreBody: {e}"));
    inventory_backend::cloud::http::people::TrainingProgramView::export_all(&config)
        .unwrap_or_else(|e| panic!("TrainingProgramView: {e}"));
    inventory_backend::cloud::http::people::TrainingParticipantView::export_all(&config)
        .unwrap_or_else(|e| panic!("TrainingParticipantView: {e}"));
    inventory_backend::cloud::http::people::TrainingAttendanceRecordView::export_all(&config)
        .unwrap_or_else(|e| panic!("TrainingAttendanceRecordView: {e}"));
    inventory_backend::cloud::http::people::RecordTrainingAttendanceBody::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordTrainingAttendanceBody: {e}"));
    inventory_backend::cloud::http::people::DefineTrainingBody::export_all(&config)
        .unwrap_or_else(|e| panic!("DefineTrainingBody: {e}"));
    inventory_backend::cloud::http::people::NominateBody::export_all(&config)
        .unwrap_or_else(|e| panic!("NominateBody: {e}"));
    inventory_backend::cloud::http::people::UniformIssuanceView::export_all(&config)
        .unwrap_or_else(|e| panic!("UniformIssuanceView: {e}"));
    inventory_backend::cloud::http::people::UniformBody::export_all(&config)
        .unwrap_or_else(|e| panic!("UniformBody: {e}"));
    inventory_backend::cloud::http::people::PolicyView::export_all(&config)
        .unwrap_or_else(|e| panic!("PolicyView: {e}"));
    inventory_backend::cloud::http::people::PolicySetBody::export_all(&config)
        .unwrap_or_else(|e| panic!("PolicySetBody: {e}"));
    inventory_backend::cloud::http::people::GradeView::export_all(&config)
        .unwrap_or_else(|e| panic!("GradeView: {e}"));
    inventory_backend::cloud::http::people::PositionView::export_all(&config)
        .unwrap_or_else(|e| panic!("PositionView: {e}"));
    inventory_backend::cloud::http::people::StructureView::export_all(&config)
        .unwrap_or_else(|e| panic!("StructureView: {e}"));
    inventory_backend::cloud::http::people::ColleagueView::export_all(&config)
        .unwrap_or_else(|e| panic!("ColleagueView: {e}"));
    inventory_backend::cloud::http::people::ColleagueDayView::export_all(&config)
        .unwrap_or_else(|e| panic!("ColleagueDayView: {e}"));
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
    // Pay and payroll. `PayrollSlipRow` carries a deduction total and a net
    // only when every line on it was worked out, and it is generated rather
    // than transcribed for exactly that reason: a hand-written type could make
    // `net_minor` required, and a screen would then show a zero as though
    // somebody had computed it.
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
    // PPh 21 and BPJS (0800). The BPJS rates a head office states from a
    // date, the body that states them, and the tax tables the slips were
    // worked out from — `TerCategory`, `BpjsRates` and the table rows come in
    // behind them.
    inventory_backend::cloud::http::components::StatutoryRateView::export_all(&config)
        .unwrap_or_else(|e| panic!("StatutoryRateView: {e}"));
    inventory_backend::cloud::http::components::RatifyStatutoryRateBody::export_all(&config)
        .unwrap_or_else(|e| panic!("RatifyStatutoryRateBody: {e}"));
    inventory_backend::cloud::http::components::TaxTablesView::export_all(&config)
        .unwrap_or_else(|e| panic!("TaxTablesView: {e}"));
    inventory_backend::cloud::domain::TaxMethod::export_all(&config)
        .unwrap_or_else(|e| panic!("TaxMethod: {e}"));
    // The payroll schedule and salary structures (0801, 0802).
    inventory_backend::cloud::http::pay::PayrollScheduleView::export_all(&config)
        .unwrap_or_else(|e| panic!("PayrollScheduleView: {e}"));
    inventory_backend::cloud::http::pay::StateScheduleBody::export_all(&config)
        .unwrap_or_else(|e| panic!("StateScheduleBody: {e}"));
    inventory_backend::cloud::http::components::SalaryStructureView::export_all(&config)
        .unwrap_or_else(|e| panic!("SalaryStructureView: {e}"));
    inventory_backend::cloud::http::components::SaveStructureBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveStructureBody: {e}"));
    inventory_backend::cloud::postgres::WithholdingView::export_all(&config)
        .unwrap_or_else(|e| panic!("WithholdingView: {e}"));
    inventory_backend::cloud::postgres::PayslipTemplate::export_all(&config)
        .unwrap_or_else(|e| panic!("PayslipTemplate: {e}"));
    inventory_backend::cloud::http::pay::SaveTemplateBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveTemplateBody: {e}"));
    inventory_backend::cloud::postgres::TaxReportRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TaxReportRow: {e}"));
    inventory_backend::cloud::postgres::AnnualTaxSlip::export_all(&config)
        .unwrap_or_else(|e| panic!("AnnualTaxSlip: {e}"));
    inventory_backend::cloud::postgres::LoanView::export_all(&config)
        .unwrap_or_else(|e| panic!("LoanView: {e}"));
    inventory_backend::cloud::postgres::LoanRepayment::export_all(&config)
        .unwrap_or_else(|e| panic!("LoanRepayment: {e}"));
    inventory_backend::cloud::http::pay::GrantLoanBody::export_all(&config)
        .unwrap_or_else(|e| panic!("GrantLoanBody: {e}"));
    inventory_backend::cloud::postgres::DepartmentView::export_all(&config)
        .unwrap_or_else(|e| panic!("DepartmentView: {e}"));
    inventory_backend::cloud::postgres::JobLevelView::export_all(&config)
        .unwrap_or_else(|e| panic!("JobLevelView: {e}"));
    inventory_backend::cloud::postgres::JobGradeView::export_all(&config)
        .unwrap_or_else(|e| panic!("JobGradeView: {e}"));
    inventory_backend::cloud::postgres::PlacementView::export_all(&config)
        .unwrap_or_else(|e| panic!("PlacementView: {e}"));
    inventory_backend::cloud::postgres::OrgChartNode::export_all(&config)
        .unwrap_or_else(|e| panic!("OrgChartNode: {e}"));
    inventory_backend::cloud::postgres::CompanyView::export_all(&config)
        .unwrap_or_else(|e| panic!("CompanyView: {e}"));
    inventory_backend::cloud::postgres::BpjsRegistrationView::export_all(&config)
        .unwrap_or_else(|e| panic!("BpjsRegistrationView: {e}"));
    inventory_backend::cloud::http::organisation::SaveDepartmentBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveDepartmentBody: {e}"));
    inventory_backend::cloud::http::organisation::SaveJobLevelBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveJobLevelBody: {e}"));
    inventory_backend::cloud::http::organisation::SaveJobGradeBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveJobGradeBody: {e}"));
    inventory_backend::cloud::http::organisation::PlaceBody::export_all(&config)
        .unwrap_or_else(|e| panic!("PlaceBody: {e}"));
    inventory_backend::cloud::http::organisation::RegisterBpjsBody::export_all(&config)
        .unwrap_or_else(|e| panic!("RegisterBpjsBody: {e}"));
    inventory_backend::cloud::postgres::BusinessUnitView::export_all(&config)
        .unwrap_or_else(|e| panic!("BusinessUnitView: {e}"));
    inventory_backend::cloud::postgres::GroupEntityView::export_all(&config)
        .unwrap_or_else(|e| panic!("GroupEntityView: {e}"));
    inventory_backend::cloud::http::organisation::SaveBusinessUnitBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveBusinessUnitBody: {e}"));
    inventory_backend::cloud::http::organisation::SaveGroupEntityBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveGroupEntityBody: {e}"));
    inventory_backend::cloud::postgres::ChecklistTemplateView::export_all(&config)
        .unwrap_or_else(|e| panic!("ChecklistTemplateView: {e}"));
    inventory_backend::cloud::http::organisation::SaveChecklistTemplateBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveChecklistTemplateBody: {e}"));
    inventory_backend::cloud::postgres::MobileAttendanceSetting::export_all(&config)
        .unwrap_or_else(|e| panic!("MobileAttendanceSetting: {e}"));
    inventory_backend::cloud::postgres::GeofenceView::export_all(&config)
        .unwrap_or_else(|e| panic!("GeofenceView: {e}"));
    inventory_backend::cloud::postgres::AbsenceRuleView::export_all(&config)
        .unwrap_or_else(|e| panic!("AbsenceRuleView: {e}"));
    inventory_backend::cloud::http::attendance_settings::SaveMobileSettingBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SaveMobileSettingBody: {e}"));
    inventory_backend::cloud::http::attendance_settings::SetGeofenceBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SetGeofenceBody: {e}"));
    inventory_backend::cloud::http::attendance_settings::StateAbsenceRuleBody::export_all(&config)
        .unwrap_or_else(|e| panic!("StateAbsenceRuleBody: {e}"));
    inventory_backend::cloud::http::attendance_settings::OwnAttendanceSetting::export_all(&config)
        .unwrap_or_else(|e| panic!("OwnAttendanceSetting: {e}"));
    inventory_backend::cloud::http::attendance_settings::OvertimeTierView::export_all(&config)
        .unwrap_or_else(|e| panic!("OvertimeTierView: {e}"));
    inventory_backend::cloud::http::attendance_settings::SetOvertimeTierBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SetOvertimeTierBody: {e}"));
    inventory_backend::cloud::postgres::LeaveBlackoutView::export_all(&config)
        .unwrap_or_else(|e| panic!("LeaveBlackoutView: {e}"));
    inventory_backend::cloud::postgres::LeaveEncashmentView::export_all(&config)
        .unwrap_or_else(|e| panic!("LeaveEncashmentView: {e}"));
    inventory_backend::cloud::postgres::HolidayWorkView::export_all(&config)
        .unwrap_or_else(|e| panic!("HolidayWorkView: {e}"));
    inventory_backend::cloud::postgres::TeamCalendarView::export_all(&config)
        .unwrap_or_else(|e| panic!("TeamCalendarView: {e}"));
    inventory_backend::cloud::postgres::TeamLeaveSpan::export_all(&config)
        .unwrap_or_else(|e| panic!("TeamLeaveSpan: {e}"));
    inventory_backend::cloud::http::leave_extras::BlockLeaveBody::export_all(&config)
        .unwrap_or_else(|e| panic!("BlockLeaveBody: {e}"));
    inventory_backend::cloud::http::leave_extras::EncashLeaveBody::export_all(&config)
        .unwrap_or_else(|e| panic!("EncashLeaveBody: {e}"));
    inventory_backend::cloud::http::leave_extras::RecordHolidayWorkBody::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordHolidayWorkBody: {e}"));
    inventory_backend::cloud::postgres::ClaimBenefitView::export_all(&config)
        .unwrap_or_else(|e| panic!("ClaimBenefitView: {e}"));
    inventory_backend::cloud::postgres::ClaimBalanceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("ClaimBalanceRow: {e}"));
    inventory_backend::cloud::http::claims::StateBenefitBody::export_all(&config)
        .unwrap_or_else(|e| panic!("StateBenefitBody: {e}"));
    inventory_backend::cloud::http::claims::OverrideBenefitBody::export_all(&config)
        .unwrap_or_else(|e| panic!("OverrideBenefitBody: {e}"));
    inventory_backend::cloud::postgres::WarningLetterView::export_all(&config)
        .unwrap_or_else(|e| panic!("WarningLetterView: {e}"));
    inventory_backend::cloud::http::discipline::IssueLetterBody::export_all(&config)
        .unwrap_or_else(|e| panic!("IssueLetterBody: {e}"));
    inventory_backend::cloud::postgres::PersonalDataRequestView::export_all(&config)
        .unwrap_or_else(|e| panic!("PersonalDataRequestView: {e}"));
    inventory_backend::cloud::http::data_requests::FileDataRequestBody::export_all(&config)
        .unwrap_or_else(|e| panic!("FileDataRequestBody: {e}"));
    inventory_backend::cloud::http::data_requests::DecideDataRequestBody::export_all(&config)
        .unwrap_or_else(|e| panic!("DecideDataRequestBody: {e}"));
    inventory_backend::cloud::postgres::BenefitBalanceRow::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitBalanceRow: {e}"));
    inventory_backend::cloud::postgres::BenefitAccountView::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitAccountView: {e}"));
    inventory_backend::cloud::postgres::BenefitSettingView::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitSettingView: {e}"));
    inventory_backend::cloud::postgres::BenefitCodeView::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitCodeView: {e}"));
    inventory_backend::cloud::postgres::BenefitHolderView::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitHolderView: {e}"));
    // Finance's one-time code for a big shop expense (0822).
    inventory_backend::cloud::postgres::ExpenseCodeView::export_all(&config)
        .unwrap_or_else(|e| panic!("ExpenseCodeView: {e}"));
    inventory_backend::cloud::postgres::IssueExpenseCodeRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("IssueExpenseCodeRequest: {e}"));
    inventory_backend::cloud::http::benefit::AdjustBenefitBody::export_all(&config)
        .unwrap_or_else(|e| panic!("AdjustBenefitBody: {e}"));
    inventory_backend::cloud::http::benefit::BenefitSettingBody::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitSettingBody: {e}"));
    inventory_backend::cloud::http::benefit::BenefitSpendBody::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitSpendBody: {e}"));
    inventory_backend::cloud::http::benefit::BenefitReturnBody::export_all(&config)
        .unwrap_or_else(|e| panic!("BenefitReturnBody: {e}"));
    inventory_backend::cloud::postgres::DelegationView::export_all(&config)
        .unwrap_or_else(|e| panic!("DelegationView: {e}"));
    inventory_backend::cloud::http::delegation::DelegateBody::export_all(&config)
        .unwrap_or_else(|e| panic!("DelegateBody: {e}"));
    inventory_backend::cloud::http::delegation::EssModulesView::export_all(&config)
        .unwrap_or_else(|e| panic!("EssModulesView: {e}"));
    inventory_backend::cloud::http::delegation::SetEssModulesBody::export_all(&config)
        .unwrap_or_else(|e| panic!("SetEssModulesBody: {e}"));
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
    inventory_backend::cloud::postgres::AccountLinkPage::export_all(&config)
        .unwrap_or_else(|e| panic!("AccountLinkPage: {e}"));
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
    inventory_backend::cloud::postgres::ReceivedShipmentList::export_all(&config)
        .unwrap_or_else(|e| panic!("ReceivedShipmentList: {e}"));
    inventory_backend::cloud::postgres::SkuSupplierList::export_all(&config)
        .unwrap_or_else(|e| panic!("SkuSupplierList: {e}"));
    inventory_backend::cloud::postgres::ArticleHistory::export_all(&config)
        .unwrap_or_else(|e| panic!("ArticleHistory: {e}"));
    inventory_backend::cloud::postgres::UnfilledList::export_all(&config)
        .unwrap_or_else(|e| panic!("UnfilledList: {e}"));
    inventory_backend::cloud::postgres::AllotmentCloseShortRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("AllotmentCloseShortRequest: {e}"));
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
    // The master screen's writes (`http::payment_terms`).
    for_contract!(
        &config,
        CreatePaymentTermRequest,
        UpdatePaymentTermRequest,
        PaymentTermsTemplateLineInput,
        CreatePaymentTermsTemplateRequest,
        UpdatePaymentTermsTemplateRequest,
    );

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
    // Every saved edit of a purchase order, which the order sheet reads back
    // as its history (migration 0393).
    inventory_backend::cloud::postgres::PurchaseOrderRevisionEntry::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseOrderRevisionEntry: {e}"));
    inventory_backend::cloud::postgres::CatalogPurchaseLineVariant::export_all(&config)
        .unwrap_or_else(|e| panic!("CatalogPurchaseLineVariant: {e}"));
    inventory_backend::cloud::postgres::CancelPurchaseOrderRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CancelPurchaseOrderRequest: {e}"));
    inventory_backend::cloud::postgres::PurchaseOrderCancelled::export_all(&config)
        .unwrap_or_else(|e| panic!("PurchaseOrderCancelled: {e}"));
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

    // PO intake: the drafts a buyer edits before the order exists. Exported
    // from the intake kernel, not postgres — these never touch the books; the
    // order route does, and it already has its own types.
    inventory_backend::cloud::intake::po::PoImportIngestResponse::export_all(&config)
        .unwrap_or_else(|e| panic!("PoImportIngestResponse: {e}"));
    inventory_backend::cloud::intake::po::PoImportFileReport::export_all(&config)
        .unwrap_or_else(|e| panic!("PoImportFileReport: {e}"));
    inventory_backend::cloud::intake::po::PoImportHealth::export_all(&config)
        .unwrap_or_else(|e| panic!("PoImportHealth: {e}"));
    inventory_backend::cloud::intake::po::draft::PoImportDraft::export_all(&config)
        .unwrap_or_else(|e| panic!("PoImportDraft: {e}"));

    // ── The types the generator had stopped writing ────────────────────────
    //
    // A type NOT named here is not written (see the note at the top), so when
    // these names left the list their files stayed on disk with nothing
    // regenerating them — still exported by the barrel, still imported by live
    // screens (`frontend-store-new`'s inbound screens read `StoreInbound*`, the
    // hub's organisation screen reads `UnitView`). A field added to one of
    // these structs would have reached no browser at all, silently, which is
    // the failure this file exists to prevent. Every one of them is still a
    // struct the server serialises, so every one belongs back in the list.

    inventory_backend::cloud::domain::OpeningPriceBasis::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningPriceBasis: {e}"));
    inventory_backend::cloud::domain::OpeningReconciliation::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningReconciliation: {e}"));
    inventory_backend::cloud::domain::OpeningUnitTotal::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningUnitTotal: {e}"));
    inventory_backend::cloud::domain::PaymentPattern::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentPattern: {e}"));
    inventory_backend::cloud::postgres::CloseTenderReconRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CloseTenderReconRequest: {e}"));
    inventory_backend::cloud::postgres::CreatePaymentBatchRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("CreatePaymentBatchRequest: {e}"));
    inventory_backend::cloud::postgres::ExecutePaymentBatchItemRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("ExecutePaymentBatchItemRequest: {e}"));
    inventory_backend::cloud::postgres::OpenTenderReconRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("OpenTenderReconRequest: {e}"));
    inventory_backend::cloud::postgres::OpeningBalanceOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningBalanceOutcome: {e}"));
    inventory_backend::cloud::postgres::OpeningCutoverReport::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningCutoverReport: {e}"));
    inventory_backend::cloud::postgres::OpeningEquation::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningEquation: {e}"));
    inventory_backend::cloud::postgres::OpeningFallback::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningFallback: {e}"));
    inventory_backend::cloud::postgres::OpeningPostedEntry::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningPostedEntry: {e}"));
    inventory_backend::cloud::postgres::OpeningStockOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningStockOutcome: {e}"));
    inventory_backend::cloud::postgres::OpeningStockUnit::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningStockUnit: {e}"));
    inventory_backend::cloud::postgres::OpeningSubledgerOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningSubledgerOutcome: {e}"));
    inventory_backend::cloud::postgres::OpeningUnmapped::export_all(&config)
        .unwrap_or_else(|e| panic!("OpeningUnmapped: {e}"));
    inventory_backend::cloud::postgres::PaymentBatchDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentBatchDetail: {e}"));
    inventory_backend::cloud::postgres::PaymentBatchEventRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentBatchEventRow: {e}"));
    inventory_backend::cloud::postgres::PaymentBatchItemInput::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentBatchItemInput: {e}"));
    inventory_backend::cloud::postgres::PaymentBatchItemRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentBatchItemRow: {e}"));
    inventory_backend::cloud::postgres::PaymentBatchRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentBatchRow: {e}"));
    inventory_backend::cloud::postgres::PaymentBatchRunOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentBatchRunOutcome: {e}"));
    inventory_backend::cloud::postgres::PaymentContext::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentContext: {e}"));
    inventory_backend::cloud::postgres::PaymentContextParty::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentContextParty: {e}"));
    inventory_backend::cloud::postgres::PaymentDestinationRow::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentDestinationRow: {e}"));
    inventory_backend::cloud::postgres::PaymentObligation::export_all(&config)
        .unwrap_or_else(|e| panic!("PaymentObligation: {e}"));
    inventory_backend::cloud::postgres::RecordTenderBatchRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordTenderBatchRequest: {e}"));
    inventory_backend::cloud::postgres::RecordTenderDecisionRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("RecordTenderDecisionRequest: {e}"));
    inventory_backend::cloud::postgres::TenderBatchLineInput::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderBatchLineInput: {e}"));
    inventory_backend::cloud::postgres::TenderBatchLineRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderBatchLineRow: {e}"));
    inventory_backend::cloud::postgres::TenderDecisionOutcome::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderDecisionOutcome: {e}"));
    inventory_backend::cloud::postgres::TenderDecisionRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderDecisionRow: {e}"));
    inventory_backend::cloud::postgres::TenderReceiptRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderReceiptRow: {e}"));
    inventory_backend::cloud::postgres::TenderReconDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderReconDetail: {e}"));
    inventory_backend::cloud::postgres::TenderReconciliationRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderReconciliationRow: {e}"));
    inventory_backend::cloud::postgres::TenderSuggestionRow::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderSuggestionRow: {e}"));
    inventory_backend::cloud::postgres::TenderSuggestionsView::export_all(&config)
        .unwrap_or_else(|e| panic!("TenderSuggestionsView: {e}"));
    inventory_backend::cloud::postgres::UnexplainedReceiptRow::export_all(&config)
        .unwrap_or_else(|e| panic!("UnexplainedReceiptRow: {e}"));
    inventory_backend::cloud::postgres::UnitPic::export_all(&config)
        .unwrap_or_else(|e| panic!("UnitPic: {e}"));
    inventory_backend::cloud::postgres::UnitSite::export_all(&config)
        .unwrap_or_else(|e| panic!("UnitSite: {e}"));
    inventory_backend::cloud::postgres::UnitView::export_all(&config)
        .unwrap_or_else(|e| panic!("UnitView: {e}"));
    inventory_backend::edge::flows::FlowNotice::export_all(&config)
        .unwrap_or_else(|e| panic!("FlowNotice: {e}"));
    inventory_backend::edge::flows::FlowNoticeEvent::export_all(&config)
        .unwrap_or_else(|e| panic!("FlowNoticeEvent: {e}"));
    inventory_backend::edge::flows::FlowNoticeList::export_all(&config)
        .unwrap_or_else(|e| panic!("FlowNoticeList: {e}"));
    inventory_backend::edge::flows::InspectReturnRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("InspectReturnRequest: {e}"));
    inventory_backend::edge::flows::InspectReturnResult::export_all(&config)
        .unwrap_or_else(|e| panic!("InspectReturnResult: {e}"));
    inventory_backend::edge::flows::ReturnInspectionDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("ReturnInspectionDetail: {e}"));
    inventory_backend::edge::flows::ReturnInspectionList::export_all(&config)
        .unwrap_or_else(|e| panic!("ReturnInspectionList: {e}"));
    inventory_backend::edge::flows::ReturnToInspect::export_all(&config)
        .unwrap_or_else(|e| panic!("ReturnToInspect: {e}"));
    inventory_backend::edge::flows::ReturnUnitToInspect::export_all(&config)
        .unwrap_or_else(|e| panic!("ReturnUnitToInspect: {e}"));
    inventory_backend::edge::inbound::StoreInboundDelivery::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreInboundDelivery: {e}"));
    inventory_backend::edge::inbound::StoreInboundDetail::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreInboundDetail: {e}"));
    inventory_backend::edge::inbound::StoreInboundLine::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreInboundLine: {e}"));
    inventory_backend::edge::inbound::StoreInboundList::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreInboundList: {e}"));
    inventory_backend::edge::inbound::StoreInboundReceiveRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreInboundReceiveRequest: {e}"));
    inventory_backend::edge::inbound::StoreInboundResult::export_all(&config)
        .unwrap_or_else(|e| panic!("StoreInboundResult: {e}"));
    inventory_backend::edge::till::TillApproval::export_all(&config)
        .unwrap_or_else(|e| panic!("TillApproval: {e}"));
    inventory_backend::edge::till::TillApprovalRequest::export_all(&config)
        .unwrap_or_else(|e| panic!("TillApprovalRequest: {e}"));
}
