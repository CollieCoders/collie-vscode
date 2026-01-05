import { EventEmitter, Position, Range, Uri, workspace, type Event, type TextDocument } from 'vscode';
import { TextDecoder } from 'util';
import * as path from 'path';
import type { FeatureContext } from '../features';

const COLLIE_GLOB = '**/*.collie';
const COLLIE_EXCLUDE_GLOB = '**/{node_modules,dist,build,out,coverage,.git}/**';
const EXCLUDED_DIR_NAMES = ['node_modules', 'dist', 'build', 'out', 'coverage', '.git'];
const TEMPLATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const DEFAULT_DEBOUNCE_MS = 150;
const INDEX_CHANGE_DEBOUNCE_MS = 100;
const RESCAN_DEBOUNCE_MS = 250;
const CONTENT_UPDATE_SUPPRESS_MS = 250;
const MAX_SCAN_CONCURRENCY = 8;
const INDEX_CHANGE_KEY = 'index-change';
const RESCAN_KEY = 'workspace-rescan';
const UPDATE_KEY_PREFIX = 'update:';
const textDecoder = new TextDecoder('utf-8');

export interface TemplateLocation {
  id: string;
  uri: Uri;
  idRange: Range;
  blockRange: Range;
  isValidId: boolean;
}

const entriesById = new Map<string, TemplateLocation[]>();
const entriesByFile = new Map<string, TemplateLocation[]>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const recentContentUpdates = new Map<string, number>();

const indexChangeEmitter = new EventEmitter<void>();
export const onDidChangeTemplateIndex: Event<void> = indexChangeEmitter.event;

function isExcludedPath(fsPath: string): boolean {
  for (const name of EXCLUDED_DIR_NAMES) {
    if (fsPath.includes(`${path.sep}${name}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

function isCollieUri(uri: Uri): boolean {
  return uri.fsPath.endsWith('.collie') && !isExcludedPath(uri.fsPath);
}

function isCollieDocument(document: TextDocument): boolean {
  return document.languageId === 'collie' || isCollieUri(document.uri);
}

function getLineLength(lines: string[], lineIndex: number): number {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return 0;
  }
  return lines[lineIndex].length;
}

function parseTemplateBlocks(contents: string, uri: Uri): TemplateLocation[] {
  const lines = contents.split(/\r?\n/);
  const idLines: Array<{ id: string; line: number; isValidId: boolean }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^\s*#id\s+([^\s]+)/);
    if (!match) {
      continue;
    }

    const id = match[1].trim();
    if (!id) {
      continue;
    }

    idLines.push({
      id,
      line: i,
      isValidId: TEMPLATE_ID_PATTERN.test(id)
    });
  }

  if (idLines.length === 0) {
    return [];
  }

  const locations: TemplateLocation[] = [];

  for (let i = 0; i < idLines.length; i += 1) {
    const entry = idLines[i];
    const next = idLines[i + 1];
    const blockEndLine = next ? next.line : Math.max(lines.length - 1, entry.line);
    const blockEndChar = next ? 0 : getLineLength(lines, blockEndLine);

    const idRange = new Range(
      new Position(entry.line, 0),
      new Position(entry.line, getLineLength(lines, entry.line))
    );

    const blockRange = new Range(
      new Position(entry.line, 0),
      new Position(blockEndLine, blockEndChar)
    );

    locations.push({
      id: entry.id,
      uri,
      idRange,
      blockRange,
      isValidId: entry.isValidId
    });
  }

  return locations;
}

function removeEntriesForUri(uri: Uri): void {
  const uriString = uri.toString();
  const existing = entriesByFile.get(uriString);
  if (!existing) {
    return;
  }

  for (const entry of existing) {
    const list = entriesById.get(entry.id);
    if (!list) {
      continue;
    }

    const filtered = list.filter(item => item.uri.toString() !== uriString);
    if (filtered.length === 0) {
      entriesById.delete(entry.id);
    } else if (filtered.length !== list.length) {
      entriesById.set(entry.id, filtered);
    }
  }

  entriesByFile.delete(uriString);
}

function setEntriesForUri(uri: Uri, entries: TemplateLocation[]): void {
  removeEntriesForUri(uri);

  if (entries.length === 0) {
    scheduleIndexChange();
    return;
  }

  const uriString = uri.toString();
  entriesByFile.set(uriString, entries);

  for (const entry of entries) {
    const existing = entriesById.get(entry.id) ?? [];
    existing.push(entry);
    entriesById.set(entry.id, existing);
  }

  scheduleIndexChange();
}

export function clearTemplateIndex(): void {
  entriesById.clear();
  entriesByFile.clear();
  recentContentUpdates.clear();
  scheduleIndexChange();
}

export function removeTemplateEntries(uri: Uri): void {
  removeEntriesForUri(uri);
  recentContentUpdates.delete(uri.toString());
  scheduleIndexChange();
}

export function updateTemplateIndex(uri: Uri, contents: string): void {
  const entries = parseTemplateBlocks(contents, uri);
  setEntriesForUri(uri, entries);
}

async function updateTemplateIndexFromDisk(uri: Uri): Promise<void> {
  if (!isCollieUri(uri)) {
    return;
  }

  try {
    const data = await workspace.fs.readFile(uri);
    const contents = textDecoder.decode(data);
    updateTemplateIndex(uri, contents);
  } catch {
    removeTemplateEntries(uri);
  }
}

function scheduleDebounced(key: string, action: () => void, delayMs: number): void {
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    debounceTimers.delete(key);
    action();
  }, delayMs);
  debounceTimers.set(key, handle);
}

function cancelDebounced(key: string): void {
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    debounceTimers.delete(key);
  }
}

function getUpdateKey(uri: Uri): string {
  return `${UPDATE_KEY_PREFIX}${uri.toString()}`;
}

function cancelPendingUpdate(uri: Uri): void {
  cancelDebounced(getUpdateKey(uri));
  recentContentUpdates.delete(uri.toString());
}

function recordContentUpdate(uri: Uri): void {
  recentContentUpdates.set(uri.toString(), Date.now());
}

function wasRecentlyContentUpdated(uri: Uri): boolean {
  const key = uri.toString();
  const lastUpdate = recentContentUpdates.get(key);
  if (!lastUpdate) {
    return false;
  }

  if (Date.now() - lastUpdate > CONTENT_UPDATE_SUPPRESS_MS) {
    recentContentUpdates.delete(key);
    return false;
  }

  return true;
}

function scheduleIndexChange(): void {
  scheduleDebounced(INDEX_CHANGE_KEY, () => {
    indexChangeEmitter.fire();
  }, INDEX_CHANGE_DEBOUNCE_MS);
}

export function scheduleTemplateIndexUpdate(uri: Uri, contents?: string, debounceMs = DEFAULT_DEBOUNCE_MS): void {
  if (!isCollieUri(uri)) {
    return;
  }

  if (contents !== undefined) {
    recordContentUpdate(uri);
  }

  const key = getUpdateKey(uri);
  scheduleDebounced(key, () => {
    if (contents !== undefined) {
      updateTemplateIndex(uri, contents);
    } else {
      void updateTemplateIndexFromDisk(uri);
    }
  }, debounceMs);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const cappedLimit = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  const workers = Array.from({ length: cappedLimit }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await task(items[current]);
    }
  });

  await Promise.all(workers);
}

export async function scanWorkspaceTemplates(): Promise<void> {
  clearTemplateIndex();
  const files = await workspace.findFiles(COLLIE_GLOB, COLLIE_EXCLUDE_GLOB);
  const collieFiles = files.filter(isCollieUri);
  await runWithConcurrency(collieFiles, MAX_SCAN_CONCURRENCY, updateTemplateIndexFromDisk);
}

export function getById(id: string): TemplateLocation | undefined {
  const entries = entriesById.get(id);
  return entries?.[0];
}

export function listIds(): string[] {
  return Array.from(entriesById.keys()).sort();
}

export function listByFile(uri: Uri): TemplateLocation[] {
  return entriesByFile.get(uri.toString())?.slice() ?? [];
}

export async function registerTemplateIndex(context: FeatureContext) {
  await scanWorkspaceTemplates();
  context.logger.info('Template index built.');

  context.register(
    workspace.onDidChangeTextDocument(event => {
      if (isCollieDocument(event.document)) {
        scheduleTemplateIndexUpdate(event.document.uri, event.document.getText());
      }
    })
  );

  context.register(
    workspace.onDidSaveTextDocument(document => {
      if (isCollieDocument(document)) {
        scheduleTemplateIndexUpdate(document.uri, document.getText());
      }
    })
  );

  context.register(
    workspace.onDidOpenTextDocument(document => {
      if (isCollieDocument(document)) {
        scheduleTemplateIndexUpdate(document.uri, document.getText());
      }
    })
  );

  const watcher = workspace.createFileSystemWatcher(COLLIE_GLOB);
  context.register(watcher);

  watcher.onDidChange(uri => {
    if (isCollieUri(uri)) {
      if (wasRecentlyContentUpdated(uri)) {
        return;
      }
      scheduleTemplateIndexUpdate(uri);
    }
  });

  watcher.onDidCreate(uri => {
    if (isCollieUri(uri)) {
      if (wasRecentlyContentUpdated(uri)) {
        return;
      }
      scheduleTemplateIndexUpdate(uri);
    }
  });

  watcher.onDidDelete(uri => {
    if (isCollieUri(uri)) {
      cancelPendingUpdate(uri);
      removeTemplateEntries(uri);
    }
  });

  context.register(
    workspace.onDidRenameFiles(event => {
      for (const { oldUri, newUri } of event.files) {
        if (isCollieUri(oldUri)) {
          cancelPendingUpdate(oldUri);
          removeTemplateEntries(oldUri);
        }
        if (isCollieUri(newUri)) {
          scheduleTemplateIndexUpdate(newUri);
        }
      }
    })
  );

  context.register(
    workspace.onDidChangeWorkspaceFolders(() => {
      scheduleDebounced(RESCAN_KEY, () => {
        void scanWorkspaceTemplates()
          .then(() => {
            context.logger.info('Template index rebuilt after workspace change.');
          })
          .catch(error => {
            context.logger.error('Failed to rebuild template index after workspace change.', error);
          });
      }, RESCAN_DEBOUNCE_MS);
    })
  );

  context.logger.info('Template index watcher registered.');
}
