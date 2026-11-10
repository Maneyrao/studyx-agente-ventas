import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RESULT_STEM_V1 = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/u;

/** @template {{id:string, turns:readonly unknown[]}} T
 * @param {string|undefined} selection @param {readonly T[]} cases @returns {readonly T[]} */
export function selectGoldenCasesV1(selection, cases) {
  if (selection === undefined) return cases;
  const requested = selection.split(',').map(value => value.trim());
  const known = new Set(cases.map(item => item.id.slice(0, 2)));
  if (!requested.length || new Set(requested).size !== requested.length
    || requested.some(code => !known.has(code))) throw new Error('GOLDEN_CASE_SELECTION_INVALID');
  return cases.filter(item => requested.includes(item.id.slice(0, 2)));
}

/** @param {string} directory @param {string} stem @param {Record<string,unknown>} metadata */
export function reserveGoldenRunV1(directory, stem, metadata) {
  if (!RESULT_STEM_V1.test(stem)) throw new Error('GOLDEN_RESULT_STEM_INVALID');
  mkdirSync(directory, { recursive: true });
  const evidenceFiles = [`${stem}.json`, `${stem}.md`, `${stem}-observations.partial.json`,
    `${stem}-provider.json`, `${stem}-provider.partial.json`, `${stem}-run-state.json`, `${stem}-durable-evidence.json`];
  if (evidenceFiles.some(name => existsSync(path.join(directory, name)))) throw new Error(`GOLDEN_ACCEPTANCE_ALREADY_STARTED:${stem}`);
  const target = path.join(directory, `${stem}-run-state.json`);
  try {
    writeFileSync(target, `${JSON.stringify({ ...metadata, status: 'started' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`GOLDEN_ACCEPTANCE_ALREADY_STARTED:${stem}`);
    throw error;
  }
  return target;
}

/** Rejudge immutable, synthetic observations under a new harness/scenario
 * identity without calling the agent model again or overwriting prior evidence. */
export function copyGoldenReuseObservationsV1(directory, sourceStem, targetStem) {
  if (!RESULT_STEM_V1.test(sourceStem) || !RESULT_STEM_V1.test(targetStem)) {
    throw new Error('GOLDEN_RESULT_STEM_INVALID');
  }
  const source = path.join(directory, `${sourceStem}-observations.partial.json`);
  const target = path.join(directory, `${targetStem}-observations.partial.json`);
  if (!existsSync(source)) throw new Error(`GOLDEN_REUSE_OBSERVATIONS_MISSING:${sourceStem}`);
  try {
    copyFileSync(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`GOLDEN_REUSE_OBSERVATIONS_ALREADY_EXISTS:${targetStem}`);
    throw error;
  }
  return target;
}

/** Preserve the SHA that actually produced immutable reused observations. */
export function readGoldenReuseEvaluatedShaV1(directory, sourceStem) {
  if (!RESULT_STEM_V1.test(sourceStem)) throw new Error('GOLDEN_RESULT_STEM_INVALID');
  const source = path.join(directory, `${sourceStem}-observations.partial.json`);
  if (!existsSync(source)) throw new Error(`GOLDEN_REUSE_OBSERVATIONS_MISSING:${sourceStem}`);
  let payload;
  try {
    payload = JSON.parse(readFileSync(source, 'utf8'));
  } catch {
    throw new Error('GOLDEN_REUSE_OBSERVATIONS_INVALID');
  }
  if (typeof payload?.base_sha !== 'string' || !/^[a-f0-9]{40}$/u.test(payload.base_sha)) {
    throw new Error('GOLDEN_REUSE_BASE_SHA_INVALID');
  }
  return payload.base_sha;
}
