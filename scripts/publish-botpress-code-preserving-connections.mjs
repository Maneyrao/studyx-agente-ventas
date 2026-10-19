/**
 * Transport-only publication. Run with Bun from botpress-agent; default is read-only.
 * --publish permits updating ONLY code after a fresh production build and contract checks.
 * A change to API contracts/dependencies must use a separately reviewed full deployment.
 * SDK entry points are pinned to installed ADK 2.0.6; fail closed after SDK upgrades.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const expectedBotId = '0d7c9ecb-4781-4c65-913d-f7e947fa14d4';
const expectedWorkspaceId = 'wkspace_01M4XEBZNC10HX2KDHKY36T6R0';
const expectedProfile = process.env.STUDYX_BOTPRESS_PROFILE ?? 'vertice';
const root = process.cwd();
const outputDirectory = process.env.STUDYX_RELEASE_EVIDENCE_DIR;
const publish = process.argv.includes('--publish');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const assert = (condition, reason) => { if (!condition) throw new Error(reason); };
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const record = (filename, data) => fs.writeFileSync(path.join(outputDirectory, filename),
  JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
const protectedConfiguration = (bot) => ({
  integrations: bot.integrations, plugins: bot.plugins, configuration: bot.configuration,
  secretNames: [...bot.secrets].sort(), name: bot.name, blocked: bot.blocked,
});

try {
  assert(outputDirectory && path.isAbsolute(outputDirectory), 'ABSOLUTE_EVIDENCE_DIRECTORY_REQUIRED');
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const sdkPackage = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@botpress/adk-cli/package.json'), 'utf8'));
  assert(sdkPackage.version === '2.0.6', 'UNREVIEWED_ADK_VERSION');
  const { auth } = await load('node_modules/@botpress/adk-cli/dist/chunk-dcbcz1ws.js');
  auth.setProfileOverride(expectedProfile);
  const { resolveCommandContext } = await load('node_modules/@botpress/adk-cli/dist/chunk-wddbs9hm.js');
  const { refreshDependencySnapshotOnce } = await load('node_modules/@botpress/adk-cli/dist/chunk-rq2e6ba8.js');
  const { adkBuild } = await load('node_modules/@botpress/adk-cli/dist/chunk-p4ar5kkm.js');
  const { Client } = await load('node_modules/@botpress/client/dist/index.cjs');
  const { prepareCreateBotBody } = await load('node_modules/@botpress/cli/dist/api/bot-body.js');
  const ctx = await resolveCommandContext({ target: 'prod', projectLoadOptions: { adkCommand: 'adk-deploy' },
    require: ['project', 'credentials', 'workspace', 'bot'] });
  assert(ctx.botId === expectedBotId && ctx.workspaceId === expectedWorkspaceId, 'DESTINATION_MISMATCH');
  const client = new Client({ ...ctx.credentials, headers: { 'x-multiple-integrations': 'true' } });
  const before = (await client.getBot({ id: ctx.botId })).bot;
  record('bot-before.private.json', before);
  assert(Object.keys(before.integrations).length > 0, 'EMPTY_REMOTE_DEPENDENCIES');
  await refreshDependencySnapshotOnce({ projectPath: root, env: 'prod', botId: ctx.botId, client, required: true });
  await adkBuild({ adkCommand: 'adk-deploy' });
  const { default: definition } = await load('.adk/bot/bot.definition.ts');
  const body = await prepareCreateBotBody(definition);
  const contractDifferences = [];
  for (const field of ['states', 'recurringEvents']) {
    const expected = body[field] ?? {};
    assert(equal(Object.keys(expected).sort(), Object.keys(before[field] ?? {}).sort()), `CONTRACT_KEYS_CHANGED:${field}`);
    for (const [key, value] of Object.entries(expected)) {
      for (const [property, item] of Object.entries(value)) {
        if (!equal(item, before[field]?.[key]?.[property])) contractDifferences.push(`${field}.${key}.${property}`);
      }
    }
  }
  for (const field of ['actions', 'events']) {
    assert(equal(Object.keys(body[field] ?? {}).sort(), Object.keys(before[field] ?? {}).sort()), `CONTRACT_KEYS_CHANGED:${field}`);
    for (const [key, value] of Object.entries(body[field] ?? {})) {
      for (const property of field === 'actions' ? ['input', 'output', 'billable', 'cacheable'] : ['schema']) {
        if (value[property] !== undefined && !equal(value[property], before[field]?.[key]?.[property])) {
          contractDifferences.push(`${field}.${key}.${property}`);
        }
      }
    }
  }
  if (!equal(body.configuration?.schema, before.configuration?.schema)) contractDifferences.push('configuration.schema');
  for (const field of ['user', 'message', 'conversation']) {
    if (!equal(Object.keys(body[field]?.tags ?? {}).sort(), Object.keys(before[field]?.tags ?? {}).sort())) {
      contractDifferences.push(`${field}.tags`);
    }
  }
  assert(contractDifferences.length === 0, `CONTRACT_CHANGED:${contractDifferences.join(',')}`);
  assert(Object.keys(definition.integrations).length === Object.keys(before.integrations).length, 'INTEGRATION_COUNT_CHANGED');
  const aliasesPreserved = [];
  for (const [alias, integration] of Object.entries(definition.integrations)) {
    const instances = Object.entries(before.integrations).filter(([, remote]) => remote.id === integration.id);
    assert(instances.length === 1, `INTEGRATION_ID_MISMATCH:${alias}`);
    const [cloudAlias, remote] = instances[0];
    for (const field of ['enabled', 'configurationType', 'configuration', 'disabledChannels']) {
      const fallback = field === 'configurationType' ? null : field === 'disabledChannels' ? [] : undefined;
      assert(equal(integration[field] ?? fallback, remote[field] ?? fallback), `INTEGRATION_CHANGED:${alias}.${field}`);
    }
    // ADK gives this pre-existing, unused namespaced integration a friendly local alias.
    // Code-only publication deliberately preserves its Cloud instance and webhook.
    assert(alias === cloudAlias || (alias === 'improvement' && cloudAlias === 'agi/improvement'), `ALIAS_CHANGED:${alias}`);
    aliasesPreserved.push({ alias, cloudAlias });
    assert(!remote.enabled || remote.status === 'registered', `CHANNEL_NOT_REGISTERED:${cloudAlias}`);
  }
  assert(Object.keys(definition.plugins).length === Object.keys(before.plugins).length, 'PLUGIN_COUNT_CHANGED');
  for (const [alias, plugin] of Object.entries(definition.plugins)) {
    const remote = before.plugins[alias];
    assert(remote && plugin.id === remote.id && (plugin.enabled ?? true) === remote.enabled, `PLUGIN_ID_OR_STATUS_CHANGED:${alias}`);
    for (const field of ['configuration', 'interfaces', 'integrations']) {
      assert(equal(plugin[field] ?? {}, remote[field] ?? {}), `PLUGIN_CHANGED:${alias}.${field}`);
    }
  }
  assert(!!before.integrations.telegram?.identifier, 'TELEGRAM_AUTHORIZATION_MISSING');
  const bundle = fs.readFileSync(path.join(root, '.adk/bot/.botpress/dist/index.cjs'));
  for (const marker of ['transportRecoveryCanary', 'supports_send_fencing', 'SOURCE_SYNC_PENDING', 'DELIVERY_REPORT_UNCONFIRMED']) {
    assert(bundle.includes(Buffer.from(marker)), `BUNDLE_MARKER_MISSING:${marker}`);
  }
  const current = (await client.getBot({ id: ctx.botId })).bot;
  assert(equal(protectedConfiguration(before), protectedConfiguration(current)) && before.deployedAt === current.deployedAt,
    'REMOTE_CHANGED_DURING_BUILD');
  const preflight = { at: new Date().toISOString(), botId: ctx.botId, workspaceId: ctx.workspaceId,
    bundleSha256: createHash('sha256').update(bundle).digest('hex'), integrationCount: aliasesPreserved.length,
    pluginCount: Object.keys(definition.plugins).length, aliasesPreserved, contractsMatch: true, publish };
  record('preflight.json', preflight);
  if (publish) {
    // Omitting integrations/plugins is deliberate. Never run missing-dependency deletion here.
    await client.updateBot({ id: ctx.botId, code: bundle.toString('utf8') });
    const after = (await client.getBot({ id: ctx.botId })).bot;
    record('bot-after.private.json', after);
    const configurationUnchanged = equal(protectedConfiguration(before), protectedConfiguration(after));
    const result = { ...preflight, deployedAt: after.deployedAt, previousDeployedAt: before.deployedAt,
      configurationUnchanged, codeOnly: true };
    record('publication.json', result);
    assert(configurationUnchanged && after.deployedAt !== before.deployedAt, 'POST_PUBLICATION_PARITY_FAILED');
    console.log(JSON.stringify(result));
  } else console.log(JSON.stringify(preflight));
} catch (error) {
  // Never dump the SDK error object: it may contain credentials or a request body.
  console.error(JSON.stringify({ failed: true, code: error.code, type: error.type,
    reason: error.isApiError ? 'BOTPRESS_API_REJECTED' : String(error.message) }));
  process.exitCode = 1;
}
