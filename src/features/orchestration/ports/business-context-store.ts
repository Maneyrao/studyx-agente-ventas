import type {
  BusinessContextLimits,
  RawCatalogIndex,
  RawBusinessContext,
} from '../domain/business-context';

/**
 * Loads the canonical business context for one workspace slug.
 *
 * The slug always comes from backend configuration
 * (BUSINESS_WORKSPACE_SLUG) — never from model output, a request body, or
 * anything else a customer can influence. Returns null when the workspace
 * does not exist, which callers must treat as "no business context", not as
 * permission to fall back to another tenant's data.
 */
/** Full identity index: all active offerings, but no prompt-sized details. */
export interface CatalogIndexStore {
  loadCompleteIndex(workspaceSlug: string): Promise<RawCatalogIndex | null>;
}

/** One canonical offering detail, tenant-scoped by the configured workspace. */
export interface CatalogDetailStore {
  loadByCode(workspaceSlug: string, code: string): Promise<RawBusinessContext | null>;
}

export interface BusinessContextStore extends CatalogIndexStore, CatalogDetailStore {
  loadBusinessContext(
    workspaceSlug: string,
    limits?: BusinessContextLimits
  ): Promise<RawBusinessContext | null>;

  /** Offering-only snapshot for standalone catalog callers. */
  loadBusinessCatalog(
    workspaceSlug: string,
    limits?: Pick<BusinessContextLimits, 'maxOfferings'>
  ): Promise<RawBusinessContext | null>;
}
