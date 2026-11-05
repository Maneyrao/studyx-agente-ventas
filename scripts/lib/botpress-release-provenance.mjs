import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Last commit of claude/agent-a-model-owned-sales that changed deployable code (brain v174, prompt v109).
// Anything committed after it must be docs/evals/tests only (see assertOnlyNonCodeChangesSinceBaseV1), so a release
// prepared from the branch HEAD runs exactly this code. Re-pin whenever a code file changes.
export const BOT_RELEASE_BASE_SHA = '5d834a67642987f58ea1ccc4d58b9b9ef686ffc3';
export const BOT_RELEASE_BRAIN_VERSION = 'studyx-agent-a-brain-v174';
export const BOT_RELEASE_PROMPT_VERSION = 'studyx-agent-a-canonical-v109';
export const BOT_RELEASE_INSTRUMENTATION_VERSION = 'studyx-release-provenance-v1';
export const BOT_RELEASE_SOURCE_PATHS = Object.freeze([
  'botpress-agent/src/lib/observability/persist-turn-evidence.ts',
  'botpress-agent/src/workflows/processInboundTurn.ts',
  'botpress-agent/src/workflows/processPostSale.ts',
]);
const REVIEWED_SOURCE_HASHES = Object.freeze({
  [BOT_RELEASE_SOURCE_PATHS[0]]: 'c1a85e1d95000cd56f885e02d3cf900d7900ea5102b08ed51910500387c2de93',
  [BOT_RELEASE_SOURCE_PATHS[1]]: 'dddece68a6cdedc8264cb967463c98b8e66c6112418dfdc157a07c13f1f1ab18',
  [BOT_RELEASE_SOURCE_PATHS[2]]: '77809dcfbf8e605affe2eeb746f56bcf5ce91ca07ef05726ec5fe20111c07fd2',
});
// Paths that may change after the pinned base without altering what is deployed.
const NON_CODE_EXACT = new Set(['AGENTS.md', 'scripts/lib/botpress-release-provenance.mjs', 'scripts/prepare-instrumented-botpress-release.mjs']);
const NON_CODE_PREFIXES = ['docs/', 'evals/', 'tests/'];

/** Guard: the branch HEAD may only differ from the pinned base in docs, evals, tests, AGENTS.md and these tools. */
export function assertOnlyNonCodeChangesSinceBaseV1(changedPaths) {
  const offending = changedPaths.filter(file => !NON_CODE_EXACT.has(file) && !NON_CODE_PREFIXES.some(prefix => file.startsWith(prefix)));
  if (offending.length) throw new Error(`CODE_CHANGED_SINCE_RELEASE_BASE:${offending.slice(0, 5).join(',')}`);
}

/** Guard: the labels written into the provenance must be the ones the pinned code declares. */
export function assertReleaseLabelsMatchCodeV1({ brainSource, promptSource }) {
  if (!brainSource.includes(`AGENT_A_BRAIN_PROMPT_VERSION = '${BOT_RELEASE_BRAIN_VERSION}'`)
    || !promptSource.includes(`STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION = '${BOT_RELEASE_PROMPT_VERSION}'`)) {
    throw new Error('RELEASE_LABELS_MISMATCH_CODE');
  }
}

const GENERATED_PATH = 'botpress-agent/src/lib/observability/release-provenance.generated.ts';
const hash = value => createHash('sha256').update(value).digest('hex');
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const fail = () => { throw new Error('PROVENANCE_ANCHOR_MISMATCH'); };
const propertyName = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;
const parse = (path, text) => {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) fail();
  return file;
};
const synthesize = node => {
  ts.setTextRange(node, { pos: -1, end: -1 });
  node.flags |= ts.NodeFlags.Synthesized;
  ts.forEachChild(node, child => { synthesize(child); });
  return node;
};
const statement = text => synthesize(parse('instrumentation.ts', text).statements[0]);
const expression = text => statement(`const value = ${text};`).declarationList.declarations[0].initializer;
const importStatement = (names, path) => statement(`import { ${names.join(', ')} } from ${JSON.stringify(path)};`);

function generatedSource(provenance) {
  return `// Generated build instrumentation, separate from the frozen application base.\n`
    + `export const RELEASE_PROVENANCE = Object.freeze(${JSON.stringify(provenance, null, 2)});\n`
    + `export function logReleaseEntry(subjectType: 'turn' | 'post_sale', input: unknown, workflowId: unknown): void {\n`
    + `  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};\n`
    + `  const safe = (key: string) => typeof value[key] === 'string' ? value[key] : null;\n`
    + `  console.info(JSON.stringify({ event: 'studyx.release.entry', ...RELEASE_PROVENANCE,\n`
    + `    subject_type: subjectType, trace_id: safe('trace_id'), external_message_id: safe('external_message_id'),\n`
    + `    conversation_id: safe('botpress_conversation_id') ?? safe('conversation_id'), notification_id: safe('notification_id'),\n`
    + `    workflow_id: typeof workflowId === 'string' ? workflowId : null }));\n}\n`
    + `console.info(JSON.stringify({ event: 'studyx.release.loaded', ...RELEASE_PROVENANCE }));\n`;
}

function instrumentPersistence(source) {
  let anchors = 0;
  let importAnchors = 0;
  const result = ts.transform(source, [context => root => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === './turn-evidence') {
        const bindings = node.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) fail();
        const named = bindings.elements.filter(item => item.name.text !== 'BOTPRESS_EVIDENCE_VERSION');
        if (named.length !== bindings.elements.length - 1) fail();
        importAnchors++;
        return ts.factory.updateImportDeclaration(node, node.modifiers,
          ts.factory.updateImportClause(node.importClause, node.importClause.isTypeOnly,
            node.importClause.name, ts.factory.updateNamedImports(bindings, named)), node.moduleSpecifier, node.attributes);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'requestStudyxJson') {
        if (node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) fail();
        const request = node.arguments[0];
        const bodies = request.properties.filter(p => ts.isPropertyAssignment(p) && propertyName(p.name) === 'body');
        if (bodies.length !== 1 || !ts.isObjectLiteralExpression(bodies[0].initializer)) fail();
        const body = bodies[0].initializer;
        const versions = body.properties.filter(p => ts.isPropertyAssignment(p) && propertyName(p.name) === 'botpress_version');
        if (versions.length !== 1 || !ts.isIdentifier(versions[0].initializer)
          || versions[0].initializer.text !== 'BOTPRESS_EVIDENCE_VERSION'
          || body.properties.some(p => ts.isPropertyAssignment(p) && propertyName(p.name) === 'data')) fail();
        anchors++;
        const bodyProperties = body.properties.map(p => p === versions[0]
          ? ts.factory.updatePropertyAssignment(p, p.name, expression('RELEASE_PROVENANCE.source_base_sha')) : p);
        bodyProperties.push(ts.factory.createPropertyAssignment('data',
          expression('({ ...event.data, release_provenance: RELEASE_PROVENANCE })')));
        const newBody = ts.factory.updatePropertyAssignment(bodies[0], bodies[0].name,
          ts.factory.updateObjectLiteralExpression(body, bodyProperties));
        return ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
          [ts.factory.updateObjectLiteralExpression(request, ts.factory.createNodeArray(
            request.properties.map(p => p === bodies[0] ? newBody : p), request.properties.hasTrailingComma))]);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit);
  }]);
  try {
    if (anchors !== 1 || importAnchors !== 1) fail();
    const output = result.transformed[0];
    return printer.printFile(ts.factory.updateSourceFile(output,
      [importStatement(['RELEASE_PROVENANCE'], './release-provenance.generated'), ...output.statements]));
  } finally { result.dispose(); }
}

function instrumentWorkflow(source, variableName, kind) {
  let anchors = 0;
  const initialLog = statement(`logReleaseEntry(${JSON.stringify(kind)}, input, workflow?.id);`);
  const result = ts.transform(source, [context => root => {
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
        const init = node.initializer;
        if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'Workflow'
          || init.arguments?.length !== 1 || !ts.isObjectLiteralExpression(init.arguments[0])) fail();
        const definition = init.arguments[0];
        const handlers = definition.properties.filter(p => propertyName(p.name) === 'handler');
        if (handlers.length !== 1) fail();
        const handler = handlers[0];
        let updated;
        if (ts.isMethodDeclaration(handler) && handler.body) {
          updated = ts.factory.updateMethodDeclaration(handler, handler.modifiers, handler.asteriskToken,
            handler.name, handler.questionToken, handler.typeParameters, handler.parameters, handler.type,
            ts.factory.updateBlock(handler.body, [initialLog, ...handler.body.statements]));
        } else if (ts.isPropertyAssignment(handler) && ts.isArrowFunction(handler.initializer)
          && ts.isBlock(handler.initializer.body)) {
          const fn = handler.initializer;
          updated = ts.factory.updatePropertyAssignment(handler, handler.name,
            ts.factory.updateArrowFunction(fn, fn.modifiers, fn.typeParameters, fn.parameters, fn.type,
              fn.equalsGreaterThanToken, ts.factory.updateBlock(fn.body, [initialLog, ...fn.body.statements])));
        } else fail();
        anchors++;
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.updateNewExpression(init, init.expression, init.typeArguments,
            [ts.factory.updateObjectLiteralExpression(definition, ts.factory.createNodeArray(
              definition.properties.map(p => p === handler ? updated : p), definition.properties.hasTrailingComma))]));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit);
  }]);
  try {
    if (anchors !== 1) fail();
    const output = result.transformed[0];
    return printer.printFile(ts.factory.updateSourceFile(output,
      [importStatement(['logReleaseEntry'], '../lib/observability/release-provenance.generated'), ...output.statements]));
  } finally { result.dispose(); }
}

/** The caller supplies a frozen source snapshot; this function never mutates it. */
export function instrumentBotpressReleaseSources({ sourceBaseSha, instrumentationSha256, sources }) {
  if (sourceBaseSha !== BOT_RELEASE_BASE_SHA) throw new Error('UNREVIEWED_SOURCE_BASE');
  if (!/^[a-f0-9]{64}$/u.test(instrumentationSha256 ?? '')) throw new Error('INVALID_INSTRUMENTATION_SHA256');
  if (BOT_RELEASE_SOURCE_PATHS.some(path => typeof sources?.[path] !== 'string') || sources[GENERATED_PATH]) fail();
  if (BOT_RELEASE_SOURCE_PATHS.some(path => hash(sources[path]) !== REVIEWED_SOURCE_HASHES[path])) {
    throw new Error('SOURCE_BASE_CONTENT_MISMATCH');
  }
  const provenance = Object.freeze({ source_base_sha: sourceBaseSha,
    instrumentation_version: BOT_RELEASE_INSTRUMENTATION_VERSION, instrumentation_sha256: instrumentationSha256,
    brain_version: BOT_RELEASE_BRAIN_VERSION, prompt_version: BOT_RELEASE_PROMPT_VERSION });
  const patched = {
    [BOT_RELEASE_SOURCE_PATHS[0]]: instrumentPersistence(parse(BOT_RELEASE_SOURCE_PATHS[0], sources[BOT_RELEASE_SOURCE_PATHS[0]])),
    [BOT_RELEASE_SOURCE_PATHS[1]]: instrumentWorkflow(parse(BOT_RELEASE_SOURCE_PATHS[1], sources[BOT_RELEASE_SOURCE_PATHS[1]]), 'processInboundTurn', 'turn'),
    [BOT_RELEASE_SOURCE_PATHS[2]]: instrumentWorkflow(parse(BOT_RELEASE_SOURCE_PATHS[2], sources[BOT_RELEASE_SOURCE_PATHS[2]]), 'processPostSale', 'post_sale'),
    [GENERATED_PATH]: generatedSource(provenance),
  };
  return { sources: patched, generatedPath: GENERATED_PATH, provenance,
    manifest: { schema_version: 1, ...provenance, prepared_source_is_instrumented: true,
      changed_sources: BOT_RELEASE_SOURCE_PATHS.map(path => ({ path, before_sha256: hash(sources[path]), after_sha256: hash(patched[path]) })),
      generated_sources: [{ path: GENERATED_PATH, sha256: hash(patched[GENERATED_PATH]) }], published: false } };
}

/** Source identity and actual bundle bytes are intentionally different fields. */
export function finalizeBotpressReleaseManifest(manifest, bundle) {
  const content = bundle.toString('utf8');
  for (const marker of [manifest.source_base_sha, manifest.instrumentation_sha256, 'studyx.release.loaded', 'studyx.release.entry']) {
    if (typeof marker !== 'string' || !marker.length || !content.includes(marker)) throw new Error('BUNDLE_PROVENANCE_NOT_FOUND');
  }
  return { ...manifest, artifact_sha256: hash(bundle), artifact_bytes: bundle.length, published: false };
}

// Entire prepared repository, including locks/configuration/catalog/prompts.
// Build outputs, local credentials and version receipts are explicit exclusions.
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '.next', '.adk', '.vercel', '.eval', '.local-evidence', '.turbo']);
const EXCLUDED_ROOT_FILES = new Set(['release-provenance.manifest.json', 'release-provenance.bundle-manifest.json', 'release-provenance.build-receipt.json']);
const excludedFile = relative => {
  const name = path.posix.basename(relative);
  return EXCLUDED_ROOT_FILES.has(relative) || name === '.DS_Store' || name === 'next-env.d.ts'
    || name.endsWith('.tsbuildinfo') || name === 'agent.local.json'
    || (name.startsWith('.env') && !name.endsWith('.example') && name !== '.env.template');
};

export function snapshotReleaseSources(directory) {
  const files = [];
  const links = [];
  const walk = relative => {
    for (const item of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, item.name);
      if (EXCLUDED_DIRECTORIES.has(item.name) || excludedFile(child)) continue;
      if (item.isSymbolicLink()) {
        // Tracked editor skill links are not runtime input. Hash their literal
        // targets without following them outside the prepared tree.
        if (!child.startsWith('.claude/skills/')) throw new Error('SOURCE_SYMLINK_NOT_ALLOWED');
        links.push({ path: child, sha256: hash(readlinkSync(path.join(directory, child))), kind: 'symlink' });
        continue;
      }
      if (item.isDirectory()) walk(child);
      else if (item.isFile()) files.push(child);
    }
  };
  walk('');
  return [...files.map(file => ({ path: file, sha256: hash(readFileSync(path.join(directory, file))), kind: 'file' })), ...links]
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function assertReleaseSourcesUnchanged(directory, expectedInventory) {
  if (JSON.stringify(snapshotReleaseSources(directory)) !== JSON.stringify(expectedInventory)) {
    throw new Error('PREPARED_SOURCE_TREE_CHANGED');
  }
}
