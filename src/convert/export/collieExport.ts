import type { TextDocument } from 'vscode';
import { parse } from '../../format/parser';
import type { RootNode } from '../../format/parser/ast';
import type { Diagnostic } from '../../format/parser/diagnostics';
import { convertCollieAstToIr } from '../collie/astToIr';
import type { IrNode } from '../ir/nodes';
import { printJsxNodes } from '../tsx/print';

export type CollieExportTarget = 'JSX' | 'TSX';

export interface CollieExportSuccess {
  kind: 'success';
  target: CollieExportTarget;
  ast: RootNode;
  diagnostics: Diagnostic[];
  irNodes: readonly IrNode[];
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

  const irNodes = convertCollieAstToIr(root);

  const jsxOutput = irNodes.length > 0 ? printJsxNodes(irNodes, { target }) : buildEmptyJsxPlaceholder(target);

  return {
    kind: 'success',
    target,
    ast: root,
    diagnostics,
    irNodes,
    outputText: jsxOutput
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

function buildEmptyJsxPlaceholder(target: CollieExportTarget): string {
  return `/* Collie export (${target}) found no renderable nodes. */`;
}
