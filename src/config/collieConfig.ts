import {
  EventEmitter,
  Uri,
  workspace,
  type TextDocument,
  type WorkspaceFolder,
  type Disposable
} from 'vscode';
import * as path from 'path';
import type { Logger } from '../logger';
import type {
  CollieConfigParsed,
  CollieConfigResult,
  CollieConfigChange
} from './types';
import { CONFIG_GLOB } from './constants';
import {
  createDefaultFlags,
  extractConfigFields,
  normalizeResult,
  getCacheKey,
  findNearestConfigPath,
  loadConfigFile
} from './helpers';

const configCacheByKey = new Map<string, CollieConfigResult>();
const parsedCacheByPath = new Map<string, CollieConfigParsed>();
const configPathToCacheKeys = new Map<string, Set<string>>();

const configChangeEmitter = new EventEmitter<CollieConfigChange>();
export const onDidChangeCollieConfig = configChangeEmitter.event;

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
