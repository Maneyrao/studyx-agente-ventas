import type { RawBusinessContext } from '../domain/business-context';

/**
 * Loads the canonical business context for one workspace slug.
 *
 * The slug always comes from backend configuration
 * (BUSINESS_WORKSPACE_SLUG) — never from model output, a request body, or
 * anything else a customer can influence. Returns null when the workspace
 * does not exist, which callers must treat as "no business context", not as
 * permission to fall back to another tenant's data.
 */
export interface BusinessContextStore {
  loadBusinessContext(workspaceSlug: string): Promise<RawBusinessContext | null>;
}
