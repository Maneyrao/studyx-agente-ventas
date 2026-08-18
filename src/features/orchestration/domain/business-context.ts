import { sanitizeRetrievedText } from './retrieved-context';

/**
 * Bounded view of one workspace's commercial reality, built from the
 * canonical universal tables (workspaces / offerings / qualification_fields).
 *
 * Price rules are structural, not stylistic:
 * - `price_type = 'fixed'` exposes exactly the canonical `price_amount` and
 *   `currency` columns. No arithmetic, no formatting, no conversion.
 * - `price_type = 'quote'` exposes `price: null` and
 *   `price_assertable: false`; there is no field an amount could ride in, so
 *   the model cannot quote what the backend never gave it.
 * - Every free-text column is authored content and goes through the same
 *   sanitization as any retrieved document before reaching a prompt.
 *
 * The workspace itself is selected by backend configuration
 * (BUSINESS_WORKSPACE_SLUG). Nothing in this module accepts a workspace
 * chosen by model output.
 */

export interface RawWorkspaceRow {
  readonly id: string;
  readonly slug: string;
  readonly display_name: string;
  readonly environment: 'sandbox' | 'staging' | 'production';
  readonly default_locale: string;
  readonly timezone: string;
}

export interface RawOfferingRow {
  readonly code: string;
  readonly display_name: string;
  readonly offering_type: 'service' | 'course' | 'product' | 'subscription';
  readonly description: string;
  readonly value_proposition: string | null;
  readonly price_type: 'fixed' | 'quote' | 'free';
  readonly price_amount: string | null;
  readonly currency: string | null;
  readonly billing_interval: string | null;
  readonly delivery: Record<string, unknown>;
  readonly guardrails: Record<string, unknown>;
}

export interface RawQualificationFieldRow {
  readonly code: string;
  readonly prompt: string;
  readonly response_type: 'boolean' | 'single_select' | 'multi_select' | 'text' | 'number';
  readonly options: unknown[];
  readonly is_required: boolean;
  readonly position: number;
}

export interface RawBusinessContext {
  readonly workspace: RawWorkspaceRow;
  readonly offerings: RawOfferingRow[];
  readonly qualification_fields: RawQualificationFieldRow[];
}

export interface OfferingSchedule {
  readonly days: string[];
  readonly start: string | null;
  readonly end: string | null;
  readonly timezone: string | null;
}

export interface BusinessOfferingView {
  readonly code: string;
  readonly display_name: string;
  readonly offering_type: RawOfferingRow['offering_type'];
  readonly description: string | null;
  readonly value_proposition: string | null;
  readonly price_type: RawOfferingRow['price_type'];
  /** Canonical price columns, or null when the offering is quote/free. */
  readonly price: { readonly amount: string; readonly currency: string } | null;
  /** false = the agent must never state an amount for this offering. */
  readonly price_assertable: boolean;
  readonly billing_interval: string | null;
  readonly modality: string | null;
  readonly schedules: OfferingSchedule[];
  readonly certification: boolean | null;
  readonly hours_per_month: number | null;
  /** Class count, e.g. "38 clases". Null when not published for this offering. */
  readonly classes: number | null;
  /** Module count, e.g. "5 módulos". Null when not published for this offering. */
  readonly modules: number | null;
  /** What's bundled in: prácticas, exámenes, certificado, etc. */
  readonly includes: string[];
  /** True when the offering has a published syllabus (temario) to point customers to. */
  readonly syllabus_published: boolean | null;
  readonly policies: {
    readonly allowed_promise: string | null;
    readonly forbidden_promises: string[];
    readonly price_message: string | null;
  };
}

export interface QualificationFieldView {
  readonly code: string;
  readonly prompt: string;
  readonly response_type: RawQualificationFieldRow['response_type'];
  readonly options: string[];
  readonly is_required: boolean;
  readonly position: number;
}

export interface BusinessContextView {
  readonly workspace: {
    readonly slug: string;
    readonly display_name: string;
    readonly environment: RawWorkspaceRow['environment'];
    readonly default_locale: string;
    readonly timezone: string;
  };
  readonly offerings: BusinessOfferingView[];
  readonly qualification_fields: QualificationFieldView[];
  readonly injection_suspected_count: number;
  /**
   * How many active offerings existed beyond `maxOfferings` and were cut
   * from this view. Non-zero here means the agent's own prompt context is
   * missing real courses — silently, unless the caller logs this count. See
   * DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings for what the bound is.
   */
  readonly offerings_truncated: number;
}

export interface BusinessContextLimits {
  readonly maxOfferings: number;
  readonly maxTextChars: number;
  readonly maxSchedules: number;
  readonly maxQualificationFields: number;
  readonly maxOptions: number;
  readonly maxForbiddenPromises: number;
}

export const DEFAULT_BUSINESS_CONTEXT_LIMITS: BusinessContextLimits = {
  // A defensive ceiling on how many offerings enter the context, not an
  // aggregate prompt-size check (no such check exists downstream — only the
  // per-field maxTextChars and the other per-array caps below). Must stay
  // above the largest real workspace's active offering count, or offerings
  // past this count are cut from both the catalog endpoints and the agent's
  // own prompt context. StudyX (production) currently seeds 14 verified
  // offerings out of a documented ~28-30 course catalog
  // (docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md), so 40 leaves
  // headroom for the rest of that catalog to be seeded without silently
  // truncating again. A breach of this bound is no longer silent: it sets
  // BusinessContextView.offerings_truncated, which callers log (see
  // catalog/route.ts's `catalog.capped` and claim-batch.ts's
  // `orchestration.claim.business_context_truncated`).
  maxOfferings: 40,
  maxTextChars: 400,
  maxSchedules: 6,
  maxQualificationFields: 12,
  maxOptions: 12,
  // Was a bare `8` inline — exactly the number StudyX seeds, so the very next
  // forbidden promise added to a workspace would have been dropped on the
  // floor without a word. These are the agent's safety rails (no price, no
  // "certificación verificada", no título/homologación, no cuotas…), so a
  // silent cut here is worse than one on offerings: the agent keeps talking
  // and simply stops being forbidden from something. Same lesson as
  // maxOfferings above — leave headroom well above the real data.
  maxForbiddenPromises: 24,
};

interface SanitizeTally {
  suspected: number;
}

function cleanText(
  raw: string | null | undefined,
  maxChars: number,
  tally: SanitizeTally
): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const sanitized = sanitizeRetrievedText(raw, maxChars);
  if (sanitized.injection_suspected) tally.suspected += 1;
  return sanitized.text.length > 0 ? sanitized.text : null;
}

function cleanStringList(
  value: unknown,
  maxItems: number,
  maxChars: number,
  tally: SanitizeTally
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value.slice(0, maxItems)) {
    if (typeof entry !== 'string') continue;
    const text = cleanText(entry, maxChars, tally);
    if (text !== null) out.push(text);
  }
  return out;
}

function readSchedules(
  delivery: Record<string, unknown>,
  limits: BusinessContextLimits,
  tally: SanitizeTally
): OfferingSchedule[] {
  const raw = delivery.schedules;
  if (!Array.isArray(raw)) return [];
  const schedules: OfferingSchedule[] = [];
  for (const entry of raw.slice(0, limits.maxSchedules)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    schedules.push({
      days: cleanStringList(record.days, 7, 32, tally),
      start: cleanText(typeof record.start === 'string' ? record.start : null, 16, tally),
      end: cleanText(typeof record.end === 'string' ? record.end : null, 16, tally),
      timezone: cleanText(typeof record.timezone === 'string' ? record.timezone : null, 64, tally),
    });
  }
  return schedules;
}

function buildOfferingView(
  offering: RawOfferingRow,
  limits: BusinessContextLimits,
  tally: SanitizeTally
): BusinessOfferingView {
  const fixed =
    offering.price_type === 'fixed'
    && offering.price_amount !== null
    && offering.currency !== null;
  const delivery = offering.delivery ?? {};
  const guardrails = offering.guardrails ?? {};

  return {
    code: offering.code,
    display_name: offering.display_name,
    offering_type: offering.offering_type,
    description: cleanText(offering.description, limits.maxTextChars, tally),
    value_proposition: cleanText(offering.value_proposition, limits.maxTextChars, tally),
    price_type: offering.price_type,
    price: fixed
      ? { amount: offering.price_amount!, currency: offering.currency! }
      : null,
    price_assertable: fixed,
    billing_interval: offering.billing_interval,
    modality: cleanText(
      typeof delivery.modality === 'string' ? delivery.modality : null,
      64,
      tally
    ),
    schedules: readSchedules(delivery, limits, tally),
    certification: typeof delivery.certification === 'boolean' ? delivery.certification : null,
    hours_per_month:
      typeof delivery.hours_per_month === 'number' && Number.isFinite(delivery.hours_per_month)
        ? delivery.hours_per_month
        : null,
    classes:
      typeof delivery.classes === 'number' && Number.isFinite(delivery.classes)
        ? delivery.classes
        : null,
    modules:
      typeof delivery.modules === 'number' && Number.isFinite(delivery.modules)
        ? delivery.modules
        : null,
    includes: cleanStringList(delivery.includes, 12, 64, tally),
    syllabus_published:
      typeof delivery.temario_publicado === 'boolean' ? delivery.temario_publicado : null,
    policies: {
      allowed_promise: cleanText(
        typeof guardrails.allowed_promise === 'string' ? guardrails.allowed_promise : null,
        limits.maxTextChars,
        tally
      ),
      forbidden_promises: cleanStringList(
        guardrails.forbidden_promises,
        limits.maxForbiddenPromises,
        limits.maxTextChars,
        tally
      ),
      price_message: cleanText(
        typeof guardrails.price_message === 'string' ? guardrails.price_message : null,
        limits.maxTextChars,
        tally
      ),
    },
  };
}

export function buildBusinessContextView(
  raw: RawBusinessContext,
  limits: BusinessContextLimits = DEFAULT_BUSINESS_CONTEXT_LIMITS
): BusinessContextView {
  const tally: SanitizeTally = { suspected: 0 };

  const cappedRawOfferings = raw.offerings.slice(0, limits.maxOfferings);
  const offerings_truncated = raw.offerings.length - cappedRawOfferings.length;
  const offerings = cappedRawOfferings.map((offering) => buildOfferingView(offering, limits, tally));

  const qualification_fields = raw.qualification_fields
    .slice()
    .sort((left, right) => left.position - right.position)
    .slice(0, limits.maxQualificationFields)
    .map((field): QualificationFieldView => ({
      code: field.code,
      prompt: cleanText(field.prompt, limits.maxTextChars, tally) ?? '',
      response_type: field.response_type,
      options: cleanStringList(field.options, limits.maxOptions, 64, tally),
      is_required: field.is_required,
      position: field.position,
    }));

  return {
    workspace: {
      slug: raw.workspace.slug,
      display_name: cleanText(raw.workspace.display_name, 128, tally) ?? raw.workspace.slug,
      environment: raw.workspace.environment,
      default_locale: raw.workspace.default_locale,
      timezone: raw.workspace.timezone,
    },
    offerings,
    qualification_fields,
    injection_suspected_count: tally.suspected,
    offerings_truncated,
  };
}

/** Wire shape of the offering-backed catalog (see /api/agent/tools/catalog). */
export interface BusinessCatalogItem {
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  readonly offering_type: RawOfferingRow['offering_type'];
  readonly modality: string | null;
  readonly billing_interval: string | null;
  readonly price: { readonly amount: string; readonly currency: string } | null;
  readonly price_type: RawOfferingRow['price_type'];
  readonly price_assertable: boolean;
}

export interface BusinessCatalogView {
  readonly items: BusinessCatalogItem[];
  readonly count: number;
  readonly dropped: number;
  readonly stale_promotions_dropped: number;
  readonly injection_suspected_count: number;
  readonly as_of: string;
  /** false = no offering on this turn may be quoted an amount. */
  readonly prices_assertable: boolean;
}

export function buildBusinessCatalogView(
  offerings: readonly BusinessOfferingView[],
  options: {
    readonly now: number;
    readonly maxItems?: number;
    /**
     * Offerings the caller already dropped before handing the array over.
     * `buildBusinessContextView` slices to the same cap upstream, so by the
     * time the catalog route calls this the cut has already happened and the
     * local `slice` finds nothing left to remove. Without this, the response
     * body claims `dropped: 0` while real offerings are missing from it.
     */
    readonly droppedUpstream?: number;
    /** Same reason: the injection scan runs upstream, not here. */
    readonly injectionSuspectedCount?: number;
  }
): BusinessCatalogView {
  const maxItems = options.maxItems ?? DEFAULT_BUSINESS_CONTEXT_LIMITS.maxOfferings;
  const kept = offerings.slice(0, maxItems);

  const items = kept.map((offering): BusinessCatalogItem => ({
    sku: offering.code,
    name: offering.display_name,
    description: offering.description,
    offering_type: offering.offering_type,
    modality: offering.modality,
    billing_interval: offering.billing_interval,
    price: offering.price,
    price_type: offering.price_type,
    price_assertable: offering.price_assertable,
  }));

  return {
    items,
    count: items.length,
    dropped: offerings.length - kept.length + (options.droppedUpstream ?? 0),
    stale_promotions_dropped: 0,
    injection_suspected_count: options.injectionSuspectedCount ?? 0,
    as_of: new Date(options.now).toISOString(),
    prices_assertable: items.some((item) => item.price_assertable),
  };
}
