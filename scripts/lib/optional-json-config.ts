import { readFile } from 'node:fs/promises';

export async function readOptionalJsonConfig(filePath: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  return JSON.parse(source) as unknown;
}
