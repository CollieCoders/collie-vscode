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
import { getParsedDocument, invalidateParsedDocument } from '../../lang/cache';
import { listByFile, onDidChangeTemplateIndex, type TemplateLocation } from '../../lang/templateIndex';
import type { ParsedDocument } from '../../lang';
import type { Diagnostic as ParserDiagnostic, SourceSpan } from '../../format/parser/diagnostics';
import { isFeatureFlagEnabled, onDidChangeFeatureFlags } from '../featureFlags';
import { collectCompilerDiagnostics } from './compilerDiagnostics';
import { onDidChangeCollieConfig, resolveCollieConfigForDocument } from '../../config/collieConfig';
import { getCssClassIndexForDocument, getUnknownClassOverrideSetting } from '../css/indexer';
import type { Node } from '../../format/parser/ast';
import { TextDecoder } from 'util';

const SUPPORTED_DIRECTIVES = new Set(['@if', '@elseIf', '@else', '@for']);
const DIALECT_DIRECTIVE_ALIASES = new Set(['@elseif', '@else-if']);
const DIAGNOSTIC_DEBOUNCE_MS = 200;
const REFRESH_DEBOUNCE_MS = 250;
const REFRESH_OPEN_DOCS_KEY = '__collie_refresh_open_docs__';
const COLLIE_GLOB = '**/*.collie';
const COLLIE_EXCLUDE_GLOB = '**/{node_modules,dist,build,out,coverage,.git}/**';
const TEMPLATE_USAGE_GLOB = '**/*.{ts,tsx,js,jsx,html}';
const TEMPLATE_USAGE_EXCLUDE_GLOB = '**/{node_modules,dist,build,out,coverage,.git}/**';
const COLLIE_COMPONENT_PATTERN = /<Collie\b[^>]*\bid\s*=\s*["']([^"']+)["']/g;
const HTML_PLACEHOLDER_PATTERN = /\bid\s*=\s*["']([^"']*-collie)["']/g;
const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();
let templateIndexVersion = 0;
let cachedTemplateEntriesVersion = -1;
let cachedTemplateEntries: Map<string, TemplateLocation[]> = new Map();
let cachedTemplateEntriesPromise: Promise<Map<string, TemplateLocation[]>> | null = null;
let templateUsageVersion = 0;
let cachedTemplateUsageVersion = -1;
let cachedReferencedIds: Set<string> = new Set();
let cachedReferencedIdsPromise: Promise<Set<string>> | null = null;
const textDecoder = new TextDecoder('utf-8');

function invalidateTemplateEntryCache(): void {
  templateIndexVersion += 1;
  cachedTemplateEntriesVersion = -1;
  cachedTemplateEntries.clear();
  cachedTemplateEntriesPromise = null;
}

function invalidateTemplateUsageCache(): void {
  templateUsageVersion += 1;
  cachedTemplateUsageVersion = -1;
  cachedReferencedIds.clear();
  cachedReferencedIdsPromise = null;
}

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function isTemplateUsageDocument(document: TextDocument): boolean {
  if (document.uri.scheme !== 'file') {
    return false;
  }
  const languageId = document.languageId;
  if (
    languageId === 'typescript' ||
    languageId === 'typescriptreact' ||
    languageId === 'javascript' ||
    languageId === 'javascriptreact' ||
    languageId === 'html'
  ) {
    return true;
  }
  return document.fileName.endsWith('.html');
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
      if (trimmed === '#props') {
        inPropsBlock = true;
        propsIndent = indent;
      }
      continue;
    }

    if (indent <= propsIndent) {
      inPropsBlock = trimmed === '#props';
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

async function getTemplateEntriesById(): Promise<Map<string, TemplateLocation[]>> {
  if (cachedTemplateEntriesVersion === templateIndexVersion) {
    return cachedTemplateEntries;
  }

  if (cachedTemplateEntriesPromise) {
    return cachedTemplateEntriesPromise;
  }

  cachedTemplateEntriesPromise = (async () => {
    const entriesById = new Map<string, TemplateLocation[]>();
    const files = await workspace.findFiles(COLLIE_GLOB, COLLIE_EXCLUDE_GLOB);

    for (const uri of files) {
      const entries = listByFile(uri);
      for (const entry of entries) {
        const existing = entriesById.get(entry.id) ?? [];
        existing.push(entry);
        entriesById.set(entry.id, existing);
      }
    }

    cachedTemplateEntries = entriesById;
    cachedTemplateEntriesVersion = templateIndexVersion;
    cachedTemplateEntriesPromise = null;
    return entriesById;
  })();

  return cachedTemplateEntriesPromise;
}

async function getReferencedTemplateIds(): Promise<Set<string>> {
  if (cachedTemplateUsageVersion === templateUsageVersion) {
    return cachedReferencedIds;
  }

  if (cachedReferencedIdsPromise) {
    return cachedReferencedIdsPromise;
  }

  cachedReferencedIdsPromise = (async () => {
    const referenced = new Set<string>();
    const files = await workspace.findFiles(TEMPLATE_USAGE_GLOB, TEMPLATE_USAGE_EXCLUDE_GLOB);

    for (const uri of files) {
      let contents = '';
      try {
        const data = await workspace.fs.readFile(uri);
        contents = textDecoder.decode(data);
      } catch {
        continue;
      }

      let match: RegExpExecArray | null;
      const componentRegex = new RegExp(COLLIE_COMPONENT_PATTERN.source, 'g');
      while ((match = componentRegex.exec(contents)) !== null) {
        const id = match[1]?.trim();
        if (id) {
          referenced.add(id);
        }
      }

      const htmlRegex = new RegExp(HTML_PLACEHOLDER_PATTERN.source, 'g');
      while ((match = htmlRegex.exec(contents)) !== null) {
        const raw = match[1]?.trim();
        if (!raw || !raw.endsWith('-collie')) {
          continue;
        }
        const logicalId = raw.slice(0, -7);
        if (logicalId) {
          referenced.add(logicalId);
        }
      }
    }

    cachedReferencedIds = referenced;
    cachedTemplateUsageVersion = templateUsageVersion;
    cachedReferencedIdsPromise = null;
    return referenced;
  })();

  return cachedReferencedIdsPromise;
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
    diagnostics.push(...await collectIdCollisionDiagnostics(document));
    diagnostics.push(...await collectUnreferencedTemplateDiagnostics(document));
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
      scheduleDiagnostics(event.document, collection, context);
      if (isTemplateUsageDocument(event.document)) {
        invalidateTemplateUsageCache();
        scheduleOpenDocumentsRefresh(collection, context);
      }
    })
  );

  context.register(
    workspace.onDidSaveTextDocument(document => {
      scheduleDiagnostics(document, collection, context);
      if (isTemplateUsageDocument(document)) {
        invalidateTemplateUsageCache();
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
