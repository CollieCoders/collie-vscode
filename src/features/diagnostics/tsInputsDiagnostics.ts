import type { TextDocument } from 'vscode';
import {
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
  Range,
  RelativePattern,
  languages,
  workspace,
  type Uri,
  type WorkspaceFolder
} from 'vscode';
import type { FeatureContext } from '../types';
import { getParsedDocument } from '../../lang/cache';
import { onDidChangeCollieConfig, resolveCollieConfigForDocument } from '../../config/collieConfig';
import { listIds, onDidChangeTemplateIndex } from '../../lang/templateIndex';
import { isFeatureFlagEnabled, onDidChangeFeatureFlags } from '../featureFlags';
import * as path from 'path';
import * as ts from 'typescript';
import type { SourceSpan } from '../../format/parser/diagnostics';
import { getTextPreferOpenDoc } from './helpers/textHelpers';

const COLLECTION_NAME = 'collie-react-inputs';
const TEMPLATE_USAGE_COLLECTION = 'collie-template-usage';
const ENABLED_SETTING_KEY = 'collie.inputs.reactIntegration.enabled';
const TSX_INCLUDE_GLOB = '**/*.{tsx,jsx}';
const TSX_EXCLUDE_GLOB = '**/{node_modules,dist,build}/**';
const MAX_TS_FILES = 200;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const DIAGNOSTIC_DEBOUNCE_MS = 300;
const COLLIE_COMPONENT_NAMES = new Set(['Collie']);

interface UsageResult {
  inputs: Set<string>;
  sawSpread: boolean;
}

interface CacheEntry {
  collieVersion: number;
  workspaceVersion: number;
  diagnostics: VSDiagnostic[];
}

interface TemplateUsageCacheEntry {
  documentVersion: number;
  templateIndexVersion: number;
  diagnostics: VSDiagnostic[];
}

const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();
const pendingUsageDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();
const diagnosticsCache = new Map<string, CacheEntry>();
const templateUsageCache = new Map<string, TemplateUsageCacheEntry>();
let workspaceUsageVersion = 0;
let templateIndexVersion = 0;

function isCollieDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function isTsxDocument(document: TextDocument): boolean {
  return document.languageId === 'typescriptreact' || document.languageId === 'javascriptreact';
}

function deriveComponentName(document: TextDocument): string | null {
  if (document.uri.scheme !== 'file') {
    return null;
  }

  const base = path.basename(document.uri.fsPath, '.collie');
  const normalized = base.endsWith('-collie') ? base.slice(0, -7) : base;
  const parts = normalized.split(/[^A-Za-z0-9]+/).filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1 && /^[A-Z]/.test(parts[0])) {
    return parts[0];
  }

  return parts
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join('');
}

function spanToRange(document: TextDocument, span?: SourceSpan): Range {
  if (!span) {
    return new Range(0, 0, 0, 1);
  }
  const start = document.positionAt(span.start.offset);
  const end = document.positionAt(span.end.offset);
  return new Range(start, end);
}

async function isReactIntegrationEnabled(document: TextDocument, context: FeatureContext): Promise<boolean> {
  const workspaceSetting = workspace.getConfiguration().get<boolean>(ENABLED_SETTING_KEY, false);
  if (workspaceSetting) {
    return true;
  }

  const config = await resolveCollieConfigForDocument(document, context.logger);
  return config.parsed.inputsReactIntegrationEnabled === true;
}

async function readFileText(uri: Uri): Promise<string | null> {
  try {
    const stat = await workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return null;
    }
    // diagnostic-upgrade: Prefer open document buffers over disk reads
    return await getTextPreferOpenDoc(uri);
  } catch {
    return null;
  }
}

function collectInputsFromJsx(
  sourceFile: ts.SourceFile,
  componentName: string
): UsageResult {
  const inputs = new Set<string>();
  let sawSpread = false;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = node.tagName;
      if (ts.isIdentifier(tagName) && tagName.text === componentName) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr)) {
            if (ts.isIdentifier(attr.name)) {
              inputs.add(attr.name.text);
            }
          } else if (ts.isJsxSpreadAttribute(attr)) {
            sawSpread = true;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { inputs, sawSpread };
}

function collectUnknownTemplateIdDiagnostics(document: TextDocument): VSDiagnostic[] {
  if (!isFeatureFlagEnabled('diagnostics')) {
    return [];
  }

  const ids = listIds();
  if (ids.length === 0) {
    return [];
  }

  const knownIds = new Set(ids);
  const sourceFile = ts.createSourceFile(
    document.uri.fsPath,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const diagnostics: VSDiagnostic[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = node.tagName;
      if (ts.isIdentifier(tagName) && COLLIE_COMPONENT_NAMES.has(tagName.text)) {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) {
            continue;
          }

          if (!ts.isIdentifier(attr.name) || attr.name.text !== 'id') {
            continue;
          }

          const initializer = attr.initializer;
          if (!initializer || !ts.isStringLiteralLike(initializer)) {
            continue;
          }

          const value = initializer.text;
          if (knownIds.has(value)) {
            continue;
          }

          const range = new Range(
            document.positionAt(initializer.getStart(sourceFile)),
            document.positionAt(initializer.getEnd())
          );
          const diagnostic = new VSDiagnostic(
            range,
            `Unknown Collie template id "${value}".`,
            DiagnosticSeverity.Warning
          );
          diagnostic.code = 'COLLIE701';
          diagnostic.source = 'collie';
          diagnostics.push(diagnostic);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return diagnostics;
}

async function findComponentInputUsages(
  folder: WorkspaceFolder,
  componentName: string,
  context: FeatureContext
): Promise<UsageResult> {
  const include = new RelativePattern(folder, TSX_INCLUDE_GLOB);
  const exclude = new RelativePattern(folder, TSX_EXCLUDE_GLOB);
  const files = await workspace.findFiles(include, exclude, MAX_TS_FILES + 1);

  if (files.length > MAX_TS_FILES) {
    context.logger.info(
      `Skipping React input analysis (more than ${MAX_TS_FILES} TSX/JSX files).`
    );
    return { inputs: new Set(), sawSpread: false };
  }

  let totalBytes = 0;
  const inputs = new Set<string>();
  let sawSpread = false;

  for (const uri of files) {
    let size = 0;
    try {
      // eslint-disable-next-line no-await-in-loop
      const stat = await workspace.fs.stat(uri);
      size = stat.size;
    } catch {
      continue;
    }

    if (size > MAX_FILE_BYTES) {
      continue;
    }

    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      context.logger.info(
      `Skipping React input analysis after ${MAX_TOTAL_BYTES} bytes of TSX/JSX.`
      );
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const text = await readFileText(uri);
    if (text === null) {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      uri.fsPath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const result = collectInputsFromJsx(sourceFile, componentName);
    for (const name of result.inputs) {
      inputs.add(name);
    }
    if (result.sawSpread) {
      sawSpread = true;
    }
  }

  if (sawSpread) {
    context.logger.info('React input analysis encountered JSX spread inputs; results may be incomplete.');
  }

  return { inputs, sawSpread };
}

async function computeDiagnostics(document: TextDocument, context: FeatureContext): Promise<VSDiagnostic[]> {
  const parsed = getParsedDocument(document);
  if (parsed.ast.sections.length !== 1) {
    return [];
  }
  const section = parsed.ast.sections[0];
  const componentName = deriveComponentName(document);
  if (!componentName) {
    return [];
  }

  const folder = workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return [];
  }

  const declaredInputs = new Set(section.inputs?.fields.map(field => field.name) ?? []);
  const inputsSpan = section.inputs?.span;

  const usage = await findComponentInputUsages(folder, componentName, context);

  const diagnostics: VSDiagnostic[] = [];
  const range = spanToRange(document, inputsSpan);

  for (const inputName of usage.inputs) {
    if (!declaredInputs.has(inputName)) {
      const diagnostic = new VSDiagnostic(
        range,
        `Input "${inputName}" is passed to <${componentName}> but not declared in the inputs block.`,
        DiagnosticSeverity.Information
      );
      diagnostic.code = 'COLLIE601';
      diagnostic.source = 'collie';
      diagnostic.data = {
        kind: 'addInputDeclaration',
        inputName
      };
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

async function updateDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
): Promise<void> {
  if (!isCollieDocument(document)) {
    return;
  }

  const enabled = await isReactIntegrationEnabled(document, context);
  if (!enabled) {
    collection.delete(document.uri);
    return;
  }

  const cacheKey = document.uri.toString();
  const cached = diagnosticsCache.get(cacheKey);
  if (cached?.collieVersion === document.version && cached.workspaceVersion === workspaceUsageVersion) {
    collection.set(document.uri, cached.diagnostics);
    return;
  }

  let diagnostics: VSDiagnostic[] = [];
  try {
    diagnostics = await computeDiagnostics(document, context);
  } catch (error) {
    context.logger.warn('React input analysis failed.', error);
  }

  diagnosticsCache.set(cacheKey, {
    collieVersion: document.version,
    workspaceVersion: workspaceUsageVersion,
    diagnostics
  });

  collection.set(document.uri, diagnostics);
}

function updateTemplateUsageDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>
): void {
  if (!isTsxDocument(document) || !isFeatureFlagEnabled('diagnostics')) {
    collection.delete(document.uri);
    return;
  }

  const cacheKey = document.uri.toString();
  const cached = templateUsageCache.get(cacheKey);
  if (cached?.documentVersion === document.version && cached.templateIndexVersion === templateIndexVersion) {
    collection.set(document.uri, cached.diagnostics);
    return;
  }

  const diagnostics = collectUnknownTemplateIdDiagnostics(document);
  templateUsageCache.set(cacheKey, {
    documentVersion: document.version,
    templateIndexVersion,
    diagnostics
  });

  collection.set(document.uri, diagnostics);
}

function scheduleDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
): void {
  const key = document.uri.toString();
  const existing = pendingDiagnostics.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingDiagnostics.delete(key);
    void updateDiagnostics(document, collection, context);
  }, DIAGNOSTIC_DEBOUNCE_MS);
  pendingDiagnostics.set(key, handle);
}

function scheduleTemplateUsageDiagnostics(
  document: TextDocument,
  collection: ReturnType<typeof languages.createDiagnosticCollection>
): void {
  const key = document.uri.toString();
  const existing = pendingUsageDiagnostics.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingUsageDiagnostics.delete(key);
    void updateTemplateUsageDiagnostics(document, collection);
  }, DIAGNOSTIC_DEBOUNCE_MS);
  pendingUsageDiagnostics.set(key, handle);
}

function clearPendingDiagnostics(document: TextDocument): void {
  const key = document.uri.toString();
  const handle = pendingDiagnostics.get(key);
  if (handle) {
    clearTimeout(handle);
    pendingDiagnostics.delete(key);
  }
}

function clearPendingTemplateUsageDiagnostics(document: TextDocument): void {
  const key = document.uri.toString();
  const handle = pendingUsageDiagnostics.get(key);
  if (handle) {
    clearTimeout(handle);
    pendingUsageDiagnostics.delete(key);
  }
}

function refreshOpenDocuments(
  collection: ReturnType<typeof languages.createDiagnosticCollection>,
  context: FeatureContext
): void {
  for (const document of workspace.textDocuments) {
    if (isCollieDocument(document)) {
      void updateDiagnostics(document, collection, context);
    }
  }
}

function refreshOpenTemplateUsageDocuments(
  collection: ReturnType<typeof languages.createDiagnosticCollection>
): void {
  for (const document of workspace.textDocuments) {
    if (isTsxDocument(document)) {
      void updateTemplateUsageDiagnostics(document, collection);
    }
  }
}

export function registerTsInputsDiagnostics(context: FeatureContext) {
  const collection = languages.createDiagnosticCollection(COLLECTION_NAME);
  context.register(collection);

  refreshOpenDocuments(collection, context);

  const usageCollection = languages.createDiagnosticCollection(TEMPLATE_USAGE_COLLECTION);
  context.register(usageCollection);
  refreshOpenTemplateUsageDocuments(usageCollection);

  context.register(
    workspace.onDidOpenTextDocument(document => {
      if (isCollieDocument(document)) {
        scheduleDiagnostics(document, collection, context);
        return;
      }

      if (isTsxDocument(document)) {
        scheduleTemplateUsageDiagnostics(document, usageCollection);
      }
    })
  );

  context.register(
    workspace.onDidChangeTextDocument(event => {
      if (isCollieDocument(event.document)) {
        scheduleDiagnostics(event.document, collection, context);
        return;
      }

      if (isTsxDocument(event.document)) {
        // diagnostic-upgrade: Invalidate workspace version on TSX changes (not just saves)
        // This ensures Collie diagnostics can see unsaved TSX edits
        workspaceUsageVersion += 1;
        refreshOpenDocuments(collection, context);
        scheduleTemplateUsageDiagnostics(event.document, usageCollection);
      }
    })
  );

  context.register(
    workspace.onDidSaveTextDocument(document => {
      if (isCollieDocument(document)) {
        scheduleDiagnostics(document, collection, context);
        return;
      }

      if (isTsxDocument(document)) {
        workspaceUsageVersion += 1;
        refreshOpenDocuments(collection, context);
        scheduleTemplateUsageDiagnostics(document, usageCollection);
      }
    })
  );

  context.register(
    workspace.onDidCloseTextDocument(document => {
      if (isCollieDocument(document)) {
        clearPendingDiagnostics(document);
        collection.delete(document.uri);
        return;
      }

      if (isTsxDocument(document)) {
        clearPendingTemplateUsageDiagnostics(document);
        usageCollection.delete(document.uri);
      }
    })
  );

  context.register(
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(ENABLED_SETTING_KEY)) {
        diagnosticsCache.clear();
        refreshOpenDocuments(collection, context);
        return;
      }

      if (event.affectsConfiguration('collie.features.diagnostics')) {
        templateUsageCache.clear();
        refreshOpenTemplateUsageDocuments(usageCollection);
      }
    })
  );

  context.register(
    onDidChangeCollieConfig(() => {
      diagnosticsCache.clear();
      refreshOpenDocuments(collection, context);
    })
  );

  context.register(
    onDidChangeTemplateIndex(() => {
      templateIndexVersion += 1;
      templateUsageCache.clear();
      refreshOpenTemplateUsageDocuments(usageCollection);
    })
  );

  context.register(
    onDidChangeFeatureFlags(flags => {
      if (flags.diagnostics) {
        refreshOpenTemplateUsageDocuments(usageCollection);
        return;
      }

      usageCollection.clear();
    })
  );

  context.logger.info('React inputs diagnostics registered.');
}
