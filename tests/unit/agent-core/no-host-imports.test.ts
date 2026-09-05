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

function moduleSpecifiers(source: string): readonly string[] {
  const parsed = ts.createSourceFile(
    'agent-core-source.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

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
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const [argument] = node.arguments;
      if ((isDynamicImport || isRequire) && argument && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return specifiers;
}

function isForbiddenHostSpecifier(specifier: string): boolean {
  if (specifier === 'next' || specifier.startsWith('next/')) return true;
  if (specifier === 'postgres' || specifier.startsWith('postgres/')) return true;
  if (specifier.startsWith('@/') || specifier.startsWith('@botpress/')) return true;
  if (specifier === 'botpress-agent' || specifier.startsWith('botpress-agent/')) return true;
  return specifier.startsWith('.') && /(?:^|\/)(?:src|botpress-agent)(?:\/|$)/u.test(specifier);
}

function hasForbiddenHostImport(source: string): boolean {
  return moduleSpecifiers(source).some(isForbiddenHostSpecifier);
}

describe('agent-core isolation', () => {
  it.each([
    "import 'next/server';",
    "const mod = await import('next/server');",
    "const db = require('postgres');",
    "import x from '../../../src/features/conversation/domain/x';",
    "import x from '../../../botpress-agent/src/x';",
  ])('detects a forbidden host dependency in %s', (source) => {
    expect(hasForbiddenHostImport(source)).toBe(true);
  });

  it.each([
    "import type { ResponseBlockV3 } from './domain/response-blocks';",
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
