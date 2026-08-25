import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const runbookPath = resolve(root, 'docs/runbooks/whatsapp-go-live.md');
const readRunbook = () => readFileSync(runbookPath, 'utf8');

function expectInOrder(text: string, fragments: readonly string[]) {
  let previous = -1;
  for (const fragment of fragments) {
    const current = text.indexOf(fragment);
    expect(current, `missing or out-of-order: ${fragment}`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe('WhatsApp go-live runbook', () => {
  it('keeps today limited to a controlled sandbox demo and blocks Task 5', () => {
    const runbook = readRunbook();

    expect(runbook).toMatch(/sandbox.*demo/i);
    expect(runbook).toContain('20/50');
    expect(runbook).toMatch(/Task 5[\s\S]*blocked[\s\S]*explicit authorization/i);
    expect(runbook).toMatch(/not production/i);
  });

  it('lists all required backend, Botpress, Meta, Stripe, and Sheets configuration names without values', () => {
    const runbook = readRunbook();
    const names = [
      'DATABASE_URL', 'ORCHESTRATOR_API_KEY', 'ORCHESTRATOR_KEY_ID', 'STUDYX_SIGNING_SECRET',
      'CRON_SECRET', 'GEMINI_API_KEY', 'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY',
      'GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SHEETS_TAB_NAME',
      'PAYMENT_PROVIDER=stripe_test', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'STRIPE_SUCCESS_URL', 'STRIPE_CANCEL_URL', 'STUDYX_ORCHESTRATOR_KEY',
      'PAYMENT_LINK_12M', 'PAYMENT_LINK_6M', 'PAYMENT_LINK_CONTADO',
      'WHATSAPP_CANARY_PHONE_E164S', 'apiBaseUrl', 'orchestratorKeyId',
      'automationEnabled', 'whatsappCanaryEnabled', 'Verify Token', 'Access Token',
      'Client Secret', 'Default Bot Phone Number ID', 'WABA ID',
    ];

    for (const name of names) expect(runbook).toContain(name);
    expect(runbook).toMatch(/Facebook account/i);
    expect(runbook).toMatch(/Facebook business page/i);
    expect(runbook).toMatch(/WhatsApp Business Account/i);
    expect(runbook).toMatch(/Meta business verification/i);
    expect(runbook).toMatch(/approved\/test phone/i);
    expect(runbook).toMatch(/official.*Botpress.*integration/i);
    expect(runbook).toMatch(/Botpress\/Meta control panels/i);
  });

  it('defines separately authorized, auditable Botpress deploy procedures that begin disabled', () => {
    const runbook = readRunbook();
    const development = runbook.slice(
      runbook.indexOf('### Development Botpress deployment procedure'),
      runbook.indexOf('### Production Botpress deployment procedure'),
    );
    const production = runbook.slice(runbook.indexOf('### Production Botpress deployment procedure'));

    for (const procedure of [development, production]) {
      expect(procedure).toMatch(/separate explicit .*deployment authorization/i);
      expectInOrder(procedure, [
        'automationEnabled=false',
        'whatsappCanaryEnabled=false',
        '/api/health',
        '/api/ready',
        'adk deploy',
        'Rollback',
      ]);
      expect(procedure).toMatch(/audit record/i);
      expect(procedure).toMatch(/no external mutation until authorized/i);
    }
    expect(development).toMatch(/development environment/i);
    expect(production).toMatch(/production environment/i);
  });

  it('orders the controlled promotion, deployment, and production-preview gates', () => {
    const runbook = readRunbook();

    expectInOrder(runbook.slice(runbook.indexOf('## 3. Controlled promotion sequence')), [
      'local 50/50',
      'npm run build',
      'npm --prefix botpress-agent run build',
      'backend staging deployment',
      '/api/health',
      '/api/ready',
      'Botpress development integration/playground',
      'one-number development canary',
      'adk integrations copy --from dev --to prod --dry-run',
      'production secret/config verification',
      'production code deploy with automation disabled',
      'one-number production canary',
      'general availability approval',
    ]);
    expect(runbook).toContain('adk build');
    expect(runbook).toContain('adk deploy');
    expect(runbook).toMatch(/GET \/api\/health[\s\S]*liveness/i);
    expect(runbook).toMatch(/GET \/api\/ready[\s\S]*readiness/i);
  });

  it('has distinct canary, availability, and rollback gates with an eight-scenario, no-PII evidence script', () => {
    const runbook = readRunbook();

    for (const heading of ['Development canary', 'Production canary', 'General availability', 'Rollback']) {
      expect(runbook).toContain(heading);
    }
    for (const scenario of [
      'greeting', 'known course facts', 'area navigation', 'direct call request',
      'call decline and continued chat', 'explicit payment with Stripe test link',
      'deferred payment with no link', 'opt-out acknowledgement followed by silence',
    ]) expect(runbook).toContain(scenario);
    expect(runbook).toMatch(/no PII|sin PII/i);
    expect(runbook).toMatch(/trace_id/i);
    expect(runbook).toMatch(/hash/i);
    expect(runbook).toMatch(/Stripe webhook.*verif/i);
    expect(runbook).toMatch(/Google Sheets.*projection.*verif/i);
    expect(runbook).toMatch(/Meta\/Botpress.*integration.*status/i);
    expectInOrder(runbook, [
      'automationEnabled=false',
      'disable the WhatsApp integration',
      'preserve database/audit evidence',
      'do not delete conversations, contacts, outbox rows, or migrations',
      'submitted_to_botpress',
    ]);
  });

  it('keeps all new runbook links to local documentation resolvable', () => {
    const runbook = readRunbook();
    const links = [...runbook.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)#]+)(?:#[^)]+)?\)/g)]
      .map((match) => match[1]);

    expect(existsSync(runbookPath)).toBe(true);
    for (const link of links) expect(existsSync(resolve(runbookPath, '..', link))).toBe(true);
  });

  it('requires the value-safe runtime attestation and pre-workflow canary gate', () => {
    const runbook = readRunbook();

    expect(runbook).toContain('adk run ./scripts/attest-whatsapp-canary.ts');
    expect(runbook).toContain('{"valid":true,"count":1}');
    expect(runbook).toMatch(/before.*workflow.*ingest.*decision.*call.*send/i);
    expect(runbook).toMatch(/never.*phone.*secret.*value/i);
  });
});
