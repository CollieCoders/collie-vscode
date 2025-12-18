import type { TextDocument } from 'vscode';
import { parse } from '../../format/parser';
import type { RootNode } from '../../format/parser/ast';
import type { Diagnostic } from '../../format/parser/diagnostics';

export type CollieExportTarget = 'JSX' | 'TSX';

export interface CollieExportSuccess {
  kind: 'success';
  target: CollieExportTarget;
  ast: RootNode;
  diagnostics: Diagnostic[];
  outputText: string;
}

export interface CollieExportFailure {
  kind: 'failure';
  target: CollieExportTarget;
  diagnostics: Diagnostic[];
  outputText: string;
}

export type CollieExportResult = CollieExportSuccess | CollieExportFailure;

export function exportCollieDocument(document: TextDocument, target: CollieExportTarget): CollieExportResult {
  const { root, diagnostics } = parse(document.getText());
  const errors = diagnostics.filter(diag => diag.severity === 'error');

  if (errors.length > 0) {
    return {
      kind: 'failure',
      target,
      diagnostics: errors,
      outputText: formatParseFailure(errors)
    };
  }

  return {
    kind: 'success',
    target,
    ast: root,
    diagnostics,
    outputText: formatParseSuccessPlaceholder(target, root)
  };
}

function formatParseFailure(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return '/* Collie export failed: parser returned an unknown error. */';
  }

  const lines: string[] = ['/* Collie export failed to parse the template.'];
  for (const diagnostic of diagnostics) {
    lines.push(` * ${describeDiagnostic(diagnostic)}`);
  }
  lines.push(' */');
  return lines.join('\n');
}

function describeDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.span?.start;
  const locationText = location ? `line ${location.line}, column ${location.col}` : 'unknown location';
  const code = diagnostic.code ? ` [${diagnostic.code}]` : '';
  return `${diagnostic.message}${code} at ${locationText}`;
}

function formatParseSuccessPlaceholder(target: CollieExportTarget, root: RootNode): string {
  const topLevelCount = root.children.length;
  return `/* Collie export placeholder (${target}). Parsed ${topLevelCount} top-level node${
    topLevelCount === 1 ? '' : 's'
  }. */`;
}
