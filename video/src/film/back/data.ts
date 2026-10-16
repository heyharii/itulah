/* The reversibility film's book: the PO → DC flow of
   reversibility-prototype.html, stage by stage, with its actions, owners
   and "in the app" tags as the prototype has them. Recall is a target rule
   (Not in the app); a locked row carries no tag, so a lock never reads as a
   Recall button that exists. */
import type { Who } from "../../ui/Overlay"
import type { StageView } from "../../ui/howfar"

export const TOKO_CIKUPA: Who = { initials: "C1", role: "Toko", name: "C001 · Cikupa" }
export const TOKO_BUMIAYU: Who = { initials: "C4", role: "Toko", name: "C004 · Bumiayu" }

export const CHAPTERS = ["Four verbs", "PO → DC", "DC → store", "Returns", "Cannot go back"] as const

export const PO_STAGES = [
  "PO form",
  "PO issued",
  "Count in progress",
  "Count submitted",
  "Some lines accepted",
  "Accepted · stock recorded",
  "PO closed",
] as const

/** The first stage past the Point of no return. */
export const PO_BND = 5

export const PO_DOC = { doc: "PO-041026-010", party: "Garmen AA, UD" }

export const COUNTING: StageView = {
  label: "Count in progress",
  back: "yes",
  stays: "The arrival already made stays a fact, however the count form changes.",
  acts: [
    { verb: "Edit", label: "Change what is typed", owner: "Operations" },
    { verb: "Back", label: "Leave the form", owner: "Operations" },
  ],
  next: ["Submit count"],
}

export const SUBMITTED: StageView = {
  label: "Count submitted",
  back: "yes",
  stays: "The old count stays in history. A recall changes no stock.",
  acts: [
    { verb: "Recall", label: "Recall the count", owner: "Counter", app: "new" },
    { verb: "Recount", label: "Ask for a recount", owner: "Reviewer" },
    { verb: "Accept", label: "Accept some lines", owner: "Reviewer" },
    { verb: "Accept", label: "Partial receive", owner: "Reviewer" },
    { verb: "Close", label: "Close short", owner: "Reviewer" },
  ],
  next: [],
}

export const ACCEPTED: StageView = {
  label: "Accepted · stock recorded",
  back: "no",
  stays: "The original count and receipt stay. No movement is deleted.",
  acts: [
    {
      verb: "Recall",
      label: "Recall the count",
      owner: "Counter",
      on: false,
      why: "The count was accepted and stock was recorded.",
      instead: "Add new evidence, or ask Inventory to check.",
    },
    { verb: "Correct", label: "Add a new count as evidence", owner: "Operations" },
    { verb: "Correct", label: "Ask Inventory to check", owner: "Inventory" },
    { verb: "Correct", label: "Return PO for wrong or extra", owner: "Buying" },
    { verb: "Close", label: "Close short the rest of the PO", owner: "Buying", note: "Only the part still open" },
  ],
  next: ["Rest of the order arrives"],
}

/* ── DC → store ─────────────────────────────────────────────────────── */

export const DC_STAGES = [
  "Allotment form",
  "Issued · not picked",
  "Picked",
  "Packed · not in transit",
  "Part sent",
  "In transit",
  "Store counting",
  "Received · Completed",
  "Allotment closed",
] as const
export const DC_BND = 5
export const DC_DOC = { doc: "ALT-00000004", party: "C001 · Cikupa" }

export const DC_PICKED: StageView = {
  label: "Picked",
  back: "yes",
  stays: "The other part can go on. Pieces MD took out go back first and are not asked for again.",
  staysH: 66,
  acts: [
    { verb: "Move back", label: "Move back to the racks", owner: "Operations", app: "built" },
    { verb: "Edit", label: "MD reduces by 30", owner: "MD", app: "built" },
    { verb: "Report", label: "Cannot continue: 5 pcs", owner: "Operations", app: "built" },
  ],
  next: ["Pack"],
}

export const DC_PACKED: StageView = {
  label: "Packed · not in transit",
  back: "yes",
  stays: "A numbered surat jalan is voided and reissued with history, never overwritten.",
  acts: [
    { verb: "Move back", label: "Unpack to Picked", owner: "Operations", app: "built" },
    { verb: "Edit", label: "MD cancels the allotment", owner: "MD", app: "built" },
    { verb: "Correct", label: "Void or reissue the surat jalan", owner: "Operations", app: "design" },
  ],
  next: ["Dispatch all", "Dispatch part (40)"],
}

export const DC_PARTSENT: StageView = {
  label: "Part sent",
  back: "part",
  stays: "Sent stays sent. Only the unsent part can change.",
  acts: [
    { verb: "Move back", label: "Move back the unsent 60", owner: "Operations", app: "built" },
    { verb: "Close", label: "Close remaining 60", owner: "MD", app: "built" },
    {
      verb: "Cancel",
      label: "Cancel the sent 40",
      owner: "MD",
      on: false,
      why: "Sent stays sent.",
      instead: "Count at the store, then a Return or a correction.",
    },
  ],
  next: ["Dispatch the rest"],
}

export const DC_TRANSIT: StageView = {
  label: "In transit",
  back: "no",
  stays: "Sent stays sent. MD can only close or change the part that is not sent.",
  acts: [
    {
      verb: "Move back",
      label: "Move back",
      owner: "Operations",
      on: false,
      why: "Nothing moves back from In transit.",
      instead: "The store counts it, then a Return or a correction document.",
    },
    {
      verb: "Recall",
      label: "Recall the shipment",
      owner: "Operations",
      on: false,
      why: "A shipment is not a count. There is nothing to recall.",
      instead: "Count at the destination.",
    },
  ],
  next: ["Store starts counting"],
}

export const DC_RECEIVING: StageView = {
  label: "Store counting",
  back: "yes",
  stays: "No receipt exists yet from what is typed.",
  acts: [
    { verb: "Edit", label: "Change what is typed", owner: "Store counter" },
    { verb: "Back", label: "Leave the form", owner: "Store counter" },
  ],
  next: ["Submit count"],
}

export const DC_COMPLETED: StageView = {
  label: "Received · Completed",
  back: "no",
  stays: "The delivery is Completed. The first count and the actual quantity both stay.",
  acts: [
    {
      verb: "Recall",
      label: "Recall the receipt",
      owner: "Store counter",
      on: false,
      why: "Store receiving records the receipt at once. There is no review step to recall from.",
      instead: "Recount, or a new correction. Inventory checks the difference.",
      h: 134,
    },
    { verb: "Recount", label: "Recount (asked by Inventory)", owner: "Store counter" },
    { verb: "Correct", label: "Inventory checks the 2 pcs", owner: "Inventory" },
    { verb: "Correct", label: "Return to HO", owner: "MD" },
    { verb: "Correct", label: "New allotment", owner: "MD" },
  ],
  next: ["Close the allotment"],
}

export const DC_DONE: StageView = {
  label: "Allotment closed",
  back: "no",
  stays: "Nothing is reopened or topped up.",
  acts: [
    {
      verb: "Recall",
      label: "Reopen the allotment",
      owner: "MD",
      on: false,
      why: "A finished allotment is not reopened.",
      instead: "Return to HO or a new allotment, if MD decides.",
    },
    { verb: "Correct", label: "Return to HO", owner: "MD" },
    { verb: "Correct", label: "New allotment", owner: "MD" },
  ],
  next: [],
}

/* ── Store return ───────────────────────────────────────────────────── */

export const RET_STAGES = [
  "New return",
  "Requested · not sent",
  "Store prepares",
  "In transit to DC",
  "DC counting",
  "DC receipt · return stock",
  "Return closed",
] as const
export const RET_BND = 3
export const RET_DOC = { doc: "RHO-000012", party: "C004 · Bumiayu" }

export const RET_FORM: StageView = {
  label: "New return",
  back: "yes",
  stays: "The store does not make returns by itself. MD asks.",
  acts: [
    { verb: "Back", label: "Leave the form", owner: "MD" },
    { verb: "Edit", label: "Change the form", owner: "MD" },
  ],
  next: ["Submit return"],
}

export const RET_REQUESTED: StageView = {
  label: "Requested · not sent",
  back: "part",
  stays: "The request and every revision stay in history.",
  acts: [
    { verb: "Edit", label: "Edit the unsent part", owner: "MD", app: "new" },
    { verb: "Cancel", label: "Cancel the unsent part", owner: "MD", app: "new" },
  ],
  next: ["Store prepares"],
}

export const RET_PREPARE: StageView = {
  label: "Store prepares",
  back: "yes",
  stays: "The store needs no picking board.",
  acts: [
    { verb: "Edit", label: "Set the actual quantity: 15", owner: "Store", app: "new" },
    { verb: "Back", label: "Leave without sending", owner: "Store" },
  ],
  next: ["Pack and send 15"],
}

export const RET_TRANSIT: StageView = {
  label: "In transit to DC",
  back: "no",
  stays: "Back or Refresh must not cancel a dispatch.",
  acts: [
    {
      verb: "Move back",
      label: "Cancel the dispatch",
      owner: "Store",
      on: false,
      why: "Pack and send already succeeded.",
      instead: "The DC counts it. A correction or a new return if it was wrong.",
    },
  ],
  next: ["DC starts counting"],
}

export const RET_DCCOUNT: StageView = {
  label: "DC counting",
  back: "yes",
  stays: "The arrival is a fact.",
  acts: [
    { verb: "Edit", label: "Change what is typed", owner: "Operations" },
    { verb: "Back", label: "Leave the form", owner: "Operations" },
  ],
  next: ["Submit count"],
}

export const RET_RECEIVED: StageView = {
  label: "DC receipt · return stock",
  back: "no",
  stays:
    "The count and what was received stay. Asked 20, sent 15, received 15: the receipt is complete, the open 5 is not a receiving shortage.",
  staysH: 66,
  acts: [
    {
      verb: "Recall",
      label: "Recall the receipt",
      owner: "Operations",
      on: false,
      why: "The receipt is recorded as return stock.",
      instead: "Inventory check, recount or a new correction.",
    },
    { verb: "Correct", label: "Inventory check or recount", owner: "Inventory" },
    { verb: "Close", label: "Close the open 5", owner: "MD", app: "new" },
    { verb: "Correct", label: "New allotment from the return stock", owner: "MD" },
  ],
  next: [],
}

/* ── DC → supplier ──────────────────────────────────────────────────── */

export const SUP_STAGES = [
  "Return form",
  "Issued · not picked",
  "Picked · packed",
  "Handed over",
  "Settlement open",
  "Settled or closed",
] as const
export const SUP_BND = 3
export const SUP_DOC = { doc: "RS-00000007", party: "Garmen AA, UD" }

export const SUP_ISSUED: StageView = {
  label: "Issued · not picked",
  back: "yes",
  stays: "Never show a Cancel that only changes a status without freeing the stock and the reservation.",
  staysH: 66,
  acts: [{ verb: "Cancel", label: "Cancel the return", owner: "PO owner", app: "design" }],
  next: ["Pick and pack"],
}

export const SUP_PACKED: StageView = {
  label: "Picked · packed",
  back: "yes",
  stays: "The history of the surat jalan stays.",
  acts: [
    { verb: "Move back", label: "Move back the physical work", owner: "Operations", app: "design" },
    { verb: "Cancel", label: "Cancel the unsent part", owner: "PO owner", app: "design" },
  ],
  next: ["Hand over to the supplier"],
}

export const SUP_HANDED: StageView = {
  label: "Handed over",
  back: "no",
  stays: "Do not claim the goods are still at the DC.",
  acts: [
    {
      verb: "Move back",
      label: "Move back",
      owner: "Operations",
      on: false,
      why: "The supplier already has the goods.",
      instead: "Supplier evidence, a claim, or a new linked correction.",
    },
    { verb: "Correct", label: "Add supplier evidence or a claim", owner: "Buying" },
  ],
  next: ["Open the settlement"],
}

export const SUP_SETTLE: StageView = {
  label: "Settlement open",
  back: "no",
  stays: "The physical return is not reopened. Settlement corrections go in new reversal notes.",
  staysH: 66,
  acts: [
    { verb: "Correct", label: "Replacement", owner: "Buying" },
    { verb: "Correct", label: "Refund", owner: "Buying" },
    { verb: "Correct", label: "Credit note", owner: "Buying" },
    { verb: "Close", label: "Close short the rest owed", owner: "Buying" },
    { verb: "Correct", label: "Replacement arrives", owner: "Operations", note: "Recall only while it waits for acceptance" },
  ],
  next: [],
}

/* ── Tables ─────────────────────────────────────────────────────────── */

export const VERBS = [
  ["Back", "Leaves a screen or a form that is not submitted", "You can always leave. It does not cancel a document that was saved."],
  ["Edit", "A plan or document that still allows it, as a logged revision", "Never changes receipt evidence or a quantity that was sent."],
  ["Recall count", "Pulls back a submission that waits for review", "Only the part not yet accepted, resolved or posted. The old count stays as Recalled and the new one is linked to the same arrival."],
  ["Recount", "Asks for the count to be checked again", "A new count. The old one stays. It is not an overwrite and it cancels no movement."],
  ["Cancel · Close remaining", "Ends a request that has not happened yet", "Does not undo what was sent, or receive what is not there."],
  ["Move back", "Operations reverses physical work before departure", "Picked to To pick, Packed to Picked or To pick. Never from In transit."],
  ["Correction · Return", "A new fact or document that repairs what already happened", "Links to the source. Does not reopen a finished document."],
] as const
export const VERBS_H = [50, 70, 70, 70, 50, 70, 70]
export const THE_RULE =
  "Recall pulls back a count that nobody accepted yet. Once a receipt, stock or a dispatch is recorded, the fix is a new record or a new document. A recalled count stays in history, and a retry after a dropped connection is not a recall and not a second delivery."

export const LOCKED_ROWS = [
  ["A count the reviewer accepted", "Stock was recorded from it.", "A new count or evidence. Inventory checks what differs."],
  ["A receipt that is recorded and moved stock", "The original receipt is evidence.", "A recount or a new correction."],
  ["A shipment In transit", "It left. Sent stays sent.", "Count at the destination, then a Return or a correction."],
  ["A store or DC receipt after Submit", "It became a receipt at once. There is no review step to recall from.", "A recount or a new correction. The first receipt stays."],
  ["A PO, allotment or return that is finished, closed or cancelled", "It is not opened again.", "A new document."],
  ["A loss or stock adjustment that is posted", "It is not deleted.", "A linked correction."],
  ["Goods already handed to the supplier", "They are not at the DC any more.", "Evidence, a claim, a linked correction. An open settlement can still be worked."],
  ["A supplier settlement that is done or closed short", "The closing decision stays.", "A new note that links to it."],
] as const
export const LOCKED_H = [70, 50, 70, 70, 70, 50, 70, 70]
export const PARTLY =
  "The limit applies to the part that was processed. The part that is still pending or unsent can still be recalled, changed or closed, depending on its stage."
