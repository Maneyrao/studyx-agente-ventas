import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/u.test(stem)) throw new Error('GOLDEN_RESULT_STEM_INVALID');
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
