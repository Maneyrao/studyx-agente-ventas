import { COURSE_MATERIAL_ROWS_V1 } from './course-material.generated';

/**
 * Official WhatsApp material of the 57 manual courses (owner decision 2026-11-05): the course image plus the
 * programme PDF (the official one when it exists, otherwise the manual's ficha PDF). Files are NOT in git except
 * the ficha PDFs: scripts/stage-course-programs.mjs stages them into public/ verifying the sha256 registered in
 * course-material.generated.ts (scripts/generate-course-material-registry.mjs). A test keeps the table equal to
 * the index CSV, the fichas data and supabase/seed/data/programas-studyx-pdf.json.
 */
export interface CourseMaterialFileV1 {
  readonly sha256: string;
  /** Path under the public asset base, no leading slash. */
  readonly path: string;
  readonly filename: string;
}
export interface CourseProgramAssetV1 {
  readonly offering_code: string;
  readonly name: string;
  /** The PDF: the official programme when it exists, otherwise the manual ficha. */
  readonly document: CourseMaterialFileV1 & { readonly kind: 'program' | 'ficha'; readonly mime: 'application/pdf' };
  readonly image: CourseMaterialFileV1 & { readonly mime: 'image/png' };
  /** Identity of the delivered pair: first 12 hex of sha256(document sha256 : image sha256). */
  readonly version: string;
  /** sha256 of the PDF (kept for the delivery ledger). */
  readonly sha256: string;
  /** PDF filename shown to the customer. */
  readonly filename: string;
  readonly slug: string;
  readonly mime: 'application/pdf';
  readonly has_program_pdf: boolean;
}

const safeName = (name: string) => name.replace(/[\\/]/gu, '-');

export const COURSE_PROGRAM_ASSETS_V1: ReadonlyMap<string, CourseProgramAssetV1> = new Map(COURSE_MATERIAL_ROWS_V1.map(
  ([code, name, , imageSha, fichaFile, fichaSha, programSlug, programSha, version]) => {
    const hasProgram = programSlug !== null && programSha !== null;
    const document = hasProgram
      ? { kind: 'program' as const, sha256: programSha, path: `programas/${programSlug}.pdf`, filename: `Programa ${safeName(name)} - Studyx.pdf`, mime: 'application/pdf' as const }
      : { kind: 'ficha' as const, sha256: fichaSha, path: `material/fichas/${code}.pdf`, filename: `Ficha ${safeName(name)} - Studyx.pdf`, mime: 'application/pdf' as const };
    const image = { sha256: imageSha, path: `material/imagenes/${code}.png`, filename: `${safeName(name)} - Studyx.png`, mime: 'image/png' as const };
    return [code, { offering_code: code, name, document, image, version, sha256: document.sha256, filename: document.filename,
      slug: hasProgram ? programSlug : fichaFile.replace(/\.pdf$/u, ''), mime: 'application/pdf' as const, has_program_pdf: hasProgram }];
  },
));

/**
 * Channels whose integration can deliver a `file`. Production: WhatsApp only. The local golden
 * evaluator widens it through STUDYX_COURSE_PROGRAM_CHANNELS (never set in a deployment).
 */
export function courseProgramChannelsV1(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const configured = env['STUDYX_COURSE_PROGRAM_CHANNELS']?.split(',').map(value => value.trim()).filter(Boolean);
  return configured?.length ? configured : ['whatsapp'];
}

/**
 * Module count stated by the official programme text: the highest "Módulo N" when the
 * numbers 1..N are all listed. A count the programme itself lists is an authorized fact,
 * not an invention. Null when the text does not list a contiguous sequence.
 */
export function programModuleCountV1(texts: readonly string[]): number | null {
  const numbers = new Set<number>();
  for (const text of texts) for (const match of text.matchAll(/m[oó]dulo\s+(\d{1,2})\b/giu)) numbers.add(Number(match[1]));
  const highest = Math.max(0, ...numbers);
  return highest >= 2 && Array.from({ length: highest }, (_, index) => index + 1).every(value => numbers.has(value)) ? highest : null;
}

export function courseProgramAssetV1(offeringCode: string): CourseProgramAssetV1 | null {
  return COURSE_PROGRAM_ASSETS_V1.get(offeringCode) ?? null;
}

function publicUrl(path: string, env: Readonly<Record<string, string | undefined>>): string | null {
  const base = env['STUDYX_PUBLIC_ASSET_BASE_URL']?.trim().replace(/\/+$/u, '');
  if (!base) return null;
  try {
    const url = new URL(`${base}/${path}`);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

/**
 * Public URL of the staged PDF. Built ONLY from the backend env base URL and the registry path: the model
 * never supplies a URL. Missing/invalid env => null (the capability is unavailable).
 */
export function courseProgramUrlV1(offeringCode: string, env: Readonly<Record<string, string | undefined>>): string | null {
  const asset = courseProgramAssetV1(offeringCode);
  return asset ? publicUrl(asset.document.path, env) : null;
}

export function courseProgramImageUrlV1(offeringCode: string, env: Readonly<Record<string, string | undefined>>): string | null {
  const asset = courseProgramAssetV1(offeringCode);
  return asset ? publicUrl(asset.image.path, env) : null;
}

