import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_CASES } from './scenarios';
import { reserveGoldenRunV1, selectGoldenCasesV1 } from './run-config.mjs';

describe('focused golden execution configuration', () => {
  it('selects exactly the requested existing scenarios and leaves criteria/ordering untouched', () => {
    const selected = selectGoldenCasesV1('03,04,06,07,14', GOLDEN_CASES);
    expect(selected.map(item => item.id.slice(0, 2))).toEqual(['03', '04', '06', '07', '14']);
    expect(selected.flatMap(item => item.turns)).toHaveLength(22);
    expect(selected.every(item => GOLDEN_CASES.includes(item))).toBe(true);
    expect(selectGoldenCasesV1(undefined, GOLDEN_CASES)).toEqual(GOLDEN_CASES);
  });

  it('rejects unknown, repeated and empty selections before any execution', () => {
    for (const selection of ['99', '03,03', '', '03,,04']) {
      expect(() => selectGoldenCasesV1(selection, GOLDEN_CASES)).toThrow('GOLDEN_CASE_SELECTION');
    }
  });

  it('reserves one exclusive run for either official model and never overwrites prior evidence', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'golden-config-'));
    try {
      const metadata = { evaluated_sha: 'new-sha', provider: 'deepseek', model: 'deepseek-v4-pro' };
      const filename = reserveGoldenRunV1(directory, 'focused-pro', metadata);
      expect(JSON.parse(readFileSync(filename, 'utf8'))).toMatchObject({ ...metadata, status: 'started' });
      expect(() => reserveGoldenRunV1(directory, 'focused-pro', metadata)).toThrow('ALREADY_STARTED');
      writeFileSync(path.join(directory, 'older.json'), '{}');
      expect(() => reserveGoldenRunV1(directory, 'older', metadata)).toThrow('ALREADY_STARTED');
      expect(() => reserveGoldenRunV1(directory, '../escape', metadata)).toThrow('RESULT_STEM');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
