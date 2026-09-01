/** Runtime shape checks for identity responses before they become session state. */

import { z } from "zod"

/**
 * The identity service has two compatible login envelopes: cloud returns
 * `access_token` (plus cookie), while store-router historically returns
 * `token`. Both may also return a two-factor challenge. The fields are kept
 * permissive here because older deployments add claims over time; the service
 * performs the required token/user/challenge invariants after this envelope
 * check.
 */
const nonEmptyString = z.string().trim().min(1)
const numericSeconds = z.union([
  z.number().finite(),
  z.string().trim().regex(/^\d+(?:\.\d+)?$/),
])
const audience = z.union([nonEmptyString, z.array(nonEmptyString).min(1)])
const scope = z.union([z.string(), z.array(z.string())])

/**
 * Known fields are checked at the boundary while `.passthrough()` keeps the
 * contract forward-compatible with additive claims from identity. Endpoint
 * invariants (for example, a login must include a token and user) remain in
 * `AuthService`, because `/me` legitimately has neither field.
 */
export const AuthResponseEnvelope = z
  .object({
    access_token: nonEmptyString.optional(),
    token: nonEmptyString.optional(),
    refresh_token: nonEmptyString.optional(),
    token_type: nonEmptyString.optional(),
    expires_in: numericSeconds.optional(),
    user: z.object({}).passthrough().optional(),
    requires_2fa: z.boolean().optional(),
    temp_token: nonEmptyString.optional(),
    message: z.string().optional(),
    aud: audience.optional(),
    audience: audience.optional(),
    realm: z.enum(["cloud", "store", "edge"]).optional(),
    principal_type: z
      .enum(["workforce", "customer", "device", "service"])
      .optional(),
    token_use: z.enum(["access", "refresh", "id"]).optional(),
    subject_id: nonEmptyString.optional(),
    entity_id: nonEmptyString.optional(),
    scope: scope.optional(),
  })
  .passthrough()

export type AuthResponseEnvelope = z.infer<typeof AuthResponseEnvelope>
