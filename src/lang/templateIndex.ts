import { EventEmitter, Position, Range, Uri, workspace, type Event, type TextDocument } from 'vscode';
import { TextDecoder } from 'util';
import * as path from 'path';
import type { FeatureContext } from '../features';

const COLLIE_GLOB = '**/*.collie';
const COLLIE_EXCLUDE_GLOB = '**/node_modules/**';
const TEMPLATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const DEFAULT_DEBOUNCE_MS = 150;
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
const pendingUpdates = new Map<string, NodeJS.Timeout>();

const indexChangeEmitter = new EventEmitter<void>();
export const onDidChangeTemplateIndex: Event<void> = indexChangeEmitter.event;

function isCollieUri(uri: Uri): boolean {
  return uri.fsPath.endsWith('.collie') && !uri.fsPath.includes(`${path.sep}node_modules${path.sep}`);
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
    indexChangeEmitter.fire();
    return;
  }

  const uriString = uri.toString();
  entriesByFile.set(uriString, entries);

  for (const entry of entries) {
    const existing = entriesById.get(entry.id) ?? [];
    existing.push(entry);
    entriesById.set(entry.id, existing);
  }

  indexChangeEmitter.fire();
}

export function clearTemplateIndex(): void {
  entriesById.clear();
  entriesByFile.clear();
  indexChangeEmitter.fire();
}

export function removeTemplateEntries(uri: Uri): void {
  removeEntriesForUri(uri);
  indexChangeEmitter.fire();
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

function cancelPendingUpdate(uri: Uri): void {
  const key = uri.toString();
  const timer = pendingUpdates.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingUpdates.delete(key);
  }
}

export function scheduleTemplateIndexUpdate(uri: Uri, contents?: string, debounceMs = DEFAULT_DEBOUNCE_MS): void {
  if (!isCollieUri(uri)) {
    return;
  }

  cancelPendingUpdate(uri);
  const key = uri.toString();
  const timer = setTimeout(() => {
    pendingUpdates.delete(key);
    if (contents !== undefined) {
      updateTemplateIndex(uri, contents);
    } else {
      void updateTemplateIndexFromDisk(uri);
    }
  }, debounceMs);
  pendingUpdates.set(key, timer);
}

export async function scanWorkspaceTemplates(): Promise<void> {
  clearTemplateIndex();
  const files = await workspace.findFiles(COLLIE_GLOB, COLLIE_EXCLUDE_GLOB);
  for (const uri of files) {
    if (isCollieUri(uri)) {
      await updateTemplateIndexFromDisk(uri);
    }
  }
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
      scheduleTemplateIndexUpdate(uri);
    }
  });

  watcher.onDidCreate(uri => {
    if (isCollieUri(uri)) {
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
    workspace.onDidChangeWorkspaceFolders(async () => {
      await scanWorkspaceTemplates();
      context.logger.info('Template index rebuilt after workspace change.');
    })
  );

  context.logger.info('Template index watcher registered.');
}
