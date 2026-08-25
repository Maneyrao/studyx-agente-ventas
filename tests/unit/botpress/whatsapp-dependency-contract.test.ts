import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
const contractPath = join(process.cwd(), 'docs/runbooks/whatsapp-integration-contract.md');

describe('WhatsApp dependency contract', () => {
  it('keeps Botpress local dependency and secret files out of git', () => {
    for (const ignoredPath of [
      '/botpress-agent/.adk/dependencies/',
      '/botpress-agent/.adk/secrets.json',
      '/botpress-agent/agent.local.json',
    ]) {
      expect(gitignore).toContain(ignoredPath);
    }
  });

  it('pins the public WhatsApp runtime contract without configuration values', () => {
    expect(existsSync(contractPath), 'the secret-free contract fixture must exist').toBe(true);
    if (!existsSync(contractPath)) return;

    const contract = readFileSync(contractPath, 'utf8');
    for (const expected of [
      'whatsapp@4.18.5',
      'whatsapp.channel',
      'whatsapp:userPhone',
      'whatsapp:botPhoneNumberId',
      'whatsapp:replyTo',
      'sandbox',
      'manual',
      'development and production',
    ]) {
      expect(contract).toContain(expected);
    }
    const secretPattern = new RegExp([
      'EA[A-Za-z0-9]{20,}',
      'sk' + '_live_',
      'sk' + '_test_',
      'wh' + 'sec_',
      'BEGIN' + ' PRIVATE KEY',
    ].join('|'));
    expect(contract).not.toMatch(secretPattern);
  });
});
