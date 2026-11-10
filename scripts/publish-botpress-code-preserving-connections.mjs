/**
 * Narrow publication transport. Run with Bun from botpress-agent; default is read-only.
 * --publish permits updating code plus only the explicitly reviewed additive
 * contracts/configuration after a fresh production build and contract checks.
 * A change to API contracts/dependencies must use a separately reviewed full deployment.
 * SDK entry points are pinned to installed ADK 2.0.8; fail closed after SDK upgrades.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadReviewedBotpressAdk, requireBotpressReleaseProfile } from './lib/botpress-reviewed-adk.mjs';
import {
  buildBotpressAdditiveEventUpdate,
  inspectBotpressRemoteCode,
  normalizeBotpressConfigurationForComparison,
  planBotpressAdditiveConversationTagPatch,
  planBotpressAdditiveEventPatch,
  planBotpressReviewedConfigurationUpdate,
  planBotpressReviewedActionPatch,
} from './lib/botpress-additive-event-contract.mjs';
import {
  STUDYX_RELEASE_DESTINATION,
  assertBotpressReleaseDestination,
  normalizeBotpressIntegrationField,
} from './lib/botpress-release-destination.mjs';

const expectedProfile = process.env.STUDYX_BOTPRESS_PROFILE;
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
  subscriptions: bot.subscriptions, secretNames: [...bot.secrets].sort(), name: bot.name, blocked: bot.blocked,
});

try {
  assert(outputDirectory && path.isAbsolute(outputDirectory), 'ABSOLUTE_EVIDENCE_DIRECTORY_REQUIRED');
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const sdkPackage = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@botpress/adk-cli/package.json'), 'utf8'));
  requireBotpressReleaseProfile(expectedProfile);
  assertBotpressReleaseDestination({
    profile: expectedProfile,
    workspaceId: STUDYX_RELEASE_DESTINATION.workspaceId,
    botId: STUDYX_RELEASE_DESTINATION.botId,
  });
  const { auth, resolveCommandContext, refreshDependencySnapshotOnce, adkBuild }
    = await loadReviewedBotpressAdk(sdkPackage.version, load);
  auth.setProfileOverride(expectedProfile);
  const { Client } = await load('node_modules/@botpress/client/dist/index.cjs');
  const { prepareCreateBotBody } = await load('node_modules/@botpress/cli/dist/api/bot-body.js');
  const ctx = await resolveCommandContext({ target: 'prod', projectLoadOptions: { adkCommand: 'adk-deploy' },
    require: ['project', 'credentials', 'workspace', 'bot'] });
  assertBotpressReleaseDestination({
    profile: expectedProfile,
    botId: ctx.botId,
    workspaceId: ctx.workspaceId,
  });
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
  const actionPatch = planBotpressReviewedActionPatch({
    remoteActions: before.actions ?? {},
    generatedActions: body.actions ?? {},
  });
  const configurationPlan = planBotpressReviewedConfigurationUpdate({
    remoteConfiguration: before.configuration,
    generatedConfiguration: body.configuration,
  });
  const additiveEventPatch = planBotpressAdditiveEventPatch({
    remoteEvents: before.events ?? {},
    generatedEvents: body.events ?? {},
  });
  const additiveEventKeys = Object.keys(additiveEventPatch).sort();
  for (const field of ['user', 'message']) {
    if (!equal(Object.keys(body[field]?.tags ?? {}).sort(), Object.keys(before[field]?.tags ?? {}).sort())) {
      contractDifferences.push(`${field}.tags`);
    }
  }
  const conversationTagPatch = planBotpressAdditiveConversationTagPatch({
    remoteTags: before.conversation?.tags ?? {},
    generatedTags: body.conversation?.tags ?? {},
  });
  const additiveConversationTagKeys = Object.keys(conversationTagPatch).sort();
  assert(contractDifferences.length === 0, `CONTRACT_CHANGED:${contractDifferences.join(',')}`);
  assert(Object.keys(definition.integrations).length === Object.keys(before.integrations).length, 'INTEGRATION_COUNT_CHANGED');
  const aliasesPreserved = [];
  for (const [alias, integration] of Object.entries(definition.integrations)) {
    const instances = Object.entries(before.integrations).filter(([, remote]) => remote.id === integration.id);
    assert(instances.length === 1, `INTEGRATION_ID_MISMATCH:${alias}`);
    const [cloudAlias, remote] = instances[0];
    for (const field of ['enabled', 'configurationType', 'configuration', 'disabledChannels']) {
      const fallback = field === 'configurationType' ? null : field === 'disabledChannels' ? [] : undefined;
      assert(equal(
        normalizeBotpressIntegrationField(alias, field, integration[field] ?? fallback),
        normalizeBotpressIntegrationField(alias, field, remote[field] ?? fallback),
      ), `INTEGRATION_CHANGED:${alias}.${field}`);
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
  assert(before.integrations.telegram?.enabled !== true || !!before.integrations.telegram?.identifier,
    'TELEGRAM_AUTHORIZATION_MISSING');
  const bundle = fs.readFileSync(path.join(root, '.adk/bot/.botpress/dist/index.cjs'));
  for (const marker of ['transportRecoveryCanary', 'supports_send_fencing', 'SOURCE_SYNC_PENDING', 'DELIVERY_REPORT_UNCONFIRMED']) {
    assert(bundle.includes(Buffer.from(marker)), `BUNDLE_MARKER_MISSING:${marker}`);
  }
  const current = (await client.getBot({ id: ctx.botId })).bot;
  assert(equal(protectedConfiguration(before), protectedConfiguration(current))
    && equal(before.events ?? {}, current.events ?? {})
    && equal(before.actions ?? {}, current.actions ?? {})
    && equal(before.states ?? {}, current.states ?? {})
    && equal(before.recurringEvents ?? {}, current.recurringEvents ?? {})
    && equal(before.conversation?.tags ?? {}, current.conversation?.tags ?? {})
    && before.deployedAt === current.deployedAt,
    'REMOTE_CHANGED_DURING_BUILD');
  const bundleSha256 = createHash('sha256').update(bundle).digest('hex');
  const preflight = { at: new Date().toISOString(), profile: expectedProfile, adkVersion: sdkPackage.version, botId: ctx.botId, workspaceId: ctx.workspaceId,
    bundleSha256, remoteCodeEvidence: inspectBotpressRemoteCode({
      remoteCode: before.code,
      expectedSha256: bundleSha256,
    }), integrationCount: aliasesPreserved.length,
    pluginCount: Object.keys(definition.plugins).length, aliasesPreserved, contractsMatch: true,
    additiveEventKeys, additiveConversationTagKeys,
    reviewedActionKeys: Object.keys(actionPatch).sort(),
    reviewedConfigurationKeys: configurationPlan.changed ? ['agentACommercialPlanningEnabled'] : [],
    commercialPlanningEnabled: configurationPlan.configuration.data?.agentACommercialPlanningEnabled ?? null,
    publicationMode: additiveEventKeys.length > 0
      || additiveConversationTagKeys.length > 0
      || Object.keys(actionPatch).length > 0
      || configurationPlan.changed
      ? 'code+reviewed-contract' : 'code-only', publish };
  record('preflight.json', preflight);
  if (publish) {
    // Omitting integrations/plugins/secrets is deliberate. Never run
    // missing-dependency deletion here. Configuration is sent only when the
    // exact reviewed commercial-planning addition was derived from the fresh
    // remote snapshot; every other contract/configuration delta fails closed.
    const update = buildBotpressAdditiveEventUpdate({
      botId: ctx.botId,
      code: bundle.toString('utf8'),
      eventPatch: additiveEventPatch,
      conversationTagPatch,
      actionPatch,
      configurationPlan,
    });
    await client.updateBot(update);
    const after = (await client.getBot({ id: ctx.botId })).bot;
    record('bot-after.private.json', after);
    const expectedProtectedConfiguration = {
      ...protectedConfiguration(before),
      configuration: normalizeBotpressConfigurationForComparison(configurationPlan.configuration),
    };
    const configurationMatchesExpected = equal(expectedProtectedConfiguration, protectedConfiguration(after));
    const configurationUnchanged = equal(before.configuration, after.configuration);
    const configurationContractCurrent = !planBotpressReviewedConfigurationUpdate({
      remoteConfiguration: after.configuration,
      generatedConfiguration: body.configuration,
    }).changed;
    const eventContractCurrent = Object.keys(planBotpressAdditiveEventPatch({
      remoteEvents: after.events ?? {},
      generatedEvents: body.events ?? {},
    })).length === 0;
    const conversationTagContractCurrent = Object.keys(planBotpressAdditiveConversationTagPatch({
      remoteTags: after.conversation?.tags ?? {},
      generatedTags: body.conversation?.tags ?? {},
    })).length === 0;
    const actionContractCurrent = Object.keys(planBotpressReviewedActionPatch({
      remoteActions: after.actions ?? {},
      generatedActions: body.actions ?? {},
    })).length === 0;
    const remoteCodeEvidence = inspectBotpressRemoteCode({
      remoteCode: after.code,
      expectedSha256: preflight.bundleSha256,
    });
    const remoteCodeMatches = remoteCodeEvidence.matches;
    const result = { ...preflight, deployedAt: after.deployedAt, previousDeployedAt: before.deployedAt,
      configurationUnchanged, configurationMatchesExpected, configurationContractCurrent,
      eventContractCurrent, conversationTagContractCurrent,
      actionContractCurrent,
      remoteCodeEvidence, remoteCodeMatches,
      codeOnly: additiveEventKeys.length === 0
        && additiveConversationTagKeys.length === 0
        && Object.keys(actionPatch).length === 0
        && !configurationPlan.changed };
    record('publication.json', result);
    assert(configurationMatchesExpected && configurationContractCurrent
      && eventContractCurrent && conversationTagContractCurrent
      && actionContractCurrent
      && remoteCodeMatches !== false
      && after.deployedAt !== before.deployedAt, 'POST_PUBLICATION_PARITY_FAILED');
    console.log(JSON.stringify(result));
  } else console.log(JSON.stringify(preflight));
} catch (error) {
  // Never dump the SDK error object: it may contain credentials or a request body.
  const apiDiagnostic = error.isApiError ? {
    errorId: typeof error.id === 'string' ? error.id : undefined,
    errorTimestamp: typeof error.timestamp === 'string' ? error.timestamp : undefined,
    description: typeof error.description === 'string' ? error.description : undefined,
  } : {};
  console.error(JSON.stringify({ failed: true, code: error.code, type: error.type,
    reason: error.isApiError ? 'BOTPRESS_API_REJECTED' : String(error.message), ...apiDiagnostic }));
  process.exitCode = 1;
}
