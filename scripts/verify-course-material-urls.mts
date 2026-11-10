/**
 * Checks that every registered course material URL (programme/ficha PDF and
 * course image) answers 200 with the expected content type on a deployed
 * backend. Run after staging + deploy (owner 2026-11-09: no 404 attachments).
 *
 *   npx tsx scripts/verify-course-material-urls.mts https://studyx-agente-ventas.vercel.app
 *   npx tsx scripts/verify-course-material-urls.mts http://127.0.0.1:3000   (local `next start` of the build)
 *
 * Read-only: GET requests to public assets. Exit 1 on any failure.
 */
import {
  COURSE_PROGRAM_ASSETS_V1,
  courseProgramImageUrlV1,
  courseProgramUrlV1,
} from '../src/shared/catalog/course-programs.ts';

const baseUrl = process.argv[2];
const localBase = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(baseUrl ?? '');
if (!baseUrl || (!/^https:\/\//u.test(baseUrl) && !localBase)) {
  console.error('USAGE: npx tsx scripts/verify-course-material-urls.mts <https-base-url|http://127.0.0.1:port>');
  process.exit(2);
}
// The backend only builds https URLs; a local server is checked on the same registry paths.
const placeholder = 'https://material.invalid';
const env = { STUDYX_PUBLIC_ASSET_BASE_URL: localBase ? placeholder : baseUrl };
const served = (url: string | null) => (url && localBase ? baseUrl + url.slice(placeholder.length) : url);

const checks = [...COURSE_PROGRAM_ASSETS_V1.keys()].flatMap((code) => [
  { code, kind: 'pdf', url: served(courseProgramUrlV1(code, env)), type: 'application/pdf' },
  { code, kind: 'image', url: served(courseProgramImageUrlV1(code, env)), type: 'image/png' },
]);

const failures: string[] = [];
await Promise.all(checks.map(async ({ code, kind, url, type }) => {
  if (!url) { failures.push(`${code} ${kind} NO_URL`); return; }
  const response = await fetch(url);
  const contentType = response.headers.get('content-type') ?? '';
  await response.arrayBuffer();
  if (response.status !== 200 || !contentType.startsWith(type)) {
    failures.push(`${code} ${kind} ${response.status} ${contentType} ${url}`);
  }
}));

console.log(JSON.stringify({ base_url: baseUrl, checked: checks.length, failed: failures.length }));
for (const failure of failures.sort()) console.log(failure);
process.exit(failures.length === 0 ? 0 : 1);
