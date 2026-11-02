#!/usr/bin/env node
// Local source preparation only. This command never authenticates or publishes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOT_RELEASE_BASE_SHA, BOT_RELEASE_SOURCE_PATHS,
  instrumentBotpressReleaseSources, finalizeBotpressReleaseManifest, snapshotReleaseSources, assertReleaseSourcesUnchanged,
} from './lib/botpress-release-provenance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const hash = value => createHash('sha256').update(value).digest('hex');
const command = process.argv[2];
const output = option('--output');
if (!output || !path.isAbsolute(output)) throw new Error('ABSOLUTE_NEW_OUTPUT_DIRECTORY_REQUIRED');

if (command === 'prepare') {
  const base = option('--base-sha');
  if (base !== BOT_RELEASE_BASE_SHA) throw new Error('UNREVIEWED_SOURCE_BASE');
  if (existsSync(output)) throw new Error('OUTPUT_DIRECTORY_ALREADY_EXISTS');
  const verified = execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  if (verified !== base) throw new Error('SOURCE_BASE_NOT_FOUND');
  const original = Object.fromEntries(BOT_RELEASE_SOURCE_PATHS.map(file => [file,
    execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' })]));
  const toolFiles = ['scripts/lib/botpress-release-provenance.mjs', 'scripts/prepare-instrumented-botpress-release.mjs'];
  const tooling = toolFiles.map(file => ({ path: file, sha256: hash(readFileSync(path.join(root, file))) }));
  const instrumentationHash = hash(JSON.stringify(tooling));
  const instrumented = instrumentBotpressReleaseSources({ sourceBaseSha: base,
    instrumentationSha256: instrumentationHash, sources: original });
  // Archive committed source only; never copy working-tree .env, credentials,
  // generated cloud snapshots, node_modules or unpublished user edits.
  const staging = mkdtempSync(path.join(tmpdir(), 'studyx-source-archive-'));
  try {
    const archive = path.join(staging, 'base.tar');
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, base], { cwd: root });
    mkdirSync(path.dirname(output), { recursive: true });
    mkdirSync(output);
    execFileSync('tar', ['-xf', archive, '-C', output]);
    for (const [file, source] of Object.entries(instrumented.sources)) {
      const target = path.join(output, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    const manifest = { ...instrumented.manifest, instrumentation_files: tooling,
      source_preparation_only: true, build_executed_by_preparation_tool: false, remote_operations: 0,
      prepared_source_inventory: snapshotReleaseSources(output) };
    writeFileSync(path.join(output, 'release-provenance.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ prepared: true, output, source_base_sha: base,
      instrumentation_sha256: instrumentationHash, build_executed: false, remote_operations: 0 }));
  } finally {
    // Only remove the private directory this invocation created, never output.
    rmSync(staging, { recursive: true, force: true });
  }
} else if (command === 'finalize') {
  const bundle = option('--bundle');
  if (!bundle || !path.isAbsolute(bundle)) throw new Error('ABSOLUTE_BUNDLE_PATH_REQUIRED');
  const manifestPath = path.join(output, 'release-provenance.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.source_base_sha !== BOT_RELEASE_BASE_SHA) throw new Error('UNREVIEWED_SOURCE_BASE');
  for (const item of [...manifest.changed_sources.map(item => ({ path: item.path, sha256: item.after_sha256 })), ...manifest.generated_sources]) {
    if (hash(readFileSync(path.join(output, item.path))) !== item.sha256) throw new Error('PREPARED_SOURCE_CHANGED');
  }
  assertReleaseSourcesUnchanged(output, manifest.prepared_source_inventory);
  const finalized = finalizeBotpressReleaseManifest(manifest, readFileSync(bundle));
  writeFileSync(path.join(output, 'release-provenance.bundle-manifest.json'), `${JSON.stringify(finalized, null, 2)}\n`);
  console.log(JSON.stringify({ source_base_sha: finalized.source_base_sha,
    instrumentation_sha256: finalized.instrumentation_sha256, artifact_sha256: finalized.artifact_sha256,
    artifact_bytes: finalized.artifact_bytes, published: false }));
} else {
  throw new Error('EXPECTED_PREPARE_OR_FINALIZE');
}
