import {
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
  languages,
  Range,
  workspace
} from 'vscode';
import type { TextDocument } from 'vscode';
import type { FeatureContext } from '../types';
import { getParsedDocument, invalidateParsedDocument } from '../../lang/cache';
import { listByFile, onDidChangeTemplateIndex, type TemplateLocation } from '../../lang/templateIndex';
import type { ParsedDocument } from '../../lang';
import type { Diagnostic as ParserDiagnostic, SourceSpan } from '../../format/parser/diagnostics';
import { isFeatureFlagEnabled, onDidChangeFeatureFlags } from '../featureFlags';
import { collectCompilerDiagnostics } from './compilerDiagnostics';
import { onDidChangeCollieConfig, resolveCollieConfigForDocument } from '../../config/collieConfig';
import { getCssClassIndexForDocument, getUnknownClassOverrideSetting } from '../css/indexer';
import type { Node } from '../../format/parser/ast';
import { spanToRange } from './helpers/ranges';
import { SUPPORTED_DIRECTIVES, DIALECT_DIRECTIVE_ALIASES, parseIgnoreDirectives } from './helpers/directives';
import { invalidateTemplateEntryCache, getTemplateEntriesById } from './helpers/cache';
import {
  invalidateTemplateUsageCache,
  isTemplateUsageDocument,
  getReferencedTemplateIds
} from './helpers/templateUsage';

const DIAGNOSTIC_DEBOUNCE_MS = 200;
const REFRESH_DEBOUNCE_MS = 250;
const REFRESH_OPEN_DOCS_KEY = '__collie_refresh_open_docs__';
const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();
// diagnostic-upgrade: Track validation run versions to prevent stale results
const validationRunVersions = new Map<string, number>();

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

// diagnostic-upgrade: Check if file changes should trigger Collie doc revalidation
function isRelevantForCrossFileRevalidation(document: TextDocument): boolean {
  const lang = document.languageId;
  // TSX/TS/JS files affect inputs/template diagnostics
  if (lang === 'typescriptreact' || lang === 'typescript' || 
      lang === 'javascriptreact' || lang === 'javascript') {
    return true;
  }
  // CSS files affect class diagnostics
  if (lang === 'css' || lang === 'scss' || lang === 'less') {
    return true;
  }
  return false;
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

function collectDuplicateInputDiagnostics(document: TextDocument): VSDiagnostic[] {
  const diagnostics: VSDiagnostic[] = [];
  let inInputsBlock = false;
  let inputsIndent = 0;
  const seen = new Map<string, Range>();

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    const trimmed = line.text.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const indent = line.firstNonWhitespaceCharacterIndex;

    if (!inInputsBlock) {
      if (trimmed === '#inputs') {
        inInputsBlock = true;
        inputsIndent = indent;
      }
      continue;
    }

    if (indent <= inputsIndent) {
      inInputsBlock = trimmed === '#inputs';
      if (inInputsBlock) {
        inputsIndent = indent;
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
      diagnostics.push(createDiagnostic(range, `Input "${name}" is declared multiple times.`, 'COLLIE401'));
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

function formatTemplateLocation(entry: TemplateLocation): string {
  const relativePath = workspace.asRelativePath(entry.uri);
  const line = entry.idRange.start.line + 1;
  return `${relativePath}:${line}`;
}

async function collectIdCollisionDiagnostics(document: TextDocument): Promise<VSDiagnostic[]> {
  const diagnostics: VSDiagnostic[] = [];
  const entriesById = await getTemplateEntriesById();
  const entriesInFile = listByFile(document.uri);
  const currentUri = document.uri.toString();

  for (const entry of entriesInFile) {
    const entries = entriesById.get(entry.id) ?? [];
    if (entries.length <= 1) {
      continue;
    }

    const others = entries.filter(other => other.uri.toString() !== currentUri);
    if (others.length === 0) {
      continue;
    }

    const othersList = others.map(other => `- ${formatTemplateLocation(other)}`).join('\n');
    const message = `Duplicate Collie template id "${entry.id}".\nAlso defined in:\n${othersList}`;
    const diagnostic = new VSDiagnostic(entry.idRange, message, DiagnosticSeverity.Error);
    diagnostic.code = 'COLLIE403';
    diagnostic.source = 'collie';
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

async function collectUnreferencedTemplateDiagnostics(document: TextDocument): Promise<VSDiagnostic[]> {
  const diagnostics: VSDiagnostic[] = [];
  const entriesInFile = listByFile(document.uri);
  if (entriesInFile.length === 0) {
    return diagnostics;
  }

  const referenced = await getReferencedTemplateIds();

  for (const entry of entriesInFile) {
    if (!entry.isValidId) {
      continue;
    }
    if (referenced.has(entry.id)) {
      continue;
    }
    const diagnostic = new VSDiagnostic(
      entry.idRange,
      `Template id "${entry.id}" is not referenced by a Collie mount or HTML placeholder.`,
      DiagnosticSeverity.Warning
    );
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

function applyDiagnosticSuppression(document: TextDocument, diagnostics: VSDiagnostic[]): VSDiagnostic[] {
  const ignoreDirectives = parseIgnoreDirectives(document.getText());
  const filtered: VSDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const code = diagnostic.code;
    if (typeof code !== 'string') {
      filtered.push(diagnostic);
      continue;
    }

    // Check file-level suppression
    if (ignoreDirectives.fileLevelCodes.has(code)) {
      continue;
    }

    // Check line-level suppression
    const diagnosticLine = diagnostic.range.start.line;
    const lineCodes = ignoreDirectives.lineLevelCodes.get(diagnosticLine);
    if (lineCodes?.has(code)) {
      continue;
    }

    filtered.push(diagnostic);
  }

  return filtered;
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

  // diagnostic-upgrade: Capture current run version to detect stale results
  const docKey = document.uri.toString();
  const currentVersion = (validationRunVersions.get(docKey) ?? 0) + 1;
  validationRunVersions.set(docKey, currentVersion);

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
    diagnostics.push(...await collectIdCollisionDiagnostics(document));
    diagnostics.push(...await collectUnreferencedTemplateDiagnostics(document));
  }

  diagnostics.push(...collectUnknownDirectiveDiagnostics(document));
  diagnostics.push(...collectDuplicateInputDiagnostics(document));
  diagnostics.push(...collectCompilerDiagnostics(document, parsed, config));
  diagnostics.push(...collectUnknownClassDiagnostics(document, parsed, config));

  // Apply diagnostic suppression based on ignore directives
  const suppressedDiagnostics = applyDiagnosticSuppression(document, diagnostics);

  // diagnostic-upgrade: Only publish if this is still the latest run
  if (validationRunVersions.get(docKey) === currentVersion) {
    collection.set(document.uri, suppressedDiagnostics);
  }
}

function scheduleDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  const key = document.uri.toString();
  scheduleDebounced(key, () => {
    void applyDiagnostics(document, collection, context);
    // After updating this document, refresh all other collie documents
    // to update their ID collision diagnostics
    refreshOtherCollieDocuments(document, collection, context);
  }, DIAGNOSTIC_DEBOUNCE_MS);
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
  cancelDebounced(document.uri.toString());
}

function scheduleDebounced(key: string, action: () => void, delayMs: number): void {
  const existing = pendingDiagnostics.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingDiagnostics.delete(key);
    action();
  }, delayMs);
  pendingDiagnostics.set(key, handle);
}

function cancelDebounced(key: string): void {
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

function scheduleOpenDocumentsRefresh(
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
) {
  if (!isFeatureFlagEnabled('diagnostics')) {
    cancelDebounced(REFRESH_OPEN_DOCS_KEY);
    return;
  }

  scheduleDebounced(REFRESH_OPEN_DOCS_KEY, () => {
    if (isFeatureFlagEnabled('diagnostics')) {
      refreshOpenDocuments(collection, context);
    }
  }, REFRESH_DEBOUNCE_MS);
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
      // diagnostic-upgrade: Revalidate Collie docs when relevant files change (not just on save)
      if (shouldHandleDocument(event.document)) {
        scheduleDiagnostics(event.document, collection, context);
        if (isTemplateUsageDocument(event.document)) {
          invalidateTemplateUsageCache();
          scheduleOpenDocumentsRefresh(collection, context);
        }
      } else if (isRelevantForCrossFileRevalidation(event.document)) {
        // When TSX/TS/CSS files change, revalidate all open Collie documents
        scheduleOpenDocumentsRefresh(collection, context);
      }
    })
  );

  context.register(
    workspace.onDidSaveTextDocument(document => {
      // diagnostic-upgrade: Save events also trigger revalidation (in addition to change events)
      if (shouldHandleDocument(document)) {
        scheduleDiagnostics(document, collection, context);
        if (isTemplateUsageDocument(document)) {
          invalidateTemplateUsageCache();
          scheduleOpenDocumentsRefresh(collection, context);
        }
      } else if (isRelevantForCrossFileRevalidation(document)) {
        scheduleOpenDocumentsRefresh(collection, context);
      }
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
        scheduleOpenDocumentsRefresh(collection, context);
      } else {
        cancelDebounced(REFRESH_OPEN_DOCS_KEY);
        collection.clear();
      }
    })
  );

  context.register(
    onDidChangeCollieConfig(() => {
      scheduleOpenDocumentsRefresh(collection, context);
    })
  );

  context.register(
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('collie.css.diagnostics.unknownClassOverride')) {
        scheduleOpenDocumentsRefresh(collection, context);
      }
    })
  );

  context.register(
    onDidChangeTemplateIndex(() => {
      invalidateTemplateEntryCache();
      invalidateTemplateUsageCache();
      scheduleOpenDocumentsRefresh(collection, context);
    })
  );

  context.logger.info('Collie diagnostics provider registered.');
}
