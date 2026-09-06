//! The step before the first upload: agreeing whose seqs these are.
//!
//! # The failure this exists to stop
//!
//! A till's SQLite file is restored from last week's backup, or replaced
//! empty and re-provisioned. It keeps its `origin_id` — that is the whole
//! point of an origin — and starts allocating seqs from one again. The cloud
//! is already durable through 5,000 for that origin, so every fact the shop
//! writes that evening arrives with a seq the receiver considers a duplicate.
//! The receiver answers "durable through 5,000", the sender treats that as
//! acknowledgement, advances its watermark and purges. Nothing errors. The
//! dashboard is green. A day of sales exists nowhere.
//!
//! [`crate::cloud::domain::sync_generation`] holds the decision; this holds
//! the exchange. A sender asks where it stands, the receiver decides, and the
//! sender adopts the answer before it is allowed to upload anything.
//!
//! # Why the receiver decides
//!
//! The receiver is the only party that knows its own watermark, and the
//! restored sender is by definition the party whose memory is wrong. Letting
//! the sender pick would mean trusting the number that is already known to be
//! stale. The sender's one veto is stated in [`negotiate_generation`]: it
//! refuses an answer that would move it BACKWARDS, because a receiver naming a
//! generation below the sender's own is either confused or not the receiver
//! this node was talking to yesterday.
//!
//! # Why "do not send" is the right answer to an unreachable cloud
//!
//! A node that cannot negotiate keeps capturing — `enqueue_fact` never
//! consults any of this — and keeps its backlog durable. It simply does not
//! upload. That costs a shop nothing it was not already going to pay while the
//! link was down, and it removes the one window in which a re-provisioned node
//! could push a day of sales into seqs the cloud will discard.

use crate::cloud::domain::{HandshakeAgreement, HandshakeRequest, LocalStream};
use crate::sync::port::{SyncError, SyncTransport};
use async_trait::async_trait;

/// The storage a node needs for the handshake, and nothing else.
///
/// Separate from [`crate::sync::SyncStore`] because only a node that can be
/// restored underneath its own identity needs it. The cloud sender implements
/// `SyncStore` and not this: nobody re-provisions a Postgres cluster and
/// expects it to keep counting from one.
#[async_trait]
pub trait GenerationStore: Send + Sync {
    /// `(origin_id, stream)`, or `None` on a node that was never provisioned.
    async fn local_stream(&self) -> Result<Option<(String, LocalStream)>, SyncError>;

    /// Whether this node has already agreed its generation with the receiver.
    /// False on a database that has never negotiated — which is exactly the
    /// shape a restored one has.
    async fn handshake_settled(&self) -> Result<bool, SyncError>;

    /// Adopt the agreed generation and mark the handshake settled.
    ///
    /// When the generation changes, every fact still waiting to be sent moves
    /// into it. That is not bookkeeping: those facts were captured under a
    /// generation the receiver will discard, so leaving them behind would
    /// abandon the very rows this whole exchange exists to save.
    async fn adopt_generation(&self, generation: i64, note: &str) -> Result<(), SyncError>;

    /// Forget the agreement so the next cycle negotiates again. Called when
    /// the receiver says the stream it is holding is not the one being sent.
    async fn reopen_handshake(&self, reason: &str) -> Result<(), SyncError>;
}

/// What one negotiation did, and whether the sender may now upload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HandshakeReport {
    /// No origin on this node. There is nothing to negotiate and nothing to
    /// send; the cycle will report itself idle.
    NotProvisioned,
    /// Already agreed. The ordinary case, every cycle after the first.
    Settled { generation: i64 },
    /// The receiver confirmed the stream this node was already writing.
    Kept { generation: i64 },
    /// The receiver moved this node above everything it has acknowledged.
    Rotated {
        from: i64,
        to: i64,
        reason: Option<String>,
    },
    /// The receiver could not be asked. Capture continues; nothing uploads.
    Unreachable { error: String },
    /// The receiver answered something a sender must not accept.
    Refused { reason: String },
}

impl HandshakeReport {
    /// Whether the sender may run its upload cycle now.
    ///
    /// `NotProvisioned` is clear on purpose: the cycle's own first act is to
    /// look for an origin and report `Idle` when there is none, and making
    /// that path go through here as well would mean two places deciding what
    /// an unprovisioned node does.
    pub fn clear_to_send(&self) -> bool {
        matches!(
            self,
            Self::NotProvisioned | Self::Settled { .. } | Self::Kept { .. } | Self::Rotated { .. }
        )
    }
}

/// Agree a generation with the receiver, if this node has not already.
///
/// Returns `Ok` for every outcome the sender is expected to live with,
/// including being unable to reach the receiver — that is a condition to wait
/// out, not an error to propagate. `Err` is reserved for storage failing,
/// which is the one thing that means this node cannot be trusted to record
/// what it agreed.
pub async fn negotiate_generation(
    store: &dyn GenerationStore,
    transport: &dyn SyncTransport,
) -> Result<HandshakeReport, SyncError> {
    let Some((origin_id, local)) = store.local_stream().await? else {
        return Ok(HandshakeReport::NotProvisioned);
    };
    if store.handshake_settled().await? {
        return Ok(HandshakeReport::Settled {
            generation: local.generation,
        });
    }
    let request = HandshakeRequest {
        origin_id,
        generation: local.generation,
        next_seq: local.next_seq,
    };
    let agreement = match transport.handshake(&request).await {
        Ok(agreement) => agreement,
        Err(error) => return Ok(HandshakeReport::Unreachable { error }),
    };
    adopt(store, local, agreement).await
}

/// Apply an agreement the sender has been handed.
async fn adopt(
    store: &dyn GenerationStore,
    local: LocalStream,
    agreement: HandshakeAgreement,
) -> Result<HandshakeReport, SyncError> {
    // The sender's one veto. A generation below the one this node is already
    // writing would put its next fact into seqs some earlier incarnation of
    // itself has used, which is the failure this exchange exists to prevent —
    // arriving from the other direction.
    if agreement.generation < local.generation {
        return Ok(HandshakeReport::Refused {
            reason: format!(
                "receiver answered generation {} for a node already writing generation {}; \
                 a handshake may move a stream forward, never back",
                agreement.generation, local.generation
            ),
        });
    }
    if agreement.generation < 1 {
        return Ok(HandshakeReport::Refused {
            reason: format!("receiver answered generation {}", agreement.generation),
        });
    }
    let note = agreement
        .reason
        .clone()
        .unwrap_or_else(|| format!("confirmed at generation {}", agreement.generation));
    store.adopt_generation(agreement.generation, &note).await?;
    if agreement.generation == local.generation {
        Ok(HandshakeReport::Kept {
            generation: agreement.generation,
        })
    } else {
        Ok(HandshakeReport::Rotated {
            from: local.generation,
            to: agreement.generation,
            reason: agreement.reason,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::{IngestBatch, IngestResponse, OriginHorizon};
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorded {
        settled: bool,
        generation: i64,
        adopted: Vec<(i64, String)>,
    }

    struct Store(Mutex<Recorded>);

    impl Store {
        fn new(generation: i64, settled: bool) -> Self {
            Self(Mutex::new(Recorded {
                settled,
                generation,
                adopted: Vec::new(),
            }))
        }
    }

    #[async_trait]
    impl GenerationStore for Store {
        async fn local_stream(&self) -> Result<Option<(String, LocalStream)>, SyncError> {
            let state = self.0.lock().expect("store");
            Ok(Some((
                "store-07-edge".into(),
                LocalStream {
                    generation: state.generation,
                    next_seq: 0,
                },
            )))
        }
        async fn handshake_settled(&self) -> Result<bool, SyncError> {
            Ok(self.0.lock().expect("store").settled)
        }
        async fn adopt_generation(&self, generation: i64, note: &str) -> Result<(), SyncError> {
            let mut state = self.0.lock().expect("store");
            state.generation = generation;
            state.settled = true;
            state.adopted.push((generation, note.to_owned()));
            Ok(())
        }
        async fn reopen_handshake(&self, _reason: &str) -> Result<(), SyncError> {
            self.0.lock().expect("store").settled = false;
            Ok(())
        }
    }

    struct Cloud(Result<HandshakeAgreement, String>);

    #[async_trait]
    impl SyncTransport for Cloud {
        async fn send(&self, _batch: &IngestBatch) -> Result<IngestResponse, String> {
            unreachable!("the handshake never uploads")
        }
        async fn handshake(
            &self,
            _request: &HandshakeRequest,
        ) -> Result<HandshakeAgreement, String> {
            self.0.clone()
        }
    }

    fn agreement(generation: i64, rotated: bool) -> HandshakeAgreement {
        HandshakeAgreement {
            generation,
            rotated,
            reason: rotated.then(|| "restored".to_owned()),
            horizon: OriginHorizon {
                highest_generation: 1,
                durable_through: 5_000,
            },
        }
    }

    #[tokio::test]
    async fn a_settled_node_does_not_ask_again() {
        let store = Store::new(3, true);
        let report = negotiate_generation(&store, &Cloud(Ok(agreement(9, true))))
            .await
            .expect("negotiate");
        assert_eq!(report, HandshakeReport::Settled { generation: 3 });
        assert!(store.0.lock().expect("store").adopted.is_empty());
    }

    #[tokio::test]
    async fn an_unreachable_receiver_leaves_the_sender_gated() {
        let store = Store::new(1, false);
        let report = negotiate_generation(&store, &Cloud(Err("connection refused".into())))
            .await
            .expect("negotiate");
        assert!(
            !report.clear_to_send(),
            "a node that could not ask may not send: {report:?}"
        );
        assert!(
            !store.0.lock().expect("store").settled,
            "nothing was agreed, so nothing may be recorded as agreed"
        );
    }

    #[tokio::test]
    async fn a_restored_node_adopts_the_generation_it_is_given() {
        let store = Store::new(1, false);
        let report = negotiate_generation(&store, &Cloud(Ok(agreement(2, true))))
            .await
            .expect("negotiate");
        assert_eq!(
            report,
            HandshakeReport::Rotated {
                from: 1,
                to: 2,
                reason: Some("restored".into())
            }
        );
        assert!(report.clear_to_send());
        assert_eq!(store.0.lock().expect("store").generation, 2);
    }

    #[tokio::test]
    async fn a_receiver_may_not_move_a_stream_backwards() {
        let store = Store::new(4, false);
        let report = negotiate_generation(&store, &Cloud(Ok(agreement(2, false))))
            .await
            .expect("negotiate");
        assert!(
            matches!(report, HandshakeReport::Refused { .. }),
            "{report:?}"
        );
        assert!(!report.clear_to_send());
        assert!(store.0.lock().expect("store").adopted.is_empty());
    }

    #[tokio::test]
    async fn a_confirmed_stream_is_settled_without_moving() {
        let store = Store::new(4, false);
        let report = negotiate_generation(&store, &Cloud(Ok(agreement(4, false))))
            .await
            .expect("negotiate");
        assert_eq!(report, HandshakeReport::Kept { generation: 4 });
        assert!(store.0.lock().expect("store").settled);
    }
}
