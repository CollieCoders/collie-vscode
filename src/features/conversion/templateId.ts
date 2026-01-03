import * as ts from 'typescript';
import { basename, dirname, extname } from 'path';
import type { Range, TextDocument } from 'vscode';

const DEFAULT_BASE = 'Template';
const DEFAULT_SCOPE = 'block';
const FALLBACK_SCOPE = 'render';
const TEMPLATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

export function deriveTargetFileBase(document: TextDocument): string {
  if (document.uri.scheme !== 'file') {
    return DEFAULT_BASE;
  }

  const fsPath = document.uri.fsPath;
  const base = basename(fsPath, extname(fsPath));
  if (!base || base.toLowerCase() === 'index') {
    return basename(dirname(fsPath)) || DEFAULT_BASE;
  }
  return base;
}

export function deriveTemplateId(
  document: TextDocument,
  selection: Range,
  existingIds: Set<string>
): string {
  const baseRaw = deriveTargetFileBase(document);
  const scopeRaw = findNearestNamedScope(document, selection) ?? FALLBACK_SCOPE;

  const base = ensureStartsWithLetter(sanitizeSegment(baseRaw) || DEFAULT_BASE, DEFAULT_BASE);
  const scope = sanitizeSegment(scopeRaw) || DEFAULT_SCOPE;

  const baseId = `${base}.${scope}`;
  const normalizedBase = TEMPLATE_ID_PATTERN.test(baseId) ? baseId : `${DEFAULT_BASE}.${DEFAULT_SCOPE}`;

  let candidate = normalizedBase;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${normalizedBase}~${counter}`;
    counter += 1;
  }

  return candidate;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '');
}

function ensureStartsWithLetter(value: string, fallback: string): string {
  if (!value) {
    return fallback;
  }
  if (/^[A-Za-z]/.test(value)) {
    return value;
  }
  return `${fallback}${value}`;
}

function findNearestNamedScope(document: TextDocument, selection: Range): string | null {
  const sourceFile = ts.createSourceFile(
    document.uri.fsPath,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    document.languageId === 'javascriptreact' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  );
  const selectionStart = document.offsetAt(selection.start);
  const selectionEnd = document.offsetAt(selection.end);

  let bestName: string | null = null;
  let bestSize = Number.POSITIVE_INFINITY;

  const visit = (node: ts.Node): void => {
    if (!nodeContainsSelection(node, selectionStart, selectionEnd, sourceFile)) {
      return;
    }

    const name = getFunctionLikeName(node);
    if (name) {
      const size = node.getEnd() - node.getStart(sourceFile);
      if (size < bestSize) {
        bestName = name;
        bestSize = size;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return bestName;
}

function nodeContainsSelection(
  node: ts.Node,
  start: number,
  end: number,
  sourceFile: ts.SourceFile
): boolean {
  return start >= node.getStart(sourceFile) && end <= node.getEnd();
}

function getFunctionLikeName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }

  if (ts.isFunctionExpression(node) && node.name) {
    return node.name.text;
  }

  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  if (ts.isArrowFunction(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
  }

  return null;
}
