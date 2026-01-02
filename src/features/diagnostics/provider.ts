import {
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
  languages,
  Position,
  Range,
  workspace
} from 'vscode';
import type { TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { getParsedDocument, invalidateParsedDocument, getTemplateIdEntries } from '../../lang/cache';
import { hasHtmlPlaceholder, onHtmlAnchorsChanged } from '../../lang/htmlAnchorIndex';
import type { ParsedDocument } from '../../lang';
import type { Diagnostic as ParserDiagnostic, SourceSpan } from '../../format/parser/diagnostics';
import { isFeatureFlagEnabled, onDidChangeFeatureFlags } from '../featureFlags';
import * as path from 'path';
import { collectCompilerDiagnostics } from './compilerDiagnostics';
import { onDidChangeCollieConfig, resolveCollieConfigForDocument } from '../../config/collieConfig';
import { getCssClassIndexForDocument, getUnknownClassOverrideSetting } from '../css/indexer';
import type { Node } from '../../format/parser/ast';

const SUPPORTED_DIRECTIVES = new Set(['@if', '@elseIf', '@else', '@for']);
const DIALECT_DIRECTIVE_ALIASES = new Set(['@elseif', '@else-if']);
const DIAGNOSTIC_DEBOUNCE_MS = 200;
const ID_DIRECTIVE_PATTERN = /^(?:#|)id(?:\s+|:\s*|=\s*)(.+)$/i;
const PASCAL_CASE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function spanToRange(document: TextDocument, span?: SourceSpan): Range {
  if (!span) {
    return new Range(0, 0, 0, 0);
  }
  const start = spanPositionToVs(document, span.start);
  const end = spanPositionToVs(document, span.end);
  return new Range(start, end);
}

function spanPositionToVs(document: TextDocument, pos: SourceSpan['start']): Position {
  const lineIndex = Math.min(
    Math.max(pos.line - 1, 0),
    Math.max(document.lineCount - 1, 0)
  );
  const lineText = document.lineAt(lineIndex).text;
  const character = Math.min(Math.max(pos.col - 1, 0), lineText.length);
  return new Position(lineIndex, character);
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

function collectPascalCaseIdDiagnostics(document: TextDocument, parsed: ParsedDocument): VSDiagnostic[] {
  const rawId = parsed.ast.rawId?.trim();
  if (!rawId || !parsed.ast.idSpan) {
    return [];
  }

  const normalized = rawId.endsWith('-collie') ? rawId.slice(0, -7) : rawId;
  if (PASCAL_CASE_PATTERN.test(normalized)) {
    return [];
  }

  const range = getIdValueRange(document, parsed.ast.idSpan, rawId);
  const replacementText = toPascalCase(normalized);
  const diagnostic = new VSDiagnostic(
    range,
    'Collie template id must be PascalCase.',
    DiagnosticSeverity.Error
  );
  diagnostic.code = 'COLLIE410';
  diagnostic.source = 'collie';
  diagnostic.data = {
    kind: 'pascalCaseId',
    fix: {
      range,
      replacementText
    }
  };
  return [diagnostic];
}

function getIdValueRange(document: TextDocument, span: SourceSpan, rawId: string): Range {
  const lineIndex = Math.max(0, span.start.line - 1);
  const lineText = document.lineAt(lineIndex).text;
  const match = ID_DIRECTIVE_PATTERN.exec(lineText);
  if (!match || match.index === undefined) {
    return spanToRange(document, span);
  }

  const valueText = match[1];
  const valueIndex = match[0].lastIndexOf(valueText);
  if (valueIndex === -1) {
    return spanToRange(document, span);
  }

  const start = match.index + valueIndex;
  return new Range(lineIndex, start, lineIndex, start + rawId.length);
}

function toPascalCase(value: string): string {
  const tokens = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const combined = tokens.map(token => token[0].toUpperCase() + token.slice(1)).join('');
  if (!combined) {
    return 'CollieId';
  }
  return /^[A-Za-z_]/.test(combined) ? combined : `Collie${combined}`;
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
      diagnostics.push(createDiagnostic(range, `Prop "${name}" is declared multiple times.`, 'COLLIE401'));
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
    if (SUPPORTED_DIRECTIVES.has(directive) || DIALECT_DIRECTIVE_ALIASES.has(directive)) {
      continue;
    }

    const startColumn = line.firstNonWhitespaceCharacterIndex;
    const range = new Range(lineNumber, startColumn, lineNumber, startColumn + match[0].length);
    diagnostics.push(createDiagnostic(range, `Unknown directive "${directive}".`, 'COLLIE402'));
  }

  return diagnostics;
}

function collectIdCollisionDiagnostics(document: TextDocument, parsed: ParsedDocument): VSDiagnostic[] {
  const diagnostics: VSDiagnostic[] = [];
  const currentUri = document.uri.toString();

  // Determine this document's template ID
  let templateId: string;
  let idSpan: SourceSpan | undefined;
  let isExplicit: boolean;

  if (parsed.ast.id) {
    templateId = parsed.ast.id;
    idSpan = parsed.ast.idSpan;
    isExplicit = true;
  } else {
    const basename = path.basename(document.uri.fsPath, '.collie');
    let normalized = basename;
    if (normalized.endsWith('-collie')) {
      normalized = normalized.slice(0, -7);
    }
    templateId = normalized;
    isExplicit = false;
  }

  // Get all entries with this ID
  const entries = getTemplateIdEntries(templateId);

  // If there are multiple entries with the same ID, we have a collision
  if (entries.length > 1) {
    // Find the other files (not this one)
    const others = entries.filter(entry => entry.uri.toString() !== currentUri);

    if (others.length > 0) {
      let range: Range;

      if (isExplicit && idSpan) {
        // Use the ID directive span
        range = spanToRange(document, idSpan);
      } else {
        // Use filename span (first line, or a reasonable placeholder)
        range = new Range(0, 0, 0, templateId.length);
      }

      // Build the diagnostic message
      const othersList = others.map(entry => {
        const relativePath = workspace.asRelativePath(entry.uri);
        const type = entry.derivedFromFilename ? 'implicit' : 'explicit';
        return `- ${relativePath} (${type})`;
      }).join('\n');

      const message = `Duplicate Collie template id "${templateId}".\nAlso defined in:\n${othersList}`;

      const diagnostic = new VSDiagnostic(range, message, DiagnosticSeverity.Error);
      diagnostic.code = 'COLLIE403';
      diagnostic.source = 'collie';
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

function collectMissingHtmlPlaceholderDiagnostics(document: TextDocument, parsed: ParsedDocument): VSDiagnostic[] {
  const diagnostics: VSDiagnostic[] = [];

  // Determine this document's template ID
  let templateId: string;
  let idSpan: SourceSpan | undefined;
  let isExplicit: boolean;

  if (parsed.ast.id) {
    templateId = parsed.ast.id;
    idSpan = parsed.ast.idSpan;
    isExplicit = true;
  } else {
    const basename = path.basename(document.uri.fsPath, '.collie');
    let normalized = basename;
    if (normalized.endsWith('-collie')) {
      normalized = normalized.slice(0, -7);
    }
    templateId = normalized;
    isExplicit = false;
  }

  // Check if there's a matching HTML placeholder
  if (!hasHtmlPlaceholder(templateId)) {
    let range: Range;

    if (isExplicit && idSpan) {
      // Use the ID directive span
      range = spanToRange(document, idSpan);
    } else {
      // Use filename span (first line)
      range = new Range(0, 0, 0, Math.max(templateId.length, 1));
    }

    const message = `Template id "${templateId}" has no matching HTML placeholder. ` +
      `Add id="${templateId}-collie" to your HTML to render this template.`;

    const diagnostic = new VSDiagnostic(range, message, DiagnosticSeverity.Warning);
    diagnostic.code = 'COLLIE404';
    diagnostic.source = 'collie';
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function mapUnknownClassSeverity(setting?: string): DiagnosticSeverity {
  const normalized = setting?.toLowerCase();
  switch (normalized) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'info':
    case 'hint':
      return DiagnosticSeverity.Information;
    case 'warn':
    case 'warning':
    default:
      return DiagnosticSeverity.Warning;
  }
}

function buildClassAliasMap(parsed: ParsedDocument): Map<string, string[]> {
  const aliases = parsed.ast.classAliases?.aliases ?? [];
  const map = new Map<string, string[]>();
  for (const alias of aliases) {
    map.set(alias.name, alias.classes);
  }
  return map;
}

function collectUnknownClassDiagnostics(
  document: TextDocument,
  parsed: ParsedDocument | null,
  config: Awaited<ReturnType<typeof resolveCollieConfigForDocument>>
): VSDiagnostic[] {
  const override = getUnknownClassOverrideSetting();
  if (override === 'off') {
    return [];
  }

  if (!parsed) {
    return [];
  }

  const index = getCssClassIndexForDocument(document);
  if (!index) {
    return [];
  }

  if (config.flags.isTailwind) {
    return [];
  }

  if (override !== 'on' && !config.flags.enableUnknownClassDiagnostics) {
    return [];
  }

  const aliasMap = buildClassAliasMap(parsed);
  const diagnostics: VSDiagnostic[] = [];
  const emitted = new Set<string>();
  const severity = mapUnknownClassSeverity(config.parsed.cssUnknownClass);

  const pushDiagnostic = (className: string, span?: SourceSpan, aliasName?: string) => {
    if (!span) {
      return;
    }
    const key = `${className}:${span.start.offset}`;
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    const range = spanToRange(document, span);
    const suffix = aliasName ? ` (from $${aliasName})` : '';
    const diagnostic = new VSDiagnostic(
      range,
      `Unknown CSS class "${className}"${suffix}.`,
      severity
    );
    diagnostic.code = 'COLLIE405';
    diagnostic.source = 'collie';
    diagnostics.push(diagnostic);
  };

  const visitNode = (node: Node) => {
    if (node.type === 'Element') {
      const spans = node.classSpans ?? [];
      node.classes.forEach((token, indexPos) => {
        const span = spans[indexPos] ?? node.span;
        const aliasMatch = token.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
        if (aliasMatch) {
          const aliasName = aliasMatch[1];
          const expanded = aliasMap.get(aliasName);
          if (!expanded) {
            return;
          }
          for (const className of expanded) {
            if (!index.hasClass(className)) {
              pushDiagnostic(className, span, aliasName);
            }
          }
          return;
        }

        if (!index.hasClass(token)) {
          pushDiagnostic(token, span);
        }
      });

      for (const child of node.children) {
        visitNode(child);
      }
      return;
    }

    if (node.type === 'Conditional') {
      for (const branch of node.branches) {
        for (const child of branch.body) {
          visitNode(child);
        }
      }
      return;
    }

    if (node.type === 'ForLoop') {
      for (const child of node.body) {
        visitNode(child);
      }
    }
  };

  for (const child of parsed.ast.children) {
    visitNode(child);
  }

  return diagnostics;
}

function createDiagnostic(range: Range, message: string, code: string): VSDiagnostic {
  const diagnostic = new VSDiagnostic(range, message, DiagnosticSeverity.Error);
  diagnostic.code = code;
  diagnostic.source = 'collie';
  return diagnostic;
}

async function applyDiagnostics(
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
    parsed = getParsedDocument(document);
  } catch (error) {
    context.logger.error('Failed to parse Collie document for diagnostics.', error);
  }

  const diagnostics: VSDiagnostic[] = [];
  const config = await resolveCollieConfigForDocument(document, context.logger);

  if (parsed) {
    diagnostics.push(...collectParserDiagnostics(document, parsed));
    diagnostics.push(...collectPascalCaseIdDiagnostics(document, parsed));
    diagnostics.push(...collectIdCollisionDiagnostics(document, parsed));
    diagnostics.push(...collectMissingHtmlPlaceholderDiagnostics(document, parsed));
  }

  diagnostics.push(...collectUnknownDirectiveDiagnostics(document));
  diagnostics.push(...collectDuplicatePropDiagnostics(document));
  diagnostics.push(...collectCompilerDiagnostics(document, parsed, config));
  diagnostics.push(...collectUnknownClassDiagnostics(document, parsed, config));

  collection.set(document.uri, diagnostics);
}

function scheduleDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  const key = document.uri.toString();
  const existing = pendingDiagnostics.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingDiagnostics.delete(key);
    void applyDiagnostics(document, collection, context);
    // After updating this document, refresh all other collie documents
    // to update their ID collision diagnostics
    refreshOtherCollieDocuments(document, collection, context);
  }, DIAGNOSTIC_DEBOUNCE_MS);
  pendingDiagnostics.set(key, handle);
}

function refreshOtherCollieDocuments(
  changedDocument: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  const changedUri = changedDocument.uri.toString();
  for (const document of workspace.textDocuments) {
    if (document.languageId === 'collie' && document.uri.toString() !== changedUri) {
      void applyDiagnostics(document, collection, context);
    }
  }
}

function clearPendingDiagnostics(document: TextDocument) {
  const key = document.uri.toString();
  const handle = pendingDiagnostics.get(key);
  if (handle) {
    clearTimeout(handle);
    pendingDiagnostics.delete(key);
  }
}

function refreshOpenDocuments(
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  for (const document of workspace.textDocuments) {
    void applyDiagnostics(document, collection, context);
  }
}

export function registerDiagnosticsProvider(context: FeatureContext) {
  const collection = languages.createDiagnosticCollection('collie');
  context.register(collection);

  if (isFeatureFlagEnabled('diagnostics')) {
    refreshOpenDocuments(collection, context);
  }

  context.register(
    workspace.onDidOpenTextDocument(document => {
      void applyDiagnostics(document, collection, context);
    })
  );

  context.register(
    workspace.onDidChangeTextDocument(event => {
      scheduleDiagnostics(event.document, collection, context);
    })
  );

  context.register(
    workspace.onDidSaveTextDocument(document => {
      scheduleDiagnostics(document, collection, context);
    })
  );

  context.register(
    workspace.onDidCloseTextDocument(document => {
      clearPendingDiagnostics(document);
      collection.delete(document.uri);
      invalidateParsedDocument(document);
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

  context.register(
    onDidChangeCollieConfig(() => {
      refreshOpenDocuments(collection, context);
    })
  );

  context.register(
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('collie.css.diagnostics.unknownClassOverride')) {
        refreshOpenDocuments(collection, context);
      }
    })
  );

  // Refresh diagnostics when HTML anchors change
  context.register(
    onHtmlAnchorsChanged(() => {
      if (isFeatureFlagEnabled('diagnostics')) {
        refreshOpenDocuments(collection, context);
      }
    })
  );

  context.logger.info('Collie diagnostics provider registered.');
}
