//! Shared builders for the time-machine tests.
//!
//! Every test needs a log, and a log written out event by event is unreadable.
//! These helpers keep the tests about the property being checked rather than
//! about `DateTime` construction.

#![allow(dead_code)]

use chrono::{DateTime, TimeZone, Utc};
use inventory_time_machine::{Event, EventKind, Payload, StateSource, Timeline};

/// A fixed instant. Nothing in the crate orders by time, so one is enough —
/// and a constant makes it obvious that time is not an input to any result.
pub fn at(seq: u64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap() + chrono::Duration::seconds(seq as i64)
}

pub fn receive(seq: u64, subject: &str, node: &str, quantity: i64) -> Event {
    Event::new(seq, at(seq), subject, EventKind::Receive).with_payload(Payload {
        location: Some(node.to_owned()),
        quantity_delta: Some(quantity),
        ..Payload::default()
    })
}

pub fn move_to(seq: u64, subject: &str, node: &str) -> Event {
    Event::new(seq, at(seq), subject, EventKind::Move).with_payload(Payload {
        location: Some(node.to_owned()),
        ..Payload::default()
    })
}

pub fn transfer(seq: u64, subject: &str, from: &str, to: &str) -> Event {
    Event::new(seq, at(seq), subject, EventKind::CustodyTransfer).with_payload(Payload {
        location: Some(to.to_owned()),
        custody: Some(to.to_owned()),
        from_custody: Some(from.to_owned()),
        ..Payload::default()
    })
}

pub fn adjust(seq: u64, subject: &str, delta: i64) -> Event {
    Event::new(seq, at(seq), subject, EventKind::Adjust).with_payload(Payload {
        quantity_delta: Some(delta),
        ..Payload::default()
    })
}

pub fn count(seq: u64, subject: &str, node: &str, quantity: i64) -> Event {
    Event::new(seq, at(seq), subject, EventKind::CountObserved).with_payload(Payload {
        location: Some(node.to_owned()),
        observed_quantity: Some(quantity),
        ..Payload::default()
    })
}

pub fn dispatch(seq: u64, subject: &str, from: &str, carrier: &str) -> Event {
    Event::new(seq, at(seq), subject, EventKind::Dispatch).with_payload(Payload {
        location: Some(from.to_owned()),
        custody: Some(carrier.to_owned()),
        from_custody: Some(from.to_owned()),
        ..Payload::default()
    })
}

pub fn timeline(source: StateSource, events: Vec<Event>) -> Timeline {
    Timeline::build_with_interval(source, events, 4).expect("well-ordered log")
}
