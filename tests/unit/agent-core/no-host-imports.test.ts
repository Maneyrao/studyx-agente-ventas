import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function moduleSpecifiers(source: string): readonly (string | null)[] {
  const parsed = ts.createSourceFile(
    'agent-core-source.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: (string | null)[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isModuleRequire = ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'module'
        && node.expression.name.text === 'require';
      const [argument] = node.arguments;
      if (isDynamicImport || isRequire || isModuleRequire) {
        specifiers.push(argument && ts.isStringLiteralLike(argument) ? argument.text : null);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return specifiers;
}

const AGENT_CORE_SOURCE_ROOT = resolve('agent-core/src');

function isForbiddenHostSpecifier(specifier: string | null, sourceFile: string): boolean {
  if (specifier === null) return true;
  const normalized = specifier.replaceAll('\\', '/');
  if (!normalized.startsWith('.')) return true;
  const resolvedImport = resolve(dirname(sourceFile), normalized);
  const relativeImport = relative(AGENT_CORE_SOURCE_ROOT, resolvedImport);
  return relativeImport.startsWith('..') || isAbsolute(relativeImport);
}

function hasForbiddenHostImport(
  source: string,
  sourceFile = join(AGENT_CORE_SOURCE_ROOT, 'probe.ts'),
): boolean {
  return moduleSpecifiers(source).some((specifier) => (
    isForbiddenHostSpecifier(specifier, sourceFile)
  ));
}

describe('agent-core isolation', () => {
  it.each([
    "import 'next/server';",
    "const mod = await import('next/server');",
    "const mod = await import('next/server', { with: { type: 'json' } });",
    "const host = 'next/server'; const mod = await import(host);",
    "type Request = import('next/server').NextRequest;",
    "const db = require('postgres');",
    "import pg from 'pg';",
    "import { createClient } from '@supabase/supabase-js';",
    "import x from '../../../src/features/conversation/domain/x';",
    "import x from '../../../botpress-agent/src/x';",
    "import x from '/repo/src/lib/db';",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('postgres');",
    "module.require('postgres');",
    "import db from '@vercel/postgres';",
    "import x from 'file:///repo/src/lib/db';",
    "import x from 'C:/repo/src/lib/db';",
    String.raw`import x from 'C:\repo\src\lib\db';`,
  ])('detects a forbidden host dependency in %s', (source) => {
    expect(hasForbiddenHostImport(source)).toBe(true);
  });

  it.each([
    "import type { ResponseBlockV3 } from './domain/response-blocks';",
    "const local = await import('./domain/response-blocks');",
    "const example = \"import 'next/server'\";",
    "// import x from '../../../src/features/x';",
  ])('does not flag allowed source in %s', (source) => {
    expect(hasForbiddenHostImport(source)).toBe(false);
  });

  it('never imports from the Botpress agent, the Next app or the database', () => {
    const offenders = tsFiles('agent-core/src')
      .filter((file) => hasForbiddenHostImport(readFileSync(file, 'utf8'), resolve(file)));
    expect(offenders).toEqual([]);
  });
});
