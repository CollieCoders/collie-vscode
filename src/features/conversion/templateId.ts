import { basename, dirname, extname } from 'path';
import type { Range, TextDocument } from 'vscode';

const DEFAULT_BASE = 'Template';

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
  _selection: Range,
  existingIds: Set<string>
): string {
  const baseRaw = deriveTargetFileBase(document);
  const base = ensureStartsWithLetter(sanitizeSegment(baseRaw) || DEFAULT_BASE, DEFAULT_BASE);

  let candidate = `${base}_1`;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }

  return candidate;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '');
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
