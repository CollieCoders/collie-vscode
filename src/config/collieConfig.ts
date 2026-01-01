import {
  EventEmitter,
  Uri,
  workspace,
  type TextDocument,
  type WorkspaceFolder,
  type Disposable
} from 'vscode';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import * as path from 'path';
import type { Logger } from '../logger';

export interface CollieConfigParsed {
  cssStrategy?: string;
  cssUnknownClass?: string;
  dialect?: string;
  dialectProps?: unknown;
}

export interface CollieConfigFlags {
  enableCssIndex: boolean;
  enableUnknownClassDiagnostics: boolean;
  cssStrategy: string;
  unknownClassSetting?: string;
  isTailwind: boolean;
  isGlobal: boolean;
}

export interface CollieConfigResult {
  configPath?: string;
  parsed: CollieConfigParsed;
  flags: CollieConfigFlags;
}

export interface CollieConfigChange {
  configPath?: string;
  workspaceFolder?: string;
}

const CONFIG_FILENAMES = [
  'collie.config.js',
  'collie.config.cjs',
  'collie.config.mjs',
  'collie.config.ts',
  'collie.config.cts',
  'collie.config.mts',
  'collie.config.json'
];

const CONFIG_GLOB = '**/collie.config.*';

const configCacheByKey = new Map<string, CollieConfigResult>();
const parsedCacheByPath = new Map<string, CollieConfigParsed>();
const configPathToCacheKeys = new Map<string, Set<string>>();

const configChangeEmitter = new EventEmitter<CollieConfigChange>();
export const onDidChangeCollieConfig = configChangeEmitter.event;

const require = createRequire(import.meta.url);

function createDefaultFlags(): CollieConfigFlags {
  return {
    enableCssIndex: false,
    enableUnknownClassDiagnostics: false,
    cssStrategy: 'unknown',
    unknownClassSetting: undefined,
    isTailwind: false,
    isGlobal: false
  };
}

function computeFlags(parsed: CollieConfigParsed): CollieConfigFlags {
  const strategy = parsed.cssStrategy ?? 'unknown';
  const unknownClassSetting = parsed.cssUnknownClass;
  const isGlobal = strategy === 'global';
  const isTailwind = strategy === 'tailwind';

  if (isGlobal) {
    const enableUnknown = unknownClassSetting !== 'off';
    return {
      enableCssIndex: enableUnknown,
      enableUnknownClassDiagnostics: enableUnknown,
      cssStrategy: strategy,
      unknownClassSetting,
      isTailwind,
      isGlobal
    };
  }

  return {
    enableCssIndex: false,
    enableUnknownClassDiagnostics: false,
    cssStrategy: strategy,
    unknownClassSetting,
    isTailwind,
    isGlobal
  };
}

function extractConfigFields(rawConfig: unknown): CollieConfigParsed {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const config = rawConfig as Record<string, unknown>;
  const parsed: CollieConfigParsed = {};

  const css = config.css;
  if (css && typeof css === 'object') {
    const cssConfig = css as Record<string, unknown>;
    if (typeof cssConfig.strategy === 'string') {
      parsed.cssStrategy = cssConfig.strategy;
    }
    const diagnostics = cssConfig.diagnostics;
    if (diagnostics && typeof diagnostics === 'object') {
      const diagConfig = diagnostics as Record<string, unknown>;
      if (typeof diagConfig.unknownClass === 'string') {
        parsed.cssUnknownClass = diagConfig.unknownClass;
      }
    }
  }

  const dialect = config.dialect;
  if (typeof dialect === 'string') {
    parsed.dialect = dialect;
  } else if (dialect && typeof dialect === 'object') {
    const dialectConfig = dialect as Record<string, unknown>;
    if (typeof dialectConfig.name === 'string') {
      parsed.dialect = dialectConfig.name;
    }
    if ('props' in dialectConfig) {
      parsed.dialectProps = dialectConfig.props;
    }
  }

  return parsed;
}

function normalizeResult(configPath: string | undefined, parsed: CollieConfigParsed): CollieConfigResult {
  return {
    configPath,
    parsed,
    flags: computeFlags(parsed)
  };
}

function getCacheKey(document: TextDocument): string | undefined {
  if (document.uri.scheme !== 'file') {
    return undefined;
  }
  return path.dirname(document.uri.fsPath);
}

function removeCacheEntry(cacheKey: string): void {
  const cached = configCacheByKey.get(cacheKey);
  if (cached?.configPath) {
    const folderSet = configPathToCacheKeys.get(cached.configPath);
    folderSet?.delete(cacheKey);
    if (folderSet && folderSet.size === 0) {
      configPathToCacheKeys.delete(cached.configPath);
    }
  }
  configCacheByKey.delete(cacheKey);
}

function invalidateConfigPath(configPath: string, notify = true): void {
  parsedCacheByPath.delete(configPath);
  const folderKeys = configPathToCacheKeys.get(configPath);
  if (folderKeys) {
    for (const folderKey of folderKeys) {
      configCacheByKey.delete(folderKey);
    }
  }
  configPathToCacheKeys.delete(configPath);

  if (notify) {
    configChangeEmitter.fire({ configPath });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await workspace.fs.stat(Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}

async function findNearestConfigPath(startDir: string, stopDir?: string): Promise<string | undefined> {
  let current = startDir;
  const root = path.parse(current).root;

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(current, filename);
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    if (current === root || (stopDir && current === stopDir)) {
      break;
    }

    current = path.dirname(current);
  }

  return undefined;
}

async function importConfigFresh(configPath: string): Promise<unknown> {
  const fileUrl = pathToFileURL(configPath);
  const module = await import(`${fileUrl.href}?t=${Date.now()}`);
  return (module as { default?: unknown }).default ?? module;
}

function loadCommonJsConfig(configPath: string): unknown {
  const resolved = require.resolve(configPath);
  delete require.cache[resolved];
  const module = require(configPath);
  return (module as { default?: unknown }).default ?? module;
}

function isRequireEsmError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ERR_REQUIRE_ESM'
  );
}

async function loadConfigFile(configPath: string, logger?: Logger): Promise<unknown | null> {
  const ext = path.extname(configPath);

  try {
    if (ext === '.json') {
      const contents = await workspace.fs.readFile(Uri.file(configPath));
      return JSON.parse(Buffer.from(contents).toString('utf8'));
    }

    if (ext === '.mjs' || ext === '.mts') {
      return await importConfigFresh(configPath);
    }

    if (ext === '.js' || ext === '.cjs' || ext === '.cts') {
      try {
        return loadCommonJsConfig(configPath);
      } catch (error) {
        if (isRequireEsmError(error)) {
          return await importConfigFresh(configPath);
        }
        throw error;
      }
    }

    if (ext === '.ts') {
      try {
        return await importConfigFresh(configPath);
      } catch (error) {
        logger?.warn(`Unable to load TypeScript config at ${configPath}.`, error);
        return null;
      }
    }

    logger?.warn(`Unsupported Collie config file extension: ${configPath}`);
    return null;
  } catch (error) {
    logger?.warn(`Failed to load Collie config at ${configPath}.`, error);
    return null;
  }
}

async function loadParsedConfig(configPath: string, logger?: Logger): Promise<CollieConfigParsed> {
  const cached = parsedCacheByPath.get(configPath);
  if (cached) {
    return cached;
  }

  const raw = await loadConfigFile(configPath, logger);
  const parsed = extractConfigFields(raw);
  parsedCacheByPath.set(configPath, parsed);
  return parsed;
}

function storeCacheEntry(cacheKey: string, result: CollieConfigResult): void {
  configCacheByKey.set(cacheKey, result);
  if (result.configPath) {
    let folderSet = configPathToCacheKeys.get(result.configPath);
    if (!folderSet) {
      folderSet = new Set();
      configPathToCacheKeys.set(result.configPath, folderSet);
    }
    folderSet.add(cacheKey);
  }
}

export async function resolveCollieConfigForDocument(
  document: TextDocument,
  logger?: Logger
): Promise<CollieConfigResult> {
  const cacheKey = getCacheKey(document);
  if (!cacheKey) {
    return {
      parsed: {},
      flags: createDefaultFlags()
    };
  }

  const cached = configCacheByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const workspaceFolder = workspace.getWorkspaceFolder(document.uri);
  const startDir = path.dirname(document.uri.fsPath);
  const stopDir = workspaceFolder?.uri.fsPath;
  const configPath = await findNearestConfigPath(startDir, stopDir);

  if (!configPath) {
    const result = normalizeResult(undefined, {});
    storeCacheEntry(cacheKey, result);
    return result;
  }

  const parsed = await loadParsedConfig(configPath, logger);
  const result = normalizeResult(configPath, parsed);
  storeCacheEntry(cacheKey, result);
  return result;
}

export function getCachedCollieConfigForDocument(document: TextDocument): CollieConfigResult | undefined {
  const cacheKey = getCacheKey(document);
  if (!cacheKey) {
    return undefined;
  }
  return configCacheByKey.get(cacheKey);
}

export function invalidateCollieConfigForWorkspaceFolder(folder: WorkspaceFolder): void {
  const cacheKeys = Array.from(configCacheByKey.keys());
  for (const cacheKey of cacheKeys) {
    if (cacheKey.startsWith(folder.uri.fsPath)) {
      removeCacheEntry(cacheKey);
    }
  }
  configChangeEmitter.fire({ workspaceFolder: folder.uri.fsPath });
}

export function invalidateCollieConfigForUri(uri: Uri): void {
  const configPath = uri.scheme === 'file' ? uri.fsPath : undefined;
  const workspaceFolder = workspace.getWorkspaceFolder(uri);
  const folderKey = workspaceFolder?.uri.fsPath;

  if (configPath) {
    if (parsedCacheByPath.has(configPath) || configPathToCacheKeys.has(configPath)) {
      invalidateConfigPath(configPath, false);
    }
  }

  if (folderKey) {
    const cacheKeys = Array.from(configCacheByKey.keys());
    for (const cacheKey of cacheKeys) {
      if (cacheKey.startsWith(folderKey)) {
        removeCacheEntry(cacheKey);
      }
    }
  } else {
    clearCollieConfigCache(false);
  }

  configChangeEmitter.fire({ configPath, workspaceFolder: folderKey });
}

export function clearCollieConfigCache(notify = true): void {
  configCacheByKey.clear();
  parsedCacheByPath.clear();
  configPathToCacheKeys.clear();

  if (notify) {
    configChangeEmitter.fire({});
  }
}

export function registerCollieConfigWatcher(onEvent: (uri: Uri) => void): Disposable {
  const watcher = workspace.createFileSystemWatcher(CONFIG_GLOB);
  watcher.onDidChange(onEvent);
  watcher.onDidCreate(onEvent);
  watcher.onDidDelete(onEvent);
  return watcher;
}
