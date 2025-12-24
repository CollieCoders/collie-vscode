import { workspace, TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { 
  scanWorkspaceHtmlFiles, 
  updateHtmlAnchors, 
  removeHtmlAnchors,
  clearHtmlAnchorIndex
} from '../../lang/htmlAnchorIndex';

function isHtmlDocument(document: TextDocument): boolean {
  return document.languageId === 'html' || document.fileName.endsWith('.html');
}

async function activateHtmlAnchorWatcher(context: FeatureContext) {
  // Initial scan of workspace HTML files
  await scanWorkspaceHtmlFiles();
  context.logger.info('Initial HTML anchor index built.');
  
  // Watch for HTML file changes
  context.register(
    workspace.onDidChangeTextDocument(event => {
      if (isHtmlDocument(event.document)) {
        updateHtmlAnchors(event.document.uri, event.document.getText());
      }
    })
  );
  
  // Watch for HTML file saves
  context.register(
    workspace.onDidSaveTextDocument(document => {
      if (isHtmlDocument(document)) {
        updateHtmlAnchors(document.uri, document.getText());
      }
    })
  );
  
  // Watch for HTML file opening
  context.register(
    workspace.onDidOpenTextDocument(document => {
      if (isHtmlDocument(document)) {
        updateHtmlAnchors(document.uri, document.getText());
      }
    })
  );
  
  // Watch for HTML file closing
  context.register(
    workspace.onDidCloseTextDocument(document => {
      if (isHtmlDocument(document)) {
        // Don't remove on close, only on delete
      }
    })
  );
  
  // Watch for file creation
  context.register(
    workspace.onDidCreateFiles(async event => {
      for (const uri of event.files) {
        if (uri.fsPath.endsWith('.html')) {
          try {
            const document = await workspace.openTextDocument(uri);
            updateHtmlAnchors(uri, document.getText());
          } catch (error) {
            context.logger.error(`Failed to scan newly created HTML file: ${uri.fsPath}`, error);
          }
        }
      }
    })
  );
  
  // Watch for file deletion
  context.register(
    workspace.onDidDeleteFiles(event => {
      for (const uri of event.files) {
        if (uri.fsPath.endsWith('.html')) {
          removeHtmlAnchors(uri);
        }
      }
    })
  );
  
  // Watch for file rename
  context.register(
    workspace.onDidRenameFiles(async event => {
      for (const { oldUri, newUri } of event.files) {
        if (oldUri.fsPath.endsWith('.html')) {
          removeHtmlAnchors(oldUri);
        }
        if (newUri.fsPath.endsWith('.html')) {
          try {
            const document = await workspace.openTextDocument(newUri);
            updateHtmlAnchors(newUri, document.getText());
          } catch (error) {
            context.logger.error(`Failed to scan renamed HTML file: ${newUri.fsPath}`, error);
          }
        }
      }
    })
  );
  
  // Watch for workspace folder changes
  context.register(
    workspace.onDidChangeWorkspaceFolders(async () => {
      await scanWorkspaceHtmlFiles();
      context.logger.info('HTML anchor index rebuilt after workspace change.');
    })
  );
  
  context.logger.info('HTML anchor index watcher registered.');
}

registerFeature(activateHtmlAnchorWatcher);
