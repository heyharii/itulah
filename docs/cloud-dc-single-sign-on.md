# Cloud to DC single sign-on

The hub exchanges a Cloud session for a short-lived DC session when an operator
opens Operations. Cloud signs a ticket for one DC and the DC redeems it once,
then creates its normal local session from the current Cloud user projection.
The ticket carries no role, password, Cloud cookie, or Cloud session token.

## Configure Cloud signing

Set `INVENTORY_SSO_SIGNING_KEY_HEX` on Cloud to a generated 32-byte hex seed.
For example, `openssl rand -hex 32` prints a suitable value. Store it in the
Cloud secret manager and keep it stable across restarts. Never copy the private
seed to a DC.

After first configuring or rotating the key, publish an auth policy for each DC
so it receives the matching public key through the existing signed command
lane. Until that policy is applied, the hub falls back to the local DC login.
Subsequent policy publications include the public key automatically.

Only users with an active Cloud account and an active assignment to that DC can
exchange sessions. The Edge still checks its own user lease and chooses the
role from its local policy, so an expired policy lease or an offline Cloud
connection does not grant new sessions. A DC with a valid existing session can
continue operating offline; its local recovery accounts remain available.

## No DC password by default

A DC grant needs no password of its own. Granting access at a DC without one
stores `security::SSO_ONLY_VERIFIER` as the verifier: an unparseable value
that no password typed at the node matches, so that person can reach the DC
only through this exchange. Set an offline password only for somebody who must
sign in while the DC cannot reach Cloud. A store grant still needs a password,
because stores have no exchange. On an existing grant, leaving the password
empty keeps the one it has, so changing a role never removes it.

The hub never asks for a DC password in the normal path. When a DC session
lapses (idle timeout, node restart), the first 401 drops the DC token
(`main.tsx`, `Node.onBearerRejected`) and the Operations gate exchanges the
Cloud session again. Local recovery accounts are behind "Use a local recovery
account" on the gate, shown only when automatic sign-in fails.
