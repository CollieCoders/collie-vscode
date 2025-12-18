import { basename, extname } from 'path';
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

  let jsxOutput = irNodes.length > 0 ? printJsxNodes(irNodes, { target }) : buildEmptyJsxPlaceholder(target);

  if (target === 'TSX' && irNodes.length > 0) {
    jsxOutput = wrapWithTsxComponent(jsxOutput, document);
  }

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

function wrapWithTsxComponent(snippet: string, document: TextDocument): string {
  const componentName = deriveComponentName(document);
  const trimmedSnippet = snippet.trimEnd();
  const indentedSnippet = indentMultiline(trimmedSnippet, '    ');
  return `export function ${componentName}(): JSX.Element {\n  return (\n${indentedSnippet}\n  );\n}\n`;
}

function deriveComponentName(document: TextDocument): string {
  if (document.uri.scheme !== 'file') {
    return 'CollieExportComponent';
  }

  const fsPath = document.uri.fsPath;
  const baseName = basename(fsPath, extname(fsPath));
  const sanitized = sanitizeComponentName(baseName);
  return `${sanitized}Export`;
}

function sanitizeComponentName(baseName: string | undefined): string {
  if (!baseName) {
    return 'Collie';
  }

  const tokens = baseName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const combined = tokens.map(token => capitalize(token)).join('') || 'Collie';
  if (!/^[A-Za-z_]/.test(combined)) {
    return `Collie${combined}`;
  }
  return combined;
}

function capitalize(token: string): string {
  if (!token) {
    return '';
  }
  return token[0].toUpperCase() + token.slice(1);
}

function indentMultiline(text: string, indent: string): string {
  return text
    .split('\n')
    .map(line => `${indent}${line}`)
    .join('\n');
}
