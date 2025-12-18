import { workspace } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { clearParsedDocuments, invalidateParsedDocument } from '../../lang/cache';

function activateCacheWatcher(context: FeatureContext) {
  context.register(
    workspace.onDidCloseTextDocument(document => {
      if (document.languageId === 'collie') {
        invalidateParsedDocument(document);
      }
    })
  );

  context.register(
    workspace.onDidChangeWorkspaceFolders(() => {
      clearParsedDocuments();
    })
  );

  context.register(
    workspace.onDidDeleteFiles(() => {
      clearParsedDocuments();
    })
  );

  context.register(
    workspace.onDidCreateFiles(() => {
      clearParsedDocuments();
    })
  );

  context.register(
    workspace.onDidRenameFiles(() => {
      clearParsedDocuments();
    })
  );

  context.logger.info('Collie language cache watcher registered.');
}

registerFeature(activateCacheWatcher);
