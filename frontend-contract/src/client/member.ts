import type {
  CustomerSummary,
  CustomerTransactionDetail,
  CustomerTransactionPage,
  IssuedPairingCode,
  MemberIdentity,
  MemberSessionResponse,
  RedeemRequest,
  SentOtp,
} from "../index";
import { Node } from "./node";

/// The shopper's own surface, and the counter act that opens it.
///
/// Everything here is scoped by the member's session rather than by an id in
/// the URL. That is the whole difference from the `/api/v1/customer/{id}/…`
/// routes, which still exist and are still right — for a shop looking a
/// receipt up on somebody's behalf. What was wrong was those being the *only*
/// way, so that a shopper's own app had to borrow an operator's password to
/// read the shopper's own points, and anyone holding one could read anybody's.
///
/// # How a phone becomes paired
///
/// Not by a one-time code sent to a phone number. The question this surface
/// has to answer is "does this person hold that card", and in this market a
/// phone number is poor evidence of it: prepaid numbers are changed often and
/// operators recycle them after roughly 60–90 days, so whoever is issued a
/// recycled number would inherit the previous holder's history. A code read
/// out by a cashier proves the card is in the person's hand, in the shop,
/// checked by an employee — and costs nothing to deliver.
///
///   1. the cashier calls [`Member.issuePairingCode`] with the card in front
///      of them, and reads the six digits off their screen;
///   2. the shopper types their member number and those digits into
///      [`Member.pair`], which sets the session cookies.
///
/// Or, since 25 Oct 2026 (the owner's call), by a code on WhatsApp: the
/// shopper types the number they registered at a till, [`Member.sendCode`]
/// sends six digits to its WhatsApp, and [`Member.signInByCode`] trades them
/// for the same session. Nobody signs up in the app: members are registered
/// at a till.
export class Member {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  // ── the counter (operator session) ───────────────────────────────────────

  /// Enrol a card. Idempotent on the member number, because that number is
  /// printed on something a person is already holding.
  enrol(
    memberId: string,
    displayName?: string,
    signal?: AbortSignal,
  ): Promise<MemberIdentity> {
    return this.node.post<MemberIdentity>(
      "/api/v1/members",
      { member_id: memberId, display_name: displayName ?? null },
      { signal },
    );
  }

  /// Issue the six digits the cashier reads out.
  ///
  /// The plaintext code is in this response and nowhere else — the server
  /// keeps only a hash. A code lost before the customer types it is replaced,
  /// not looked up.
  issuePairingCode(
    memberId: string,
    signal?: AbortSignal,
  ): Promise<IssuedPairingCode> {
    return this.node.post<IssuedPairingCode>(
      `/api/v1/members/${encodeURIComponent(memberId)}/pairing-code`,
      {},
      { signal },
    );
  }

  // ── the shopper (member session) ─────────────────────────────────────────

  /// Trade a card number and the cashier's code for a session.
  ///
  /// Nothing is returned to store. The cookies this response sets are what
  /// authorise the next request, and one of them is `HttpOnly` precisely so
  /// that no script — ours or anybody else's — can read it back out.
  ///
  /// Every failure answers the same way, on purpose: an unknown card, a wrong
  /// code, an expired one and one guessed at too many times are one sentence
  /// and one status, so this form cannot be used to discover which numbers are
  /// members.
  pair(
    memberId: string,
    code: string,
    signal?: AbortSignal,
  ): Promise<MemberSessionResponse> {
    return this.node.post<MemberSessionResponse>(
      "/api/v1/member/session",
      { member_id: memberId, code },
      { signal },
    );
  }

  /// Send a sign-in code to a member's WhatsApp. A number that is no member
  /// is refused (404): members are registered at a till.
  sendCode(phone: string, signal?: AbortSignal): Promise<SentOtp> {
    return this.node.post<SentOtp>(
      "/api/v1/member/otp",
      { phone },
      { signal },
    );
  }

  /// Trade the number and the code its WhatsApp received for a session.
  signInByCode(
    challengeId: string,
    phone: string,
    code: string,
    signal?: AbortSignal,
  ): Promise<MemberSessionResponse> {
    return this.node.post<MemberSessionResponse>(
      "/api/v1/member/session/otp",
      { challenge_id: challengeId, phone, code },
      { signal },
    );
  }

  me(signal?: AbortSignal): Promise<MemberIdentity> {
    return this.node.get<MemberIdentity>("/api/v1/member/me", { signal });
  }

  async signOut(signal?: AbortSignal): Promise<void> {
    await this.node.post("/api/v1/member/logout", {}, { signal });
  }

  summary(signal?: AbortSignal): Promise<CustomerSummary> {
    return this.node.get<CustomerSummary>("/api/v1/member/summary", { signal });
  }

  /// Where a page of history starts. Both cursor fields travel together or not
  /// at all — the server refuses half a cursor rather than silently rewinding
  /// to the newest page, which would loop forever.
  transactions(
    options: {
      limit?: number;
      cursor?: {
        readonly before_occurred_at: string;
        readonly before_sale_id: string;
      };
      signal?: AbortSignal;
    } = {},
  ): Promise<CustomerTransactionPage> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) {
      query.set("limit", String(options.limit));
    }
    if (options.cursor !== undefined) {
      query.set("before_occurred_at", options.cursor.before_occurred_at);
      query.set("before_sale_id", options.cursor.before_sale_id);
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.node.get<CustomerTransactionPage>(
      `/api/v1/member/transactions${suffix}`,
      { signal: options.signal },
    );
  }

  transaction(
    saleId: string,
    signal?: AbortSignal,
  ): Promise<CustomerTransactionDetail> {
    return this.node.get<CustomerTransactionDetail>(
      `/api/v1/member/transactions/${encodeURIComponent(saleId)}`,
      { signal },
    );
  }

  // ── the shopper's points ──────────────────────────────────────────────

  /// Approve a cashier's ask to spend points: they are spent at once, and the
  /// till waiting on it finds the voucher.
  approveRedeemRequest(
    requestId: string,
    signal?: AbortSignal,
  ): Promise<RedeemRequest> {
    return this.node.post<RedeemRequest>(
      `/api/v1/member/points/redeem-requests/${encodeURIComponent(requestId)}/approve`,
      {},
      { signal },
    );
  }

  /// Turn a cashier's ask down.
  declineRedeemRequest(
    requestId: string,
    signal?: AbortSignal,
  ): Promise<RedeemRequest> {
    return this.node.post<RedeemRequest>(
      `/api/v1/member/points/redeem-requests/${encodeURIComponent(requestId)}/decline`,
      {},
      { signal },
    );
  }

  /// The asks to spend this member's points, newest first, and what became
  /// of each.
  redeemRequests(signal?: AbortSignal): Promise<RedeemRequest[]> {
    return this.node.get<RedeemRequest[]>(
      "/api/v1/member/points/redeem-requests",
      { signal },
    );
  }
}
