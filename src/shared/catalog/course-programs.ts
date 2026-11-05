/**
 * Official programme PDFs the agent may send (owner decision 2026-11-04).
 * One entry per offering with an official PDF. The file is NOT in git: it is staged
 * into public/programas/<slug>.pdf by scripts/stage-course-programs.mjs, which
 * verifies the sha256 below. A test keeps this table equal to
 * supabase/seed/data/programas-studyx-pdf.json + OFFERING_CODES.
 */
export interface CourseProgramAssetV1 {
  readonly offering_code: string;
  readonly slug: string;
  readonly sha256: string;
  /** First 12 hex of the sha256: identity of the delivered file. */
  readonly version: string;
  readonly filename: string;
  readonly mime: 'application/pdf';
}

const PROGRAMS: ReadonlyArray<readonly [offering_code: string, slug: string, sha256: string, display: string]> = [
  ['barista', 'barista', '0dad8004f93037e40dbf03fd8393b59011323e65dc57a8665d3775115f78b633', 'Barista'],
  ['cuidador_adultos_mayores', 'asistente-cuidador-adultos-mayores', '1e5d708fc5c86d20fffd493bea4ba4e453d64cf9cda2bfe6cb070b9b45752b4c', 'Asistente y Cuidador de Adultos Mayores'],
  ['decoracion_de_interiores', 'decoracion-interiores', '8a9549971e52e0bc9f2812e2ed4af84c395e4cf7c5430c3b6bdf6c5c0ba79784', 'Decoración de Interiores'],
  ['depilacion_definitiva', 'tecnica-o-en-depilacion-definitiva', 'c4886f4f19294869b69b3732149e707e64ccf396fa369d7e0f275f5fa869d3d1', 'Técnica/o en Depilación Definitiva'],
  ['diseno_corel_draw', 'diseno-grafico-en-coreldraw', '750e53eb114da36f18eb914b073711f3aba44a0d24731660d3fb41e58d80b324', 'Diseño Gráfico con CorelDraw'],
  ['diseno_illustrator', 'diseno-grafico-con-ilustrator', '4344dda905f14502a9a2cf403f06a6dd75be897165a9b04bfd982d102f1c85b5', 'Diseño Gráfico con Illustrator'],
  ['diseno_photoshop', 'diseno-grafico-en-photoshop', 'eb9db1dd629056691c137d420c6df0ead6e0d9d9b0a820242cfc12f1d0788bf5', 'Diseño Gráfico con Photoshop'],
  ['energia_solar_fotovoltaica', 'energia-solar-fotovoltaica', '6f3bbc99f5aeb99ec31dda52656b3463b2e6edcef58f349acd3fa3b3f8c74950', 'Energía Solar Fotovoltaica'],
  ['entrenamiento_funcional', 'entrenamiento-funcional', '5a9be33937401a1fec12d97983e4a255c8a718f14ff087677cb72036ead9744e', 'Entrenamiento Funcional'],
  ['estetica_integral', 'tecnica-o-en-estetica-integral', '7baaa30d02317c372109595ab8d10bfbbcd0d8d88ccbf33fd49e9d3f1d9191c3', 'Técnica/o en Estética Integral'],
  ['fotografia_profesional', 'fotografia-profesional', 'a4d599f88cc8d3c5640287000563de7f702555f2021209d5106136b7261e32f7', 'Fotografía Profesional'],
  ['maquillaje_profesional', 'maquillaje-profesional', '4c3f07875f2ff74360db4046645621eb392ffb1641c9fb02beaaac672081d0c0', 'Maquillaje Profesional'],
  ['marketing_digital', 'marketing-digital', '61b53957bd2c84813d22266faf572802ef6a9d0b20700b5690475da84c9500e0', 'Marketing Digital'],
  ['masoterapia', 'masoterapia', 'f5089fadccba4b57bb122ea2b191c79246914c47d9176eaeda4b7ea06b993cdc', 'Masoterapia'],
  ['nutricion_alimentacion', 'nutricion-y-alimentacion-saludable', 'b1e7aadc0c43a4ac40c98a9a2c32b10e2c6212eec4a568976388ab5181f75559', 'Nutrición y Alimentación Saludable'],
  ['organizador_eventos_sociales', 'organizador-profesional-de-eventos-sociales', '79b223e155dddc746d798012f1c64350cd3b9c9e57eeaf5077c1ece8caaf4b6d', 'Organizador Profesional de Eventos Sociales'],
  ['paisajismo_jardineria', 'paisajismo-jardineria', '249347618f517b5e94716764924208eaf8bde6f0fe096f9831fbff4da4f4f9ee', 'Paisajismo y Jardinería'],
  ['publicidad_redes_sociales', 'publicidad-en-las-redes-sociales', '5541829b0a3e2f43ad0497ca74825c4d9998c2bbc4d7d94d775ea9e474b1b081', 'Publicidad en las Redes Sociales'],
  ['real_estate', 'real-estate', 'f7631135a630119e0c07fb9602d42c57b62bd1a821a70d46c6690dde7fa0e6bc', 'Real Estate'],
  ['sushi_principiantes', 'sushi-para-principiantes', 'cbc8c0979d78c54e7c73822450dee72e42d0443b73780bea7649efd14de82ff1', 'Sushi para Principiantes'],
  ['unas_gelificadas', 'unas-gelificadas', '58b8e20b77d8a5ae2878b05b75bea6a7e18f45d7c7d2ea76b65ad78f6ea5ad8e', 'Uñas Gelificadas'],
  ['vino_cata_maridaje', 'introduccion-al-vino-la-cata-y-el-maridaje', '0cafa1420470e6905c62fc81c47032204ed026ab95f024f29241bb213b6f5296', 'Introducción al Vino, la Cata y el Maridaje'],
];

export const COURSE_PROGRAM_ASSETS_V1: ReadonlyMap<string, CourseProgramAssetV1> = new Map(PROGRAMS.map(([offering_code, slug, sha256, display]) => [
  offering_code,
  { offering_code, slug, sha256, version: sha256.slice(0, 12), filename: `Programa ${display.replace(/[\\/]/gu, "-")} - Studyx.pdf`, mime: 'application/pdf' as const },
]));

/**
 * Channels whose integration can deliver a `file`. Production: WhatsApp only. The local golden
 * evaluator widens it through STUDYX_COURSE_PROGRAM_CHANNELS (never set in a deployment).
 */
export function courseProgramChannelsV1(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const configured = env['STUDYX_COURSE_PROGRAM_CHANNELS']?.split(',').map(value => value.trim()).filter(Boolean);
  return configured?.length ? configured : ['whatsapp'];
}

export function courseProgramAssetV1(offeringCode: string): CourseProgramAssetV1 | null {
  return COURSE_PROGRAM_ASSETS_V1.get(offeringCode) ?? null;
}

/**
 * Public URL of the staged PDF. Built ONLY from the backend env base URL and the
 * registry slug: the model never supplies a URL. Missing/invalid env => null
 * (the capability is unavailable).
 */
export function courseProgramUrlV1(offeringCode: string, env: Readonly<Record<string, string | undefined>>): string | null {
  const asset = courseProgramAssetV1(offeringCode);
  const base = env['STUDYX_PUBLIC_ASSET_BASE_URL']?.trim().replace(/\/+$/u, '');
  if (!asset || !base) return null;
  try {
    const url = new URL(`${base}/programas/${asset.slug}.pdf`);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}
