import {
  FileSystemWatcher,
  RelativePattern,
  Uri,
  window,
  workspace,
  type TextDocument,
  type WorkspaceFolder
} from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { onDidChangeCollieConfig, resolveCollieConfigForDocument } from '../../config/collieConfig';
import { CssClassIndex, getCssIncludeGlob, isExcludedCssPath, isSupportedCssFile } from './classIndex';

const CSS_UPDATE_DEBOUNCE_MS = 200;

class WorkspaceCssIndex {
  private readonly index: CssClassIndex;
  private watcher: FileSystemWatcher | null = null;
  private enabled = false;
  private buildPromise: Promise<void> | null = null;
  private readonly pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly folder: WorkspaceFolder, private readonly context: FeatureContext) {
    this.index = new CssClassIndex(folder, context.logger);
  }

  getIndex(): CssClassIndex {
    return this.index;
  }

  async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }

    this.enabled = true;

    if (this.buildPromise) {
      await this.buildPromise;
      return;
    }

    this.buildPromise = this.index.buildIndex();
    try {
      await this.buildPromise;
    } finally {
      this.buildPromise = null;
    }

    if (!this.enabled) {
      this.index.clear();
      return;
    }

    this.startWatching();
  }

  disable(): void {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.stopWatching();
    this.index.clear();
  }

  scheduleIndex(uri: Uri): void {
    if (!this.enabled) {
      return;
    }

    if (!isSupportedCssFile(uri.fsPath) || isExcludedCssPath(uri.fsPath)) {
      return;
    }

    const key = uri.toString();
    const existing = this.pendingUpdates.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const handle = setTimeout(() => {
      this.pendingUpdates.delete(key);
      void this.index.indexFile(uri);
    }, CSS_UPDATE_DEBOUNCE_MS);
    this.pendingUpdates.set(key, handle);
  }

  removeFile(uri: Uri): void {
    if (!this.enabled) {
      return;
    }
    this.index.removeFile(uri);
  }

  dispose(): void {
    this.disable();
  }

  private startWatching(): void {
    if (this.watcher) {
      return;
    }

    this.watcher = workspace.createFileSystemWatcher(
      new RelativePattern(this.folder, getCssIncludeGlob())
    );

    this.watcher.onDidChange(uri => this.scheduleIndex(uri));
    this.watcher.onDidCreate(uri => this.scheduleIndex(uri));
    this.watcher.onDidDelete(uri => this.removeFile(uri));
  }

  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }

    for (const handle of this.pendingUpdates.values()) {
      clearTimeout(handle);
    }
    this.pendingUpdates.clear();
  }
}

const workspaceIndexes = new Map<string, WorkspaceCssIndex>();

function isCollieDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function getFolderKey(document: TextDocument): string | null {
  const folder = workspace.getWorkspaceFolder(document.uri);
  return folder?.uri.fsPath ?? null;
}

function isCssDocument(document: TextDocument): boolean {
  if (document.uri.scheme !== 'file') {
    return false;
  }
  if (!isSupportedCssFile(document.uri.fsPath)) {
    return false;
  }
  if (isExcludedCssPath(document.uri.fsPath)) {
    return false;
  }
  return true;
}

async function shouldEnableCssIndex(folder: WorkspaceFolder, context: FeatureContext): Promise<boolean> {
  const collieDocs = workspace.textDocuments.filter(
    doc => isCollieDocument(doc) && workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath === folder.uri.fsPath
  );

  if (collieDocs.length === 0) {
    return false;
  }

  for (const document of collieDocs) {
    const config = await resolveCollieConfigForDocument(document, context.logger);
    if (config.flags.enableCssIndex) {
      return true;
    }
  }

  return false;
}

async function refreshWorkspaceIndex(folder: WorkspaceFolder, context: FeatureContext): Promise<void> {
  const enable = await shouldEnableCssIndex(folder, context);
  const key = folder.uri.fsPath;
  const existing = workspaceIndexes.get(key);

  if (enable) {
    const entry = existing ?? new WorkspaceCssIndex(folder, context);
    if (!existing) {
      workspaceIndexes.set(key, entry);
    }
    await entry.enable();
    return;
  }

  existing?.disable();
}

function removeWorkspaceIndex(folder: WorkspaceFolder): void {
  const key = folder.uri.fsPath;
  const existing = workspaceIndexes.get(key);
  if (existing) {
    existing.dispose();
    workspaceIndexes.delete(key);
  }
}

export function getCssClassIndexForDocument(document: TextDocument): CssClassIndex | undefined {
  const folderKey = getFolderKey(document);
  if (!folderKey) {
    return undefined;
  }
  return workspaceIndexes.get(folderKey)?.getIndex();
}

function activateCssIndex(context: FeatureContext) {
  const refreshAll = () => {
    for (const folder of workspace.workspaceFolders ?? []) {
      void refreshWorkspaceIndex(folder, context);
    }
  };

  context.register(
    workspace.onDidOpenTextDocument(document => {
      if (isCollieDocument(document)) {
        const folder = workspace.getWorkspaceFolder(document.uri);
        if (folder) {
          void refreshWorkspaceIndex(folder, context);
        }
      } else if (isCssDocument(document)) {
        const folder = workspace.getWorkspaceFolder(document.uri);
        if (folder) {
          const indexEntry = workspaceIndexes.get(folder.uri.fsPath);
          indexEntry?.scheduleIndex(document.uri);
        }
      }
    })
  );

  context.register(
    window.onDidChangeActiveTextEditor(editor => {
      if (!editor) {
        return;
      }
      if (isCollieDocument(editor.document)) {
        const folder = workspace.getWorkspaceFolder(editor.document.uri);
        if (folder) {
          void refreshWorkspaceIndex(folder, context);
        }
      }
    })
  );

  context.register(
    workspace.onDidSaveTextDocument(document => {
      if (isCssDocument(document)) {
        const folder = workspace.getWorkspaceFolder(document.uri);
        if (folder) {
          const indexEntry = workspaceIndexes.get(folder.uri.fsPath);
          indexEntry?.scheduleIndex(document.uri);
        }
      }
    })
  );

  context.register(
    workspace.onDidCloseTextDocument(document => {
      if (isCollieDocument(document)) {
        const folder = workspace.getWorkspaceFolder(document.uri);
        if (folder) {
          void refreshWorkspaceIndex(folder, context);
        }
      }
    })
  );

  context.register(
    onDidChangeCollieConfig(() => {
      refreshAll();
    })
  );

  context.register(
    workspace.onDidChangeWorkspaceFolders(event => {
      for (const folder of event.removed) {
        removeWorkspaceIndex(folder);
      }
      for (const folder of event.added) {
        void refreshWorkspaceIndex(folder, context);
      }
    })
  );

  refreshAll();

  context.logger.info('Collie CSS class indexer registered.');
}

registerFeature(activateCssIndex);
