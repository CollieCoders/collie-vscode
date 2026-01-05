import type { Uri} from 'vscode';
import { EventEmitter, workspace, type Event } from 'vscode';
import type { FeatureContext } from '../../features/types';
import type { TemplateLocation } from './types';
import { isCollieUri, isCollieDocument } from './helpers/exclude';
import { parseTemplateBlocks } from './helpers/parseBlocks';
import { scheduleDebounced, cancelDebounced } from './helpers/debounce';
import { scanWorkspaceTemplates, updateTemplateIndexFromDisk } from './helpers/scan';

const DEFAULT_DEBOUNCE_MS = 150;
const INDEX_CHANGE_DEBOUNCE_MS = 100;
const RESCAN_DEBOUNCE_MS = 250;
const CONTENT_UPDATE_SUPPRESS_MS = 250;
const INDEX_CHANGE_KEY = 'index-change';
const RESCAN_KEY = 'workspace-rescan';
const UPDATE_KEY_PREFIX = 'update:';

const entriesById = new Map<string, TemplateLocation[]>();
const entriesByFile = new Map<string, TemplateLocation[]>();
const recentContentUpdates = new Map<string, number>();

const indexChangeEmitter = new EventEmitter<void>();
export const onDidChangeTemplateIndex: Event<void> = indexChangeEmitter.event;

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
      void updateTemplateIndexFromDisk(uri, setEntriesForUri, removeEntriesForUri);
    }
  }, debounceMs);
}

export async function scanWorkspace(): Promise<void> {
  await scanWorkspaceTemplates(
    clearTemplateIndex,
    (uri) => updateTemplateIndexFromDisk(uri, setEntriesForUri, removeEntriesForUri)
  );
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
  await scanWorkspace();
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

  const watcher = workspace.createFileSystemWatcher('**/*.collie');
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
        void scanWorkspace()
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
