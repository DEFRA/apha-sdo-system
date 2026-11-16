import { config } from '#/config/config.js'
import { AUTH_PROVIDERS } from '#/server/auth/auth-constants.js'
import { labNameOf } from '#/server/auth/report-access.js'

/**
 * Who submitted and for which lab, as every submission.json records them
 * (reports and diagnostic tests alike).
 *
 * `organisationId` and `organisationName` are both the lab's name: the name
 * Customer Identity gives the organisation the user signed in for, or, for
 * an internal user, the name of the lab in their Entra role. Only Customer
 * Identity identifies the lab itself, so only an external user's record has
 * an `organisationUniqueId`. The session user keeps its own `organisationId`
 * (the Entra lab code or Customer Identity organisation ID), which keys the
 * lab's saved reports, submission history and diagnostic tests.
 * @param {{ provider?: string, id?: string, email?: string, organisationId?: string | null, organisationName?: string | null } | null} [user] - the session user
 * @param {{ labNames?: string[] }} [options] - configured lab names, see labNameOf
 */
export function submissionIdentity(
  user,
  { labNames = config.get('auth.entraId.labNames') } = {}
) {
  const isDefraId = user?.provider === AUTH_PROVIDERS.DEFRA_ID
  const labName = isDefraId
    ? user.organisationName || null
    : labNameOf(user?.organisationId, labNames)

  return {
    userId: user?.id ?? null,
    userEmail: user?.email || null,
    organisationId: labName,
    organisationName: labName,
    ...(isDefraId && user.organisationId
      ? { organisationUniqueId: user.organisationId }
      : {})
  }
}
