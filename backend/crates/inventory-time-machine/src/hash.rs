//! State hashing.
//!
//! Two worlds are compared by hash before they are compared field by field:
//! the hash is one 32-byte comparison instead of a walk over every subject,
//! and it is the thing a checkpoint can carry across a process boundary.
//!
//! The encoding is length-prefixed and explicitly domain-separated. Without
//! that, `location = "A"` / `custody = "B"` and `location = "AB"` /
//! `custody = ""` would hash alike, which is precisely the kind of collision
//! a divergence hunt must not have.

use crate::model::{SubjectId, SubjectState, WorldState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

/// A 32-byte digest that serialises as lowercase hex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct StateHash(pub [u8; 32]);

impl StateHash {
    pub fn to_hex(self) -> String {
        hex::encode(self.0)
    }

    /// The digest of an empty world. Distinct from any non-empty one because
    /// the domain tag is hashed even when there is nothing else to hash.
    pub fn empty_world() -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"itm.world.v1");
        hasher.update(0u64.to_be_bytes());
        StateHash(hasher.finalize().into())
    }
}

impl fmt::Display for StateHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl Serialize for StateHash {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for StateHash {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let hex_text = String::deserialize(deserializer)?;
        let bytes = hex::decode(&hex_text).map_err(serde::de::Error::custom)?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("state hash must be 32 bytes"))?;
        Ok(StateHash(bytes))
    }
}

fn absorb(hasher: &mut Sha256, field: &[u8]) {
    hasher.update((field.len() as u64).to_be_bytes());
    hasher.update(field);
}

fn absorb_opt(hasher: &mut Sha256, field: Option<&str>) {
    match field {
        Some(value) => {
            hasher.update([1u8]);
            absorb(hasher, value.as_bytes());
        }
        None => hasher.update([0u8]),
    }
}

/// Hash one subject's state. `last_seq` is deliberately excluded: two sources
/// can reach an identical world by logs of different lengths, and "how you got
/// here" is the causal chain's job, not the state hash's.
pub fn hash_subject(state: &SubjectState) -> StateHash {
    let mut hasher = Sha256::new();
    hasher.update(b"itm.subject.v1");
    absorb(&mut hasher, state.subject.as_str().as_bytes());
    absorb_opt(&mut hasher, state.location.as_deref());
    absorb_opt(&mut hasher, state.custody.as_deref());
    hasher.update(state.quantity.to_be_bytes());
    absorb(&mut hasher, state.status.to_string().as_bytes());
    hasher.update(state.version.to_be_bytes());
    StateHash(hasher.finalize().into())
}

/// Combine subject hashes into one world hash, Merkle-style.
///
/// Leaves are `H(subject_id || subject_hash)` so a subject cannot be renamed
/// without changing the root, and an odd node is promoted rather than doubled
/// (doubling makes a two-leaf tree collide with a three-leaf one whose last
/// leaf repeats).
pub fn hash_world(world: &WorldState) -> StateHash {
    let mut leaves: Vec<[u8; 32]> = world
        .subjects
        .iter()
        .map(|(id, state)| {
            let mut hasher = Sha256::new();
            hasher.update(b"itm.leaf.v1");
            absorb(&mut hasher, id.as_str().as_bytes());
            hasher.update(hash_subject(state).0);
            hasher.finalize().into()
        })
        .collect();

    if leaves.is_empty() {
        return StateHash::empty_world();
    }

    while leaves.len() > 1 {
        let mut next = Vec::with_capacity(leaves.len().div_ceil(2));
        for pair in leaves.chunks(2) {
            if pair.len() == 1 {
                next.push(pair[0]);
                continue;
            }
            let mut hasher = Sha256::new();
            hasher.update(b"itm.node.v1");
            hasher.update(pair[0]);
            hasher.update(pair[1]);
            next.push(hasher.finalize().into());
        }
        leaves = next;
    }

    let mut hasher = Sha256::new();
    hasher.update(b"itm.world.v1");
    hasher.update((world.subjects.len() as u64).to_be_bytes());
    hasher.update(leaves[0]);
    StateHash(hasher.finalize().into())
}

/// Per-subject hashes of a whole world, for pinpointing *which* subject moved
/// the root without diffing every field.
pub fn subject_hashes(world: &WorldState) -> Vec<(SubjectId, StateHash)> {
    world
        .subjects
        .iter()
        .map(|(id, state)| (id.clone(), hash_subject(state)))
        .collect()
}
