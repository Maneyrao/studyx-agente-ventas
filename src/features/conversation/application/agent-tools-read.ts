import type { ToolResultV1 } from '../../../../agent-core/src/ports/tool-executor';
import {
  DEFAULT_BUSINESS_CONTEXT_LIMITS,
  buildBusinessContextView,
  buildCatalogIndexView,
  type BusinessContextLimits,
  type BusinessOfferingView,
  type PaymentOptionView,
  type RawBusinessContext,
  type RawCatalogIndex,
} from '@/features/orchestration/domain/business-context';
import { sanitizeRetrievedText } from '@/features/orchestration/domain/retrieved-context';

const COURSE_CODE = /^[a-z0-9_-]{1,128}$/iu;

export type ReadToolNameV1 =
  | 'search_catalog'
  | 'get_course_information'
  | 'get_payment_options';

export interface ReadFactV1 {
  readonly fact_id: string;
  readonly value: string;
}

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

function ok<T>(tool: ReadToolNameV1, canonicalData: T): ToolResultV1<T> {
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

export function readToolFailureV1(
  tool: ReadToolNameV1,
  errorCode: string,
  recoverable = true,
): ToolResultV1<never> {
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

export function isCanonicalCourseCodeV1(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && COURSE_CODE.test(value);
}

function canonicalCourseCode(value: string): string | null {
  return isCanonicalCourseCodeV1(value) ? value : null;
}

/** Identity text cannot carry instructions into the model's tool results. */
function safeIdentityText(value: string | null, fallback: string | null): string | null {
  if (value === null) return fallback;
  const sanitized = sanitizeRetrievedText(value, 128);
  if (sanitized.injection_suspected || sanitized.text.length === 0) return fallback;
  return sanitized.text;
}

function naturalList(values: readonly string[]): string {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} y ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} y ${values.at(-1)}`;
}

function renderSchedules(schedules: BusinessOfferingView['schedules']): string | null {
  const rendered = schedules.flatMap((schedule) => {
    const pieces: string[] = [];
    const days = naturalList(schedule.days);
    if (days) pieces.push(days);
    if (schedule.start && schedule.end) pieces.push(`${schedule.start} a ${schedule.end}`);
    else if (schedule.start) pieces.push(`desde ${schedule.start}`);
    else if (schedule.end) pieces.push(`hasta ${schedule.end}`);
    let value = pieces.join(', ');
    if (schedule.timezone) value = value ? `${value} (${schedule.timezone})` : schedule.timezone;
    return value ? [value] : [];
  });
  return rendered.length > 0 ? rendered.join('; ') : null;
}

const BILLING_INTERVAL_LABELS: Readonly<Record<NonNullable<BusinessOfferingView['billing_interval']>, string>> = {
  one_time: 'única',
  weekly: 'semanal',
  monthly: 'mensual',
  quarterly: 'trimestral',
  annual: 'anual',
  custom: 'personalizada',
};

function courseFacts(
  offering: BusinessOfferingView,
  displayName: string,
  academy: string | null,
): ReadFactV1[] {
  const facts: ReadFactV1[] = [];
  const add = (suffix: string, value: string | null) => {
    if (value === null || value.length === 0) return;
    facts.push({ fact_id: `offering:${offering.code}:${suffix}:v1`, value });
  };

  add('name', displayName);
  add('academy', academy);
  add('description', offering.description);
  add('value-proposition', offering.value_proposition);
  add('price', offering.price_assertable && offering.price
    ? `${offering.price.currency} ${offering.price.amount}`
    : null);
  add('modality', offering.modality);
  add('schedules', renderSchedules(offering.schedules));
  add('certification', offering.certification === null
    ? null
    : offering.certification ? 'Incluye certificación' : 'No incluye certificación');
  add('hours-per-month', offering.hours_per_month === null
    ? null
    : `${offering.hours_per_month} horas por mes`);
  add('classes', offering.classes === null ? null : `${offering.classes} clases`);
  add('modules', offering.modules === null ? null : `${offering.modules} módulos`);
  add('includes', offering.includes.length > 0 ? `Incluye: ${offering.includes.join(', ')}` : null);
  add('syllabus', offering.syllabus_published === null
    ? null
    : offering.syllabus_published ? 'Temario publicado' : 'Temario no publicado');
  add('billing-interval', offering.billing_interval
    ? `Frecuencia de pago: ${BILLING_INTERVAL_LABELS[offering.billing_interval]}`
    : null);
  add('language', offering.language ? `Idioma: ${offering.language}` : null);
  add('min-age', offering.min_age === null ? null : `Edad mínima: ${offering.min_age} años`);
  return facts;
}

export async function searchCatalogToolV1(deps: ReadDeps) {
  try {
    const completeLimits = { ...DEFAULT_BUSINESS_CONTEXT_LIMITS, maxOfferings: 1_000 };
    const [rawIndex, rawContext] = await Promise.all([
      deps.store.loadCompleteIndex(deps.workspaceSlug),
      deps.store.loadBusinessContext(deps.workspaceSlug, completeLimits),
    ]);
    if (!rawIndex) return readToolFailureV1('search_catalog', 'CATALOG_UNAVAILABLE');

    const index = buildCatalogIndexView(rawIndex);
    const context = rawContext ? buildBusinessContextView(rawContext, completeLimits) : null;
    const offerings: Array<{ code: string; display_name: string; academy: string | null }> = [];
    for (const offering of index.offerings) {
      const code = canonicalCourseCode(offering.code);
      if (!code) return readToolFailureV1('search_catalog', 'CATALOG_UNAVAILABLE');
      offerings.push({
        code,
        display_name: safeIdentityText(offering.display_name, code) ?? code,
        academy: safeIdentityText(offering.academy, null),
      });
    }
    const areas = [...new Set(offerings.flatMap((offering) => (
      offering.academy ? [offering.academy] : []
    )))];
    return ok('search_catalog', {
      offerings,
      areas,
      prices_assertable: context !== null
        && context.offerings_truncated === 0
        && context.prices_assertable,
    });
  } catch {
    return readToolFailureV1('search_catalog', 'CATALOG_UNAVAILABLE');
  }
}

export async function getCourseInformationToolV1(
  deps: ReadDeps,
  args: { readonly code: string },
) {
  const code = canonicalCourseCode(args.code);
  if (!code) return readToolFailureV1('get_course_information', 'INVALID_COURSE_CODE');

  try {
    const raw = await deps.store.loadByCode(deps.workspaceSlug, code);
    if (!raw) {
      const index = await deps.store.loadCompleteIndex(deps.workspaceSlug);
      if (!index) return readToolFailureV1('get_course_information', 'CATALOG_UNAVAILABLE');
      const stillIndexed = index.offerings.some((offering) => offering.code === code);
      return readToolFailureV1(
        'get_course_information',
        stillIndexed ? 'CATALOG_UNAVAILABLE' : 'COURSE_NOT_FOUND',
      );
    }
    const view = buildBusinessContextView(raw, {
      ...DEFAULT_BUSINESS_CONTEXT_LIMITS,
      maxOfferings: 1,
    });
    const offering = view.offerings.find((candidate) => candidate.code === code);
    if (!offering) return readToolFailureV1('get_course_information', 'CATALOG_UNAVAILABLE');
    const displayName = safeIdentityText(offering.display_name, code) ?? code;
    const academy = safeIdentityText(offering.academy, null);

    return ok('get_course_information', {
      code: offering.code,
      display_name: displayName,
      academy,
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
      facts: courseFacts(offering, displayName, academy),
    });
  } catch {
    return readToolFailureV1('get_course_information', 'CATALOG_UNAVAILABLE');
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
