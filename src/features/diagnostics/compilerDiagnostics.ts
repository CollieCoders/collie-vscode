import { Diagnostic as VSDiagnostic, DiagnosticSeverity, Range, type TextDocument } from 'vscode';
import type { ParsedDocument } from '../../lang';
import type { CollieConfigResult } from '../../config/types';

interface FixPayload {
  range: Range;
  replacementText: string;
}

interface DiagnosticData {
  fix?: FixPayload;
  kind?: string;
  inputName?: string;
}

const DIALECT_TOKEN_PATTERNS = [
  { regex: /@else-if\b/g, replacement: '@elseIf' },
  { regex: /@elseif\b/g, replacement: '@elseIf' },
  { regex: /@else\s+if\b/g, replacement: '@elseIf' }
];

const BARE_INPUT_PATTERNS = [
  /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
  /(?<!\{)\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}(?!\})/g,
  /^[ \t]*=\s*([A-Za-z_][A-Za-z0-9_]*)\b/gm
];

function rangeFromIndex(document: TextDocument, start: number, length: number): Range {
  const startPos = document.positionAt(start);
  const endPos = document.positionAt(start + length);
  return new Range(startPos, endPos);
}

function createDiagnostic(
  range: Range,
  message: string,
  severity: DiagnosticSeverity,
  code: string,
  data?: DiagnosticData
): VSDiagnostic {
  const diagnostic = new VSDiagnostic(range, message, severity);
  diagnostic.code = code;
  diagnostic.source = 'collie';
  if (data) {
    diagnostic.data = data;
  }
  return diagnostic;
}

function collectDialectDiagnostics(document: TextDocument): VSDiagnostic[] {
  const diagnostics: VSDiagnostic[] = [];
  const text = document.getText();

  for (const pattern of DIALECT_TOKEN_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matched = match[0];
      const range = rangeFromIndex(document, match.index, matched.length);
      diagnostics.push(
        createDiagnostic(
          range,
          `Use "${pattern.replacement}" instead of "${matched}".`,
          DiagnosticSeverity.Warning,
          'COLLIE500',
          {
            kind: 'dialectToken',
            fix: {
              range,
              replacementText: pattern.replacement
            }
          }
        )
      );
    }
  }

  return diagnostics;
}

function collectInputUsageDiagnostics(document: TextDocument, parsed: ParsedDocument | null): VSDiagnostic[] {
  const declaredInputs = new Set(parsed?.ast.inputs?.fields.map(field => field.name) ?? []);

  const diagnostics: VSDiagnostic[] = [];
  const text = document.getText();
  const seen = new Set<string>();

  for (const pattern of BARE_INPUT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      if (!name || declaredInputs.has(name) || seen.has(name)) {
        continue;
      }
      seen.add(name);

      const matchText = match[0];
      const nameOffset = matchText.lastIndexOf(name);
      const range = rangeFromIndex(document, match.index + nameOffset, name.length);

      diagnostics.push(
        createDiagnostic(
          range,
          `Input "${name}" is used but not declared in the inputs block.`,
          DiagnosticSeverity.Warning,
          'COLLIE501',
          {
            kind: 'addInputDeclaration',
            inputName: name
          }
        )
      );
    }
  }

  return diagnostics;
}

export function collectCompilerDiagnostics(
  document: TextDocument,
  parsed: ParsedDocument | null,
  _config: CollieConfigResult
): VSDiagnostic[] {
  // Placeholder analyzer until compiler diagnostics are wired in.
  const diagnostics: VSDiagnostic[] = [];

  diagnostics.push(...collectDialectDiagnostics(document));
  diagnostics.push(...collectInputUsageDiagnostics(document, parsed));

  return diagnostics;
}
