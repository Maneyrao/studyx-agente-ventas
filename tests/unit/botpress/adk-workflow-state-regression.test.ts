import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Execute the installed pinned SDK implementation, without a cloud or model.
 * This catches the ADK 2.0.8 parent/callback autosave that mocks had hidden.
 */
function installedTrackedState() {
  const map = JSON.parse(readFileSync(new URL('../../../botpress-agent/node_modules/@botpress/runtime/dist/library.js.map', import.meta.url), 'utf8'));
  const index = map.sources.findIndex((source: string) => source.endsWith('runtime/tracked-state.ts'));
  if (index < 0) throw new Error('PINNED_ADK_TRACKED_STATE_SOURCE_MISSING');
  const source = map.sourcesContent[index].replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS } }).outputText;
  const states: unknown[] = [];
  const ctx = vm.createContext({ createHash, bytes: { parse: () => 1e8 }, sizeof: (value: unknown) => JSON.stringify(value).length,
    prettyBytes: String, isStateTooBig: () => false, context: { get: (key: string) => key === 'states' ? states : false },
    getActiveConversationId: () => null,
    span: async (_name: string, _properties: unknown, callback: (span: unknown) => unknown) => callback({ setAttribute() {}, addEvent() {} }),
    serializeStateReferences: (value: unknown) => value, deserializeStateReferences: async () => {},
    TrackedStateSchema: { safeParse: (value: unknown) => ({ success: true, data: value }) }, console });
  vm.runInContext(`${compiled}\nglobalThis.installed = TrackedState;`, ctx);
  return (ctx as { installed: {
    create: (props: unknown) => { load: () => Promise<void>; isDirty: () => boolean };
    saveAllDirty: (options: { throwOnError: boolean }) => Promise<void>;
  } }).installed;
}

describe('installed ADK 2.0.8 workflow state ownership', () => {
  it.each([false, true])('callback hydration preserves completed worker evidence (hydrate=%s)', async hydrate => {
    const tracked = installedTrackedState();
    const original = { value: { pendingEvidence: [{ event_id: 'original-id', kind: 'model_raw',
      data: { raw_content: 'Synthetic original draft.' } }], turnId: 'synthetic-turn' }, location: { type: 'state' } };
    let stored: unknown = structuredClone(original);
    let writes = 0;
    // A callback's unloaded ADK reference starts after the worker has saved.
    const callback = tracked.create({ type: 'workflow', id: 'synthetic', name: 'workflowState',
      schema: { parse: () => ({ pendingEvidence: [], turnId: null }) },
      client: { getOrSetState: async () => ({ state: { payload: structuredClone(stored) } }),
        setState: async (input: { payload: unknown }) => { stored = structuredClone(input.payload); writes += 1; } } });
    if (hydrate) await callback.load();
    expect(callback.isDirty()).toBe(!hydrate);
    await tracked.saveAllDirty({ throwOnError: true });
    expect(writes).toBe(hydrate ? 0 : 1);
    expect(stored).toEqual(hydrate ? original : { value: { pendingEvidence: [], turnId: null }, location: { type: 'state' } });
  });
});
