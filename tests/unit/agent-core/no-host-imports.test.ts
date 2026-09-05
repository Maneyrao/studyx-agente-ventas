import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
      const [argument] = node.arguments;
      if (isDynamicImport || isRequire) {
        specifiers.push(argument && ts.isStringLiteralLike(argument) ? argument.text : null);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return specifiers;
}

function isForbiddenHostSpecifier(specifier: string | null): boolean {
  if (specifier === null) return true;
  if (specifier === 'next' || specifier.startsWith('next/')) return true;
  if (specifier === 'postgres' || specifier.startsWith('postgres/')) return true;
  if (specifier === 'pg' || specifier.startsWith('pg/')) return true;
  if (specifier === '@supabase/supabase-js' || specifier.startsWith('@supabase/')) return true;
  if (specifier.startsWith('@/') || specifier.startsWith('@botpress/')) return true;
  if (specifier === 'botpress-agent' || specifier.startsWith('botpress-agent/')) return true;
  const normalized = specifier.replaceAll('\\', '/');
  if (!normalized.startsWith('.') && !normalized.startsWith('/')) return false;
  if (/(?:^|\/)botpress-agent(?:\/|$)/u.test(normalized)) return true;
  return !/(?:^|\/)agent-core\/src(?:\/|$)/u.test(normalized)
    && /(?:^|\/)src(?:\/|$)/u.test(normalized);
}

function hasForbiddenHostImport(source: string): boolean {
  return moduleSpecifiers(source).some(isForbiddenHostSpecifier);
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
      .filter((file) => hasForbiddenHostImport(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
