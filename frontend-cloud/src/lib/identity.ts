/// Where `useIdentity` used to live.
///
/// It moved to `lib/session` when `App` stopped keeping the session in a
/// second query of its own: one hook, one key, one fetch of `/auth/me`. The
/// door stays open here because the screens that have to put a name on a
/// decision — closing a line short, answering a price amendment — import it
/// from this path, and the server takes that name as a field rather than
/// reading it from the session, so a decision attributed to whoever typed the
/// nicest name is not an audit trail.
export { useIdentity } from "@/lib/session"
