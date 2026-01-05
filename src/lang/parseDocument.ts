import { Position, type TextDocument } from 'vscode';
import { parse } from '../format/parser';
import type { PropsDecl, PropsField } from '../format/parser/ast';
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
  const propsBlocks = findHashPropsBlocks(document);
  const filteredDiagnostics = diagnostics.filter(diagnostic => {
    if (diagnostic.code === 'COLLIE401' || diagnostic.code === 'COLLIE402') {
      return false;
    }
    if (diagnostic.code === 'COLLIE101' || diagnostic.code === 'COLLIE102') {
      return false;
    }
    if (diagnostic.code === 'COLLIE003') {
      const lineIndex = diagnostic.span?.start?.line ? diagnostic.span.start.line - 1 : -1;
      if (lineIndex >= 0 && isLineInHashPropsBlock(lineIndex, propsBlocks)) {
        return false;
      }
    }
    if (diagnostic.code === 'COLLIE004') {
      const lineIndex = diagnostic.span?.start?.line ? diagnostic.span.start.line - 1 : -1;
      if (lineIndex >= 0 && isLineInHashPropsBlock(lineIndex, propsBlocks)) {
        return false;
      }
    }
    return true;
  });
  const templateDiagnostics = collectTemplateIdDiagnostics(document);
  const combinedDiagnostics = filteredDiagnostics.concat(templateDiagnostics);

  const hashProps = parseHashPropsDeclaration(document, propsBlocks);
  if (hashProps) {
    root.props = hashProps;
  }

  if (root.rawId) {
    root.rawId = undefined;
  }

  return {
    ast: root,
    diagnostics: combinedDiagnostics,
    version: document.version
  };
}

interface HashPropsBlock {
  startLine: number;
  endLine: number;
  indent: number;
  span: SourceSpan;
}

function findHashPropsBlocks(document: TextDocument): HashPropsBlock[] {
  const blocks: HashPropsBlock[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const trimmed = line.text.trim();
    if (trimmed !== '#props') {
      continue;
    }

    const indent = line.firstNonWhitespaceCharacterIndex;
    const startCharacter = line.text.indexOf('#props');
    const span = buildSpan(document, lineIndex, Math.max(startCharacter, 0), '#props'.length);
    let endLine = lineIndex;

    for (let next = lineIndex + 1; next < document.lineCount; next += 1) {
      const nextLine = document.lineAt(next);
      if (nextLine.text.trim().length === 0) {
        endLine = next;
        continue;
      }

      const nextIndent = nextLine.firstNonWhitespaceCharacterIndex;
      if (nextIndent <= indent) {
        break;
      }

      endLine = next;
    }

    blocks.push({ startLine: lineIndex, endLine, indent, span });
  }

  return blocks;
}

function isLineInHashPropsBlock(lineIndex: number, blocks: HashPropsBlock[]): boolean {
  return blocks.some(block => lineIndex >= block.startLine && lineIndex <= block.endLine);
}

function parseHashPropsDeclaration(
  document: TextDocument,
  blocks: HashPropsBlock[]
): PropsDecl | undefined {
  if (blocks.length === 0) {
    return undefined;
  }

  const fields: PropsField[] = [];
  for (const block of blocks) {
    for (let lineIndex = block.startLine + 1; lineIndex <= block.endLine; lineIndex += 1) {
      const line = document.lineAt(lineIndex);
      const trimmed = line.text.trim();
      if (!trimmed) {
        continue;
      }

      const indent = line.firstNonWhitespaceCharacterIndex;
      if (indent <= block.indent) {
        continue;
      }

      const content = line.text.slice(indent);
      
      // Try to match new syntax: name or name()
      const newSyntaxMatch = content.match(/^([A-Za-z_][A-Za-z0-9_]*)(\(\))?$/);
      if (newSyntaxMatch) {
        const name = newSyntaxMatch[1];
        const hasFnSuffix = newSyntaxMatch[2] === '()';
        const span = buildSpan(document, lineIndex, indent, content.length);
        fields.push({
          name,
          optional: false,
          typeText: '',
          kind: hasFnSuffix ? 'fn' : 'value',
          span
        });
        continue;
      }

      // Try to match legacy syntax: name?: type or name: type
      const legacyMatch = content.match(/^([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:\s*(.+)$/);
      if (!legacyMatch) {
        continue;
      }

      const name = legacyMatch[1];
      const optional = legacyMatch[2] === '?';
      const typeText = legacyMatch[3].trim();
      const span = buildSpan(document, lineIndex, indent, content.length);
      
      // Normalize legacy 'fn' type to kind
      const kind = typeText === 'fn' ? 'fn' : 'value';
      
      fields.push({ name, optional, typeText, kind, span });
    }
  }

  return { fields, span: blocks[0].span };
}
