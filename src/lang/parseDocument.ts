import { Position, type TextDocument } from 'vscode';
import { parse } from '../format/parser';
import type { Diagnostic, SourceSpan } from '../format/parser/diagnostics';
import type { ParsedDocument } from '.';

const TEMPLATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const ID_DIRECTIVE_PATTERN = /^(\s*(?:#|)id(?:\s+|:\s*|=\s*))(.*)$/i;

function buildSpan(
  document: TextDocument,
  lineIndex: number,
  startCharacter: number,
  length: number
): SourceSpan {
  const lineLength = document.lineAt(lineIndex).text.length;
  const safeStart = Math.min(Math.max(startCharacter, 0), lineLength);
  const safeEnd = Math.min(Math.max(safeStart + Math.max(length, 0), safeStart), lineLength);
  const startOffset = document.offsetAt(new Position(lineIndex, safeStart));
  const endOffset = document.offsetAt(new Position(lineIndex, safeEnd));

  return {
    start: { line: lineIndex + 1, col: safeStart + 1, offset: startOffset },
    end: { line: lineIndex + 1, col: safeEnd + 1, offset: endOffset }
  };
}

function collectTemplateIdDiagnostics(document: TextDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const occurrences = new Map<string, SourceSpan[]>();

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex).text;
    const match = ID_DIRECTIVE_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const prefix = match[1] ?? '';
    const value = match[2] ?? '';
    const trimmedValue = value.trim();

    let span: SourceSpan;

    if (trimmedValue) {
      const valueIndex = value.indexOf(trimmedValue);
      const startCharacter = prefix.length + Math.max(valueIndex, 0);
      span = buildSpan(document, lineIndex, startCharacter, trimmedValue.length);
    } else {
      const trimmedLine = line.trim();
      const startCharacter = trimmedLine ? line.indexOf(trimmedLine) : 0;
      span = buildSpan(document, lineIndex, startCharacter, Math.max(trimmedLine.length, 1));
    }

    if (!trimmedValue || !TEMPLATE_ID_PATTERN.test(trimmedValue)) {
      diagnostics.push({
        severity: 'error',
        message: 'Template id must start with a letter and contain only letters, numbers, ".", "_", or "-".',
        span
      });
    }

    if (trimmedValue) {
      const existing = occurrences.get(trimmedValue);
      if (existing) {
        existing.push(span);
      } else {
        occurrences.set(trimmedValue, [span]);
      }
    }
  }

  if (occurrences.size === 0) {
    diagnostics.push({
      severity: 'error',
      message: 'Missing #id directive. Each template block must start with #id <id>.',
      span: buildSpan(document, 0, 0, 1)
    });
  }

  for (const [id, spans] of occurrences.entries()) {
    if (spans.length < 2) {
      continue;
    }
    for (const span of spans) {
      diagnostics.push({
        severity: 'error',
        message: `Duplicate #id "${id}" in this file.`,
        span,
        code: 'COLLIE403'
      });
    }
  }

  return diagnostics;
}

export function parseCollieDocument(document: TextDocument): ParsedDocument {
  const { root, diagnostics } = parse(document.getText());
  const templateDiagnostics = collectTemplateIdDiagnostics(document);
  const combinedDiagnostics = diagnostics.concat(templateDiagnostics);

  if (root.rawId) {
    root.rawId = undefined;
  }

  return {
    ast: root,
    diagnostics: combinedDiagnostics,
    version: document.version
  };
}
