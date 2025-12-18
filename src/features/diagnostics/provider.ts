import {
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
  languages,
  Range,
  workspace
} from 'vscode';
import type { TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { parseCollieDocument } from '../../lang/parseDocument';
import type { ParsedDocument } from '../../lang';
import type { Diagnostic as ParserDiagnostic, SourceSpan } from '../../format/parser/diagnostics';
import { isFeatureFlagEnabled, onDidChangeFeatureFlags } from '../featureFlags';

const SUPPORTED_DIRECTIVES = new Set(['@if', '@elseIf', '@else']);

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function spanToRange(document: TextDocument, span?: SourceSpan): Range {
  if (!span) {
    return new Range(0, 0, 0, 0);
  }
  const start = document.positionAt(span.start.offset);
  const end = document.positionAt(span.end.offset);
  return new Range(start, end);
}

function convertParserDiagnostic(document: TextDocument, diagnostic: ParserDiagnostic): VSDiagnostic {
  const range = spanToRange(document, diagnostic.span);
  const vscodeDiag = new VSDiagnostic(range, diagnostic.message, mapSeverity(diagnostic.severity));
  vscodeDiag.code = diagnostic.code;
  vscodeDiag.source = 'collie';
  return vscodeDiag;
}

function mapSeverity(severity: ParserDiagnostic['severity']): DiagnosticSeverity {
  switch (severity) {
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'error':
    default:
      return DiagnosticSeverity.Error;
  }
}

function collectParserDiagnostics(document: TextDocument, parsed: ParsedDocument): VSDiagnostic[] {
  if (!parsed.diagnostics || parsed.diagnostics.length === 0) {
    return [];
  }
  return parsed.diagnostics.map(diag => convertParserDiagnostic(document, diag));
}

function collectDuplicatePropDiagnostics(document: TextDocument): VSDiagnostic[] {
  const diagnostics: VSDiagnostic[] = [];
  let inPropsBlock = false;
  let propsIndent = 0;
  const seen = new Map<string, Range>();

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    const trimmed = line.text.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const indent = line.firstNonWhitespaceCharacterIndex;

    if (!inPropsBlock) {
      if (trimmed === 'props') {
        inPropsBlock = true;
        propsIndent = indent;
      }
      continue;
    }

    if (indent <= propsIndent) {
      inPropsBlock = trimmed === 'props';
      if (inPropsBlock) {
        propsIndent = indent;
      }
      continue;
    }

    const content = line.text.slice(indent);
    const match = content.match(/^([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/);
    if (!match) {
      continue;
    }

    const name = match[1];
    const startColumn = indent;
    const range = new Range(lineNumber, startColumn, lineNumber, startColumn + name.length);

    if (seen.has(name)) {
      diagnostics.push(createDiagnostic(range, `Prop "${name}" is declared multiple times.`, 'COLLIE301'));
    } else {
      seen.set(name, range);
    }
  }

  return diagnostics;
}

function collectUnknownDirectiveDiagnostics(document: TextDocument): VSDiagnostic[] {
  const diagnostics: VSDiagnostic[] = [];

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    const trimmed = line.text.trim();
    if (!trimmed.startsWith('@')) {
      continue;
    }

    const match = trimmed.match(/^@([A-Za-z][\w-]*)/);
    if (!match) {
      continue;
    }

    const directive = `@${match[1]}`;
    if (SUPPORTED_DIRECTIVES.has(directive)) {
      continue;
    }

    const startColumn = line.firstNonWhitespaceCharacterIndex;
    const range = new Range(lineNumber, startColumn, lineNumber, startColumn + match[0].length);
    diagnostics.push(createDiagnostic(range, `Unknown directive "${directive}".`, 'COLLIE302'));
  }

  return diagnostics;
}

function createDiagnostic(range: Range, message: string, code: string): VSDiagnostic {
  const diagnostic = new VSDiagnostic(range, message, DiagnosticSeverity.Error);
  diagnostic.code = code;
  diagnostic.source = 'collie';
  return diagnostic;
}

function applyDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  if (!shouldHandleDocument(document)) {
    return;
  }

  if (!isFeatureFlagEnabled('diagnostics')) {
    collection.delete(document.uri);
    return;
  }

  let parsed: ParsedDocument | null = null;
  try {
    parsed = parseCollieDocument(document);
  } catch (error) {
    context.logger.error('Failed to parse Collie document for diagnostics.', error);
  }

  const diagnostics: VSDiagnostic[] = [];

  if (parsed) {
    diagnostics.push(...collectParserDiagnostics(document, parsed));
  }

  diagnostics.push(...collectUnknownDirectiveDiagnostics(document));
  diagnostics.push(...collectDuplicatePropDiagnostics(document));

  collection.set(document.uri, diagnostics);
}

function refreshOpenDocuments(
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  for (const document of workspace.textDocuments) {
    applyDiagnostics(document, collection, context);
  }
}

function activateDiagnosticsProvider(context: FeatureContext) {
  const collection = languages.createDiagnosticCollection('collie');
  context.register(collection);

  if (isFeatureFlagEnabled('diagnostics')) {
    refreshOpenDocuments(collection, context);
  }

  context.register(
    workspace.onDidOpenTextDocument(document => {
      applyDiagnostics(document, collection, context);
    })
  );

  context.register(
    workspace.onDidChangeTextDocument(event => {
      applyDiagnostics(event.document, collection, context);
    })
  );

  context.register(
    workspace.onDidCloseTextDocument(document => {
      collection.delete(document.uri);
    })
  );

  context.register(
    onDidChangeFeatureFlags(flags => {
      if (flags.diagnostics) {
        refreshOpenDocuments(collection, context);
      } else {
        collection.clear();
      }
    })
  );

  context.logger.info('Collie diagnostics provider registered.');
}

registerFeature(activateDiagnosticsProvider);
