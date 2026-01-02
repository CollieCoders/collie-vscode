import {
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
  Range,
  RelativePattern,
  TextDocument,
  languages,
  workspace,
  type Uri,
  type WorkspaceFolder
} from 'vscode';
import type { FeatureContext } from '..';
import { getParsedDocument } from '../../lang/cache';
import { onDidChangeCollieConfig, resolveCollieConfigForDocument } from '../../config/collieConfig';
import * as path from 'path';
import * as ts from 'typescript';
import type { SourceSpan } from '../../format/parser/diagnostics';

const COLLECTION_NAME = 'collie-react-props';
const ENABLED_SETTING_KEY = 'collie.props.reactIntegration.enabled';
const TSX_INCLUDE_GLOB = '**/*.{tsx,jsx}';
const TSX_EXCLUDE_GLOB = '**/{node_modules,dist,build}/**';
const MAX_TS_FILES = 200;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const DIAGNOSTIC_DEBOUNCE_MS = 300;

interface UsageResult {
  props: Set<string>;
  sawSpread: boolean;
}

interface CacheEntry {
  collieVersion: number;
  workspaceVersion: number;
  diagnostics: VSDiagnostic[];
}

const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();
const diagnosticsCache = new Map<string, CacheEntry>();
let workspaceUsageVersion = 0;

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
  return config.parsed.propsReactIntegrationEnabled === true;
}

async function readFileText(uri: Uri): Promise<string | null> {
  try {
    const stat = await workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return null;
    }
    const contents = await workspace.fs.readFile(uri);
    return Buffer.from(contents).toString('utf8');
  } catch {
    return null;
  }
}

function collectPropsFromJsx(
  sourceFile: ts.SourceFile,
  componentName: string
): UsageResult {
  const props = new Set<string>();
  let sawSpread = false;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = node.tagName;
      if (ts.isIdentifier(tagName) && tagName.text === componentName) {
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr)) {
            props.add(attr.name.text);
          } else if (ts.isJsxSpreadAttribute(attr)) {
            sawSpread = true;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { props, sawSpread };
}

async function findComponentPropUsages(
  folder: WorkspaceFolder,
  componentName: string,
  context: FeatureContext
): Promise<UsageResult> {
  const include = new RelativePattern(folder, TSX_INCLUDE_GLOB);
  const exclude = new RelativePattern(folder, TSX_EXCLUDE_GLOB);
  const files = await workspace.findFiles(include, exclude, MAX_TS_FILES + 1);

  if (files.length > MAX_TS_FILES) {
    context.logger.info(
      `Skipping React prop analysis (more than ${MAX_TS_FILES} TSX/JSX files).`
    );
    return { props: new Set(), sawSpread: false };
  }

  let totalBytes = 0;
  const props = new Set<string>();
  let sawSpread = false;

  for (const uri of files) {
    let size = 0;
    try {
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
        `Skipping React prop analysis after ${MAX_TOTAL_BYTES} bytes of TSX/JSX.`
      );
      break;
    }

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

    const result = collectPropsFromJsx(sourceFile, componentName);
    for (const name of result.props) {
      props.add(name);
    }
    if (result.sawSpread) {
      sawSpread = true;
    }
  }

  if (sawSpread) {
    context.logger.info('React prop analysis encountered JSX spread props; results may be incomplete.');
  }

  return { props, sawSpread };
}

async function computeDiagnostics(document: TextDocument, context: FeatureContext): Promise<VSDiagnostic[]> {
  const parsed = getParsedDocument(document);
  const componentName = deriveComponentName(document);
  if (!componentName) {
    return [];
  }

  const folder = workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return [];
  }

  const declaredProps = new Set(parsed.ast.props?.fields.map(field => field.name) ?? []);
  const propsSpan = parsed.ast.props?.span;

  const usage = await findComponentPropUsages(folder, componentName, context);

  const diagnostics: VSDiagnostic[] = [];
  const range = spanToRange(document, propsSpan);

  for (const propName of usage.props) {
    if (!declaredProps.has(propName)) {
      const diagnostic = new VSDiagnostic(
        range,
        `Prop "${propName}" is passed to <${componentName}> but not declared in the props block.`,
        DiagnosticSeverity.Information
      );
      diagnostic.code = 'COLLIE601';
      diagnostic.source = 'collie';
      diagnostic.data = {
        kind: 'addPropDeclaration',
        propName
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
  if (cached && cached.collieVersion === document.version && cached.workspaceVersion === workspaceUsageVersion) {
    collection.set(document.uri, cached.diagnostics);
    return;
  }

  let diagnostics: VSDiagnostic[] = [];
  try {
    diagnostics = await computeDiagnostics(document, context);
  } catch (error) {
    context.logger.warn('React prop analysis failed.', error);
  }

  diagnosticsCache.set(cacheKey, {
    collieVersion: document.version,
    workspaceVersion: workspaceUsageVersion,
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

function clearPendingDiagnostics(document: TextDocument): void {
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
): void {
  for (const document of workspace.textDocuments) {
    if (isCollieDocument(document)) {
      void updateDiagnostics(document, collection, context);
    }
  }
}

export function registerTsPropsDiagnostics(context: FeatureContext) {
  const collection = languages.createDiagnosticCollection(COLLECTION_NAME);
  context.register(collection);

  refreshOpenDocuments(collection, context);

  context.register(
    workspace.onDidOpenTextDocument(document => {
      if (isCollieDocument(document)) {
        scheduleDiagnostics(document, collection, context);
      }
    })
  );

  context.register(
    workspace.onDidChangeTextDocument(event => {
      if (isCollieDocument(event.document)) {
        scheduleDiagnostics(event.document, collection, context);
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
      }
    })
  );

  context.register(
    workspace.onDidCloseTextDocument(document => {
      if (isCollieDocument(document)) {
        clearPendingDiagnostics(document);
        collection.delete(document.uri);
      }
    })
  );

  context.register(
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(ENABLED_SETTING_KEY)) {
        diagnosticsCache.clear();
        refreshOpenDocuments(collection, context);
      }
    })
  );

  context.register(
    onDidChangeCollieConfig(() => {
      diagnosticsCache.clear();
      refreshOpenDocuments(collection, context);
    })
  );

  context.logger.info('React props diagnostics registered.');
}
