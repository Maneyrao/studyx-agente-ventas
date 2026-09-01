/**
 * Structured resolution of the canonical prompt's identity variables.
 *
 * The canonical sales behavior is authored once and never summarized or
 * rewritten. What it does declare are `{{ }}` slots, and those fall in two
 * different categories that must not be treated alike:
 *
 * - **Identity** — who the agent is and where the academy lives. Stable,
 *   deployment-wide, and owned by configuration. Shipping these unresolved is
 *   what leaves the model without a name of its own.
 * - **Behavioural slots** — `{{nombre}}`, `{{CURSO}}`, `{{X}}` and the rest.
 *   These are per-turn values the model fills from `authorized_context`, or
 *   illustrative gaps inside behavioural examples. Substituting them here
 *   would turn an example into an assertion, so this resolver never touches
 *   them: commercial facts stay owned by the canonical catalog.
 *
 * Resolution is verified, not assumed: `unresolved` names every identity
 * variable configuration failed to supply, so a deploy-time check can fail
 * loudly instead of silently sending `{{NOMBRE_ASESOR}}` to a customer.
 */

export const AGENT_A_IDENTITY_VARIABLES_V1 = [
  'NOMBRE_ASESOR',
  'NOMBRE_ACADEMIA',
  'ACADEMIA',
  'WEB',
  'IG',
] as const

export type AgentAIdentityVariableV1 = typeof AGENT_A_IDENTITY_VARIABLES_V1[number]

export interface AgentAIdentityV1 {
  readonly advisor_name: string
  readonly academy_name: string
  readonly website: string | null
  readonly instagram: string | null
}

function identityValues(identity: AgentAIdentityV1): Record<AgentAIdentityVariableV1, string | null> {
  return {
    NOMBRE_ASESOR: identity.advisor_name,
    NOMBRE_ACADEMIA: identity.academy_name,
    ACADEMIA: identity.academy_name,
    WEB: identity.website,
    IG: identity.instagram,
  }
}

export function resolveCanonicalPromptIdentityV1(
  prompt: string,
  identity: AgentAIdentityV1,
): { readonly prompt: string; readonly unresolved: readonly AgentAIdentityVariableV1[] } {
  const values = identityValues(identity)
  let resolved = prompt
  const unresolved: AgentAIdentityVariableV1[] = []
  for (const variable of AGENT_A_IDENTITY_VARIABLES_V1) {
    const token = `{{${variable}}}`
    const value = values[variable]?.trim()
    if (!value) {
      if (resolved.includes(token)) unresolved.push(variable)
      continue
    }
    resolved = resolved.split(token).join(value)
  }
  return { prompt: resolved, unresolved }
}

function trimmed(value: string | undefined): string | null {
  const candidate = value?.trim()
  return candidate ? candidate : null
}

/**
 * Reads the agent's stable identity from configuration. Returns null when the
 * two mandatory fields are absent so the caller keeps the canonical prompt
 * verbatim rather than inventing a name.
 */
export function loadAgentAIdentityV1(
  environment: Record<string, string | undefined>,
): AgentAIdentityV1 | null {
  const advisor_name = trimmed(environment.AGENT_A_ADVISOR_NAME)
  const academy_name = trimmed(environment.AGENT_A_ACADEMY_NAME)
  if (!advisor_name || !academy_name) return null
  return {
    advisor_name,
    academy_name,
    website: trimmed(environment.AGENT_A_WEBSITE),
    instagram: trimmed(environment.AGENT_A_INSTAGRAM),
  }
}
