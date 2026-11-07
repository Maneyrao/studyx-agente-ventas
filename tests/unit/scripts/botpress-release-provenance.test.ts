import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import {
  instrumentBotpressReleaseSources,
  finalizeBotpressReleaseManifest,
  BOT_RELEASE_BASE_SHA,
  BOT_RELEASE_SOURCE_PATHS, snapshotReleaseSources, assertReleaseSourcesUnchanged,
  assertOnlyNonCodeChangesSinceBaseV1, assertReleaseLabelsMatchCodeV1, BOT_RELEASE_BRAIN_VERSION, BOT_RELEASE_PROMPT_VERSION,
} from '../../../scripts/lib/botpress-release-provenance.mjs';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sources = Object.fromEntries(BOT_RELEASE_SOURCE_PATHS.map((file: string) => [file,
  execFileSync('git', ['show', `${BOT_RELEASE_BASE_SHA}:${file}`], { encoding: 'utf8' })]));
const toolHash = hash('reviewed-test-instrumentation');
const prepared = () => instrumentBotpressReleaseSources({ sourceBaseSha: BOT_RELEASE_BASE_SHA,
  instrumentationSha256: toolHash, sources });
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;

function loadGenerated(source: string, log: ReturnType<typeof vi.fn>) {
  const exports: Record<string, unknown> = {};
  new Function('exports', 'console', compile(source))(exports, { info: log });
  return exports as { RELEASE_PROVENANCE: Record<string, string>;
    logReleaseEntry: (kind: string, input: unknown, workflow: unknown) => void };
}

describe('instrumented Botpress release provenance from the reviewed source commit', () => {
  it('preserves original sources and gives the instrumented artifact a separate provenance', () => {
    const original = structuredClone(sources);
    const result = prepared();
    expect(sources).toEqual(original);
    expect(result.manifest.source_base_sha).toBe(BOT_RELEASE_BASE_SHA);
    expect(result.manifest.instrumentation_sha256).toBe(toolHash);
    expect(result.manifest).not.toHaveProperty('source_sha');
    expect(result.manifest.changed_sources).toHaveLength(3);
    for (const change of result.manifest.changed_sources) {
      expect(change.before_sha256).toBe(hash(sources[change.path]));
      expect(change.after_sha256).toBe(hash(result.sources[change.path]));
      const parsed = ts.createSourceFile(change.path, result.sources[change.path], ts.ScriptTarget.Latest, true);
      expect((parsed as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
    }
  });

  it.each(BOT_RELEASE_SOURCE_PATHS)('preserves every other application statement in %s', (file: string) => {
    const result = prepared();
    const original = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true);
    const transformed = ts.createSourceFile(file, result.sources[file], ts.ScriptTarget.Latest, true);
    const restored = ts.transform(transformed, [context => root => {
      const visit: ts.Visitor<ts.Node, ts.Node | undefined> = node => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
          && node.moduleSpecifier.text.endsWith('release-provenance.generated')) return undefined;
        if (file === BOT_RELEASE_SOURCE_PATHS[0]) {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
            && node.moduleSpecifier.text === './turn-evidence' && node.importClause?.namedBindings
            && ts.isNamedImports(node.importClause.namedBindings)) {
            return ts.factory.updateImportDeclaration(node, node.modifiers,
              ts.factory.updateImportClause(node.importClause, node.importClause.isTypeOnly, node.importClause.name,
                ts.factory.updateNamedImports(node.importClause.namedBindings,
                  [ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier('BOTPRESS_EVIDENCE_VERSION')),
                    ...node.importClause.namedBindings.elements])), node.moduleSpecifier, node.attributes);
          }
          if (ts.isPropertyAssignment(node) && node.name.getText(transformed) === 'botpress_version') {
            return ts.factory.updatePropertyAssignment(node, node.name, ts.factory.createIdentifier('BOTPRESS_EVIDENCE_VERSION'));
          }
          if (ts.isPropertyAssignment(node) && node.name.getText(transformed) === 'data') return undefined;
        }
        if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'logReleaseEntry') return undefined;
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit) as ts.SourceFile;
    }]);
    try {
      const print = ts.createPrinter({ removeComments: true });
      expect(print.printFile(restored.transformed[0] as ts.SourceFile)).toBe(print.printFile(original));
    } finally { restored.dispose(); }
  });

  it('emits safe boot and pre-claim entry logs without exposing input text or credentials', () => {
    const result = prepared();
    const info = vi.fn();
    const generated = loadGenerated(result.sources[result.generatedPath], info);
    generated.logReleaseEntry('turn', { trace_id: 'trace', external_message_id: 'message',
      botpress_conversation_id: 'conversation', text: 'PRIVATE CLIENT TEXT', password: 'SECRET' }, 'workflow');
    expect(info).toHaveBeenCalledTimes(2);
    const [boot, entry] = info.mock.calls.map(([line]) => JSON.parse(line));
    expect(boot).toMatchObject({ event: 'studyx.release.loaded', source_base_sha: BOT_RELEASE_BASE_SHA,
      instrumentation_sha256: toolHash, brain_version: 'studyx-agent-a-brain-v202',
      prompt_version: 'studyx-agent-a-canonical-v118' });
    expect(entry).toMatchObject({ event: 'studyx.release.entry', subject_type: 'turn', trace_id: 'trace',
      external_message_id: 'message', conversation_id: 'conversation', workflow_id: 'workflow' });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE CLIENT TEXT|SECRET/);
    expect(() => generated.logReleaseEntry('turn', null, undefined)).not.toThrow();
  });

  it.each([
    ['botpress-agent/src/workflows/processInboundTurn.ts', 'turn'],
    ['botpress-agent/src/workflows/processPostSale.ts', 'post_sale'],
  ])('logs at the first statement of %s before parsing, routing or early exits', (file, kind) => {
    const result = prepared();
    const source = ts.createSourceFile(file, result.sources[file], ts.ScriptTarget.Latest, true);
    const handlers: ts.Block[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'handler' && node.body) handlers.push(node.body);
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'handler'
        && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body)) handlers.push(node.initializer.body);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(handlers).toHaveLength(1);
    const first = handlers[0].statements[0].getText(source);
    const log = vi.fn();
    new Function('input', 'workflow', 'logReleaseEntry', first)({ trace_id: 't' }, { id: 'wf' }, log);
    expect(log).toHaveBeenCalledWith(kind, { trace_id: 't' }, 'wf');
  });

  it('adds base SHA and build identity to durable evidence without changing the observed event', async () => {
    const result = prepared();
    const info = vi.fn();
    const generated = loadGenerated(result.sources[result.generatedPath], info);
    const request = vi.fn(async (input: { body: Record<string, unknown> }) => {
      void input;
      return { recorded: true };
    });
    const exports: Record<string, unknown> = {};
    new Function('exports', 'require', compile(result.sources[BOT_RELEASE_SOURCE_PATHS[0]]))(exports, (name: string) => {
      if (name.endsWith('release-provenance.generated')) return generated;
      if (name.endsWith('/http')) return { requestStudyxJson: request };
      if (name.includes('agent-a-brain-v1')) return { AGENT_A_BRAIN_PROMPT_VERSION: 'brain' };
      if (name.includes('canonical.generated')) return { STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION: 'prompt' };
      if (name === '@botpress/runtime') return { z: { object: () => ({}), literal: () => ({}) } };
      throw new Error(`UNEXPECTED_IMPORT:${name}`);
    });
    const event = { event_id: 'event', kind: 'model_raw', data: { raw_content: 'unchanged draft' } };
    const subject = { subject_type: 'turn', subject_id: 'turn', trace_id: 'trace' };
    await (exports.persistTurnEvidence as (s: unknown, e: unknown) => Promise<void>)(subject, event);
    expect(request.mock.calls[0][0].body).toMatchObject({ ...subject, ...event,
      botpress_version: BOT_RELEASE_BASE_SHA,
      data: { raw_content: 'unchanged draft', release_provenance: generated.RELEASE_PROVENANCE } });
    expect(event.data).toEqual({ raw_content: 'unchanged draft' });
  });

  it('rejects an unapproved base, missing or duplicated anchors, and invalid tooling identity', () => {
    expect(() => instrumentBotpressReleaseSources({ sourceBaseSha: '0'.repeat(40), instrumentationSha256: toolHash, sources }))
      .toThrow('UNREVIEWED_SOURCE_BASE');
    expect(() => instrumentBotpressReleaseSources({ sourceBaseSha: BOT_RELEASE_BASE_SHA, instrumentationSha256: '', sources }))
      .toThrow('INVALID_INSTRUMENTATION_SHA256');
    const file = BOT_RELEASE_SOURCE_PATHS[0];
    expect(() => instrumentBotpressReleaseSources({ sourceBaseSha: BOT_RELEASE_BASE_SHA, instrumentationSha256: toolHash,
      sources: { ...sources, [file]: sources[file].replace('botpress_version: BOTPRESS_EVIDENCE_VERSION', 'botpress_version: other') } }))
      .toThrow('SOURCE_BASE_CONTENT_MISMATCH');
    const workflow = BOT_RELEASE_SOURCE_PATHS[1];
    expect(() => instrumentBotpressReleaseSources({ sourceBaseSha: BOT_RELEASE_BASE_SHA, instrumentationSha256: toolHash,
      sources: { ...sources, [workflow]: `${sources[workflow]}\n${sources[workflow]}` } }))
      .toThrow('SOURCE_BASE_CONTENT_MISMATCH');
  });

  it('hashes the actual final bundle separately and refuses bundles lacking the generated identity', () => {
    const result = prepared();
    const bundle = Buffer.from(`${BOT_RELEASE_BASE_SHA} ${toolHash} studyx.release.loaded studyx.release.entry`);
    const finalized = finalizeBotpressReleaseManifest(result.manifest, bundle);
    expect(finalized).toMatchObject({ source_base_sha: BOT_RELEASE_BASE_SHA,
      artifact_sha256: createHash('sha256').update(bundle).digest('hex'), artifact_bytes: bundle.length, published: false });
    expect(() => finalizeBotpressReleaseManifest(result.manifest, Buffer.from('old bundle')))
      .toThrow('BUNDLE_PROVENANCE_NOT_FOUND');
  });
  it.each(['prompt', 'catalog', 'new_file', 'lock'])('refuses source snapshot tampering: %s', kind => {
    const directory = mkdtempSync(path.join(tmpdir(), 'studyx-provenance-test-'));
    try {
      mkdirSync(path.join(directory, 'botpress-agent/src/prompts'), { recursive: true });
      mkdirSync(path.join(directory, 'supabase/seed'), { recursive: true });
      writeFileSync(path.join(directory, 'botpress-agent/src/prompts/prompt.ts'), 'export const prompt = "original";');
      writeFileSync(path.join(directory, 'supabase/seed/catalog.sql'), 'SELECT 1;');
      writeFileSync(path.join(directory, 'package-lock.json'), '{"version":1}');
      const inventory = snapshotReleaseSources(directory);
      // Secret configuration and build outputs must never enter public receipts.
      mkdirSync(path.join(directory, '.adk'), { recursive: true });
      writeFileSync(path.join(directory, '.adk/secrets.json'), 'PRIVATE');
      writeFileSync(path.join(directory, '.env.local'), 'PRIVATE');
      assertReleaseSourcesUnchanged(directory, inventory);
      const selected = { prompt: 'botpress-agent/src/prompts/prompt.ts', catalog: 'supabase/seed/catalog.sql',
        new_file: 'unreviewed-runtime.ts', lock: 'package-lock.json' }[kind]!;
      writeFileSync(path.join(directory, selected), 'MODIFIED');
      expect(() => assertReleaseSourcesUnchanged(directory, inventory)).toThrow('PREPARED_SOURCE_TREE_CHANGED');
      expect(JSON.stringify(inventory)).not.toContain('PRIVATE');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });


  it('H2: the pinned base is an ancestor of HEAD and the instrumented sources are this branch\'s sources', () => {
    execFileSync('git', ['merge-base', '--is-ancestor', BOT_RELEASE_BASE_SHA, 'HEAD']);
    // Same reviewed hashes at the pin and at the working tree: preparing from HEAD runs the branch code.
    for (const file of BOT_RELEASE_SOURCE_PATHS) {
      expect(hash(execFileSync('git', ['show', `${BOT_RELEASE_BASE_SHA}:${file}`], { encoding: 'utf8' })))
        .toBe(hash(readFileSync(file, 'utf8')));
    }
    const changed = execFileSync('git', ['diff', '--name-only', BOT_RELEASE_BASE_SHA, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(() => assertOnlyNonCodeChangesSinceBaseV1(changed)).not.toThrow();
  });

  it('H2: refuses code changed after the pin and labels that do not match the code', () => {
    expect(() => assertOnlyNonCodeChangesSinceBaseV1([
      'docs/x.md',
      'evals/a.ts',
      'tests/b.ts',
      'botpress-agent/evals/personas/heldout.json',
      'scripts/lib/botpress-additive-event-contract.mjs',
      'scripts/publish-botpress-code-preserving-connections.mjs',
      'AGENTS.md',
    ])).not.toThrow();
    expect(() => assertOnlyNonCodeChangesSinceBaseV1(['docs/x.md', 'src/lib/services/decision.service.ts'])).toThrow('CODE_CHANGED_SINCE_RELEASE_BASE');
    expect(() => assertOnlyNonCodeChangesSinceBaseV1(['scripts/unreviewed-runtime-tool.mjs'])).toThrow('CODE_CHANGED_SINCE_RELEASE_BASE');
    const brainSource = execFileSync('git', ['show', `${BOT_RELEASE_BASE_SHA}:botpress-agent/src/prompts/agent-a-brain-v1.ts`], { encoding: 'utf8' });
    const promptSource = execFileSync('git', ['show', `${BOT_RELEASE_BASE_SHA}:botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`], { encoding: 'utf8' });
    expect(() => assertReleaseLabelsMatchCodeV1({ brainSource, promptSource })).not.toThrow();
    expect(() => assertReleaseLabelsMatchCodeV1({ brainSource: brainSource.replace(BOT_RELEASE_BRAIN_VERSION, 'studyx-agent-a-brain-v1'), promptSource })).toThrow('RELEASE_LABELS_MISMATCH_CODE');
    expect(() => assertReleaseLabelsMatchCodeV1({ brainSource, promptSource: promptSource.replace(BOT_RELEASE_PROMPT_VERSION, 'x') })).toThrow('RELEASE_LABELS_MISMATCH_CODE');
  });
});
