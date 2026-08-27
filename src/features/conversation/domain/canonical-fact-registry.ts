import type { BusinessContextView, CatalogIndexView } from '@/features/orchestration/domain/business-context';
import type {
  CanonicalFactRefV1,
  CanonicalFactRequestV1,
  CanonicalFactV1,
} from './conversation-pipeline';
import { canonicalReferenceKey } from './conversation-planner';

export interface CanonicalFactRegistryV1 {
  readonly facts: ReadonlyMap<string, CanonicalFactV1>;
}

function factRef(fact: CanonicalFactV1): CanonicalFactRefV1 {
  return {
    id: fact.id,
    kind: fact.kind,
    ...(fact.offering_code ? { offering_code: fact.offering_code } : {}),
    ...(fact.payment_plan ? { payment_plan: fact.payment_plan } : {}),
  };
}

function durationValue(offering: BusinessContextView['offerings'][number]): string | null {
  if (offering.classes !== null) return `${offering.classes} clases`;
  if (offering.hours_per_month !== null) return `${offering.hours_per_month} horas por mes`;
  if (offering.modules !== null) return `${offering.modules} módulos`;
  return null;
}

export function buildCanonicalFactRegistry(input: {
  readonly business_context: BusinessContextView | null;
  readonly catalog_index: CatalogIndexView | null;
}): CanonicalFactRegistryV1 {
  const facts = new Map<string, CanonicalFactV1>();
  const areas = new Map<string, string>();
  for (const offering of input.catalog_index?.offerings ?? []) {
    if (!offering.academy) continue;
    const areaCode = canonicalReferenceKey(offering.academy).split(' ').join('-');
    areas.set(areaCode, offering.academy);
    facts.set(`offering:${offering.code}:name:v1`, {
      id: `offering:${offering.code}:name:v1`, kind: 'offering_name',
      source: 'business_snapshot', value: offering.display_name,
      offering_code: offering.code, area_code: areaCode,
    });
  }
  for (const [areaCode, displayName] of areas) {
    facts.set(`area:${areaCode}:name:v1`, {
      id: `area:${areaCode}:name:v1`, kind: 'area_name',
      source: 'business_snapshot', value: displayName, area_code: areaCode,
    });
  }
  for (const offering of input.business_context?.offerings ?? []) {
    const nameId = `offering:${offering.code}:name:v1`;
    if (!facts.has(nameId)) {
      const areaCode = offering.academy ? canonicalReferenceKey(offering.academy).split(' ').join('-') : undefined;
      facts.set(nameId, {
        id: nameId, kind: 'offering_name', source: 'business_snapshot',
        value: offering.display_name, offering_code: offering.code, area_code: areaCode,
      });
    }
    if (offering.description) {
      facts.set(`offering:${offering.code}:description:v1`, {
        id: `offering:${offering.code}:description:v1`, kind: 'offering_description',
        source: 'business_snapshot', value: offering.description, offering_code: offering.code,
      });
    }
    const duration = durationValue(offering);
    if (duration) {
      facts.set(`offering:${offering.code}:duration:v1`, {
        id: `offering:${offering.code}:duration:v1`, kind: 'offering_duration',
        source: 'business_snapshot', value: duration, offering_code: offering.code,
      });
    }
    if (offering.modality) {
      facts.set(`offering:${offering.code}:modality:v1`, {
        id: `offering:${offering.code}:modality:v1`, kind: 'offering_modality',
        source: 'business_snapshot', value: offering.modality, offering_code: offering.code,
      });
    }
  }
  for (const offering of input.catalog_index?.offerings ?? []) {
    for (const option of input.business_context?.workspace.payment_options ?? []) {
      facts.set(`payment:${offering.code}:${option.code}:label:v1`, {
        id: `payment:${offering.code}:${option.code}:label:v1`, kind: 'payment_plan_label',
        source: 'business_snapshot', value: option.label,
        offering_code: offering.code, payment_plan: option.code,
      });
      facts.set(`payment:${offering.code}:${option.code}:price:v1`, {
        id: `payment:${offering.code}:${option.code}:price:v1`, kind: 'payment_plan_price',
        source: 'business_snapshot',
        value: `${option.total.currency} ${option.total.amount}`,
        offering_code: offering.code, payment_plan: option.code,
      });
      facts.set(`payment:${offering.code}:${option.code}:link:v1`, {
        id: `payment:${offering.code}:${option.code}:link:v1`, kind: 'payment_link',
        source: 'payment_config', value: option.payment_link,
        offering_code: offering.code, payment_plan: option.code,
      });
    }
  }
  return { facts };
}

function idsForRequest(request: CanonicalFactRequestV1, registry: CanonicalFactRegistryV1): string[] {
  if (request.kind === 'area_options') {
    return [...registry.facts.values()]
      .filter((fact) => fact.kind === 'area_name')
      .slice(0, request.limit)
      .map((fact) => fact.id);
  }
  if (request.kind === 'course_options') {
    return [...registry.facts.values()]
      .filter((fact) => fact.kind === 'offering_name' && fact.area_code === request.area_code)
      .slice(0, request.limit)
      .map((fact) => fact.id);
  }
  if (request.kind === 'payment_options') {
    return [...registry.facts.values()]
      .filter((fact) => (
        fact.offering_code === request.offering_code
        && (fact.kind === 'payment_plan_label' || fact.kind === 'payment_plan_price')
      ))
      .map((fact) => fact.id);
  }
  if (request.kind === 'payment_link') {
    return [`payment:${request.offering_code}:${request.payment_plan}:link:v1`];
  }
  const suffix = request.kind.slice('offering_'.length);
  return [`offering:${request.offering_code}:${suffix}:v1`];
}

export function materializeCanonicalFactRequests(input: {
  readonly requests: readonly CanonicalFactRequestV1[];
  readonly registry: CanonicalFactRegistryV1;
}): { readonly facts: CanonicalFactV1[]; readonly refs: CanonicalFactRefV1[] } {
  const ids = new Set<string>();
  for (const request of input.requests) {
    for (const id of idsForRequest(request, input.registry)) ids.add(id);
  }
  const facts = [...ids]
    .map((id) => input.registry.facts.get(id))
    .filter((fact): fact is CanonicalFactV1 => fact !== undefined);
  return { facts, refs: facts.map(factRef) };
}
