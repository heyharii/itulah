//! Flows of goods as templates: the owner's decision of 27 Sep.
//!
//! Three layers, and which one owns what:
//!
//! * **The stage catalogue** ([`stage`]) is code. Pick, pack, close koli
//!   (KOLI), ship (the surat jalan, SJ, one per destination), load (onto a
//!   dispatch, DSP), depart, receive, inspect, ready for pickup, handover with
//!   proof, approval; and the receiving stages arrival, blind count,
//!   verification, tagging, putaway. Each carries its meaning, the movements
//!   and claims it emits, the journal MEANING it books when units are
//!   crossed, the proof it demands and the rules nobody can switch off.
//! * **The flow template** ([`template`]) is data an Admin edits: a route, an
//!   ordered choice of stages, who starts it, who performs each stage, proof,
//!   deadlines, what may be skipped, and the destination pool role. Saved in
//!   versions; checked against invariants that hold whatever it says.
//! * **The flow document** ([`document`], [`action`]) is one run of one
//!   template version, born from the source document it runs — an allotment
//!   (MD's plan) for every outbound route, a purchase order or delivery for a
//!   supplier's goods; a plan is never a stage. It is an ordered list of
//!   typed actions, each registered with `validate` and `apply`, replayed in
//!   memory for a preview and written once on confirm — one stage per
//!   database transaction, no sagas.
//!
//! Glossary: `CONTEXT.md`, "Flow templates". The allotment's own arithmetic
//! (`docs/allotment-v1.md`) is untouched by this: a flow drives the stages an
//! allotment is counted through, and receive's fixed rules are the allotment's
//! (ALT-INV-06/07, ALT-D01..D03) restated as code every template inherits.
//!
//! Pure: no clock, no database. `postgres::flows` stores it and
//! `http::flows` serves it.

mod action;
mod document;
mod stage;
mod template;

pub use action::*;
pub use document::*;
pub use stage::*;
pub use template::*;
