import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';
import {
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
  buildBusinessContextView,
  buildCatalogIndexView,
  type BusinessContextLimits,
  type PaymentOptionView,
  type RawBusinessContext,
  type RawCatalogIndex,
} from '@/features/orchestration/domain/business-context';

interface ReadToolStore {
  loadCompleteIndex(workspaceSlug: string): Promise<RawCatalogIndex | null>;
  loadBusinessContext(
    workspaceSlug: string,
    limits?: BusinessContextLimits,
  ): Promise<RawBusinessContext | null>;
  loadByCode(workspaceSlug: string, code: string): Promise<RawBusinessContext | null>;
}

interface ReadDeps {
  readonly store: ReadToolStore;
  readonly workspaceSlug: string;
}

function ok<T>(tool: string, canonicalData: T): ToolResultV1<T> {
  return {
    tool,
    success: true,
    canonical_data: canonicalData,
    error_code: null,
    recoverable: false,
    idempotency_result: 'not_applicable',
    preparation_id: null,
  };
}

function fail(tool: string, errorCode: string, recoverable = true): ToolResultV1<never> {
  return {
    tool,
    success: false,
    canonical_data: null,
    error_code: errorCode,
    recoverable,
    idempotency_result: 'not_applicable',
    preparation_id: null,
  };
}

export async function searchCatalogToolV1(deps: ReadDeps) {
  try {
    const completeLimits = { ...DEFAULT_BUSINESS_CONTEXT_LIMITS, maxOfferings: 1_000 };
    const [rawIndex, rawContext] = await Promise.all([
      deps.store.loadCompleteIndex(deps.workspaceSlug),
      deps.store.loadBusinessContext(deps.workspaceSlug, completeLimits),
    ]);
    if (!rawIndex) return fail('search_catalog', 'CATALOG_UNAVAILABLE');

    const index = buildCatalogIndexView(rawIndex);
    const context = rawContext ? buildBusinessContextView(rawContext, completeLimits) : null;
    const areas = [...new Set(index.offerings.flatMap((offering) => (
      offering.academy ? [offering.academy] : []
    )))];
    return ok('search_catalog', {
      offerings: index.offerings.map((offering) => ({
        code: offering.code,
        display_name: offering.display_name,
        academy: offering.academy,
      })),
      areas,
      prices_assertable: context !== null
        && context.offerings_truncated === 0
        && context.prices_assertable,
    });
  } catch {
    return fail('search_catalog', 'CATALOG_UNAVAILABLE');
  }
}

export async function getCourseInformationToolV1(
  deps: ReadDeps,
  args: { readonly code: string },
) {
  try {
    const raw = await deps.store.loadByCode(deps.workspaceSlug, args.code);
    if (!raw) return fail('get_course_information', 'COURSE_NOT_FOUND');
    const view = buildBusinessContextView(raw, {
      ...DEFAULT_BUSINESS_CONTEXT_LIMITS,
      maxOfferings: 1,
    });
    const offering = view.offerings.find((candidate) => candidate.code === args.code);
    if (!offering) return fail('get_course_information', 'COURSE_NOT_FOUND');

    return ok('get_course_information', {
      code: offering.code,
      display_name: offering.display_name,
      academy: offering.academy,
      description: offering.description,
      value_proposition: offering.value_proposition,
      delivery: {
        modality: offering.modality,
        schedules: offering.schedules,
        certification: offering.certification,
        hours_per_month: offering.hours_per_month,
        classes: offering.classes,
        modules: offering.modules,
        includes: offering.includes,
        syllabus_published: offering.syllabus_published,
      },
      price: offering.price,
      price_assertable: offering.price_assertable,
      billing_interval: offering.billing_interval,
      language: offering.language,
      min_age: offering.min_age,
    });
  } catch {
    return fail('get_course_information', 'CATALOG_UNAVAILABLE');
  }
}

export async function getPaymentOptionsToolV1(deps: {
  readonly plans: readonly Pick<PaymentOptionView, 'code' | 'label'>[];
}) {
  return ok('get_payment_options', {
    plans: deps.plans.map((plan) => ({
      code: plan.code,
      label: plan.label,
      fact_id: `fact:payment_plan:${plan.code}`,
    })),
  });
}
