import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readOptionalJsonConfig } from '../../../scripts/lib/optional-json-config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('readOptionalJsonConfig', () => {
  it('treats a missing local secrets file as an empty optional source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studyx-optional-json-'));
    temporaryDirectories.push(directory);

    await expect(readOptionalJsonConfig(path.join(directory, 'missing.json'))).resolves.toEqual({});
  });

  it('parses an existing source and still fails closed on invalid JSON', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studyx-optional-json-'));
    temporaryDirectories.push(directory);
    const validPath = path.join(directory, 'valid.json');
    const invalidPath = path.join(directory, 'invalid.json');
    await writeFile(validPath, '{"dev":{"TOKEN":"configured"}}', 'utf8');
    await writeFile(invalidPath, '{', 'utf8');

    await expect(readOptionalJsonConfig(validPath)).resolves.toEqual({
      dev: { TOKEN: 'configured' },
    });
    await expect(readOptionalJsonConfig(invalidPath)).rejects.toBeInstanceOf(SyntaxError);
  });
});
