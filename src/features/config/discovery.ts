import { window, workspace, type TextDocument, type Uri } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import {
  clearCollieConfigCache,
  invalidateCollieConfigForUri,
  onDidChangeCollieConfig,
  registerCollieConfigWatcher,
  resolveCollieConfigForDocument
} from '../../config/collieConfig';

function isCollieDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

async function handleCollieDocument(document: TextDocument, context: FeatureContext): Promise<void> {
  if (!isCollieDocument(document)) {
    return;
  }

  await resolveCollieConfigForDocument(document, context.logger);
}

function activateConfigDiscovery(context: FeatureContext) {
  let watcherInitialized = false;

  const ensureWatcher = () => {
    if (watcherInitialized) {
      return;
    }
    watcherInitialized = true;

    context.register(
      registerCollieConfigWatcher((uri: Uri) => {
        invalidateCollieConfigForUri(uri);
      })
    );

    context.register(
      workspace.onDidChangeWorkspaceFolders(() => {
        clearCollieConfigCache();
      })
    );
  };

  const handleDocument = async (document: TextDocument) => {
    if (!isCollieDocument(document)) {
      return;
    }
    ensureWatcher();
    await handleCollieDocument(document, context);
  };

  context.register(
    workspace.onDidOpenTextDocument(document => {
      void handleDocument(document);
    })
  );

  context.register(
    window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        void handleDocument(editor.document);
      }
    })
  );

  context.register(
    onDidChangeCollieConfig(() => {
      for (const document of workspace.textDocuments) {
        if (isCollieDocument(document)) {
          void handleCollieDocument(document, context);
        }
      }
    })
  );

  for (const document of workspace.textDocuments) {
    if (isCollieDocument(document)) {
      void handleDocument(document);
    }
  }

  context.logger.info('Collie config discovery registered.');
}

registerFeature(activateConfigDiscovery);
