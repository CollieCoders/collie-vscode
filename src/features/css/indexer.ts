import type {
  FileSystemWatcher,
  Uri} from 'vscode';
import {
  RelativePattern,
  window,
  workspace,
  type ConfigurationChangeEvent,
  type TextDocument,
  type WorkspaceFolder
} from 'vscode';
import type { FeatureContext } from '../types';
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

  async rebuild(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.index.buildIndex();
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
const UNKNOWN_CLASS_OVERRIDE_KEY = 'css.diagnostics.unknownClassOverride';

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

export function getUnknownClassOverrideSetting(): 'inherit' | 'on' | 'off' {
  const config = workspace.getConfiguration('collie');
  const value = config.get<string>(UNKNOWN_CLASS_OVERRIDE_KEY, 'inherit');
  if (value === 'on' || value === 'off') {
    return value;
  }
  return 'inherit';
}

interface CssIndexDecision {
  enable: boolean;
  reason: 'enabled' | 'no-collie-doc' | 'tailwind' | 'disabled' | 'override-off';
}

async function shouldEnableCssIndex(folder: WorkspaceFolder, context: FeatureContext): Promise<CssIndexDecision> {
  const collieDocs = workspace.textDocuments.filter(
    doc => isCollieDocument(doc) && workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath === folder.uri.fsPath
  );

  if (collieDocs.length === 0) {
    return { enable: false, reason: 'no-collie-doc' };
  }

  const override = getUnknownClassOverrideSetting();
  if (override === 'off') {
    return { enable: false, reason: 'override-off' };
  }

  let sawTailwind = false;

  for (const document of collieDocs) {
    const config = await resolveCollieConfigForDocument(document, context.logger);
    if (config.flags.isTailwind) {
      sawTailwind = true;
      continue;
    }
    if (config.flags.enableCssIndex) {
      return { enable: true, reason: 'enabled' };
    }
    if (override === 'on' && config.flags.isGlobal) {
      return { enable: true, reason: 'enabled' };
    }
  }

  return { enable: false, reason: sawTailwind ? 'tailwind' : 'disabled' };
}

async function refreshWorkspaceIndex(folder: WorkspaceFolder, context: FeatureContext): Promise<void> {
  const decision = await shouldEnableCssIndex(folder, context);
  const key = folder.uri.fsPath;
  const existing = workspaceIndexes.get(key);

  if (decision.enable) {
    const entry = existing ?? new WorkspaceCssIndex(folder, context);
    if (!existing) {
      workspaceIndexes.set(key, entry);
    }
    await entry.enable();
    return;
  }

  existing?.disable();
  if (decision.reason === 'tailwind') {
    context.logger.info(`CSS index disabled for ${folder.name} (Tailwind strategy).`);
  } else if (decision.reason === 'override-off') {
    context.logger.info(`CSS index disabled for ${folder.name} (override off).`);
  } else if (decision.reason === 'disabled') {
    context.logger.info(`CSS index disabled for ${folder.name} (config).`);
  }
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

export async function rebuildCssClassIndexForWorkspace(folder: WorkspaceFolder): Promise<boolean> {
  const entry = workspaceIndexes.get(folder.uri.fsPath);
  if (!entry) {
    return false;
  }
  await entry.rebuild();
  return true;
}

export async function ensureCssIndexForWorkspace(
  folder: WorkspaceFolder,
  context: FeatureContext
): Promise<boolean> {
  await refreshWorkspaceIndex(folder, context);
  return rebuildCssClassIndexForWorkspace(folder);
}

function affectsUnknownClassOverride(event: ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(`collie.${UNKNOWN_CLASS_OVERRIDE_KEY}`);
}

export function registerCssIndexer(context: FeatureContext) {
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
    workspace.onDidChangeConfiguration(event => {
      if (affectsUnknownClassOverride(event)) {
        refreshAll();
      }
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
