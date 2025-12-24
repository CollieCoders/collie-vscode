import { commands, Uri, window, workspace } from 'vscode';
import * as path from 'path';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { getParsedDocument } from '../../lang/cache';

/**
 * Opens the compiled HTML partial for the active Collie template.
 * Expected location: collie/dist/<id>.html relative to workspace folder.
 */
async function openCompiledHtmlPartial(context: FeatureContext) {
  const activeEditor = window.activeTextEditor;
  
  // Check if there's an active editor with a Collie file
  if (!activeEditor || activeEditor.document.languageId !== 'collie') {
    window.showWarningMessage('Please open a Collie template file to use this command.');
    return;
  }
  
  const document = activeEditor.document;
  
  try {
    // Get the logical ID from the document
    const parsed = getParsedDocument(document);
    let logicalId: string;
    
    if (parsed.ast.id) {
      // Explicit ID directive
      logicalId = parsed.ast.id;
    } else {
      // Derive from filename
      const basename = path.basename(document.uri.fsPath, '.collie');
      let normalized = basename;
      // Strip trailing -collie from filename
      if (normalized.endsWith('-collie')) {
        normalized = normalized.slice(0, -7);
      }
      logicalId = normalized;
    }
    
    // Find the workspace folder containing this file
    const workspaceFolder = workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      window.showWarningMessage('This file is not part of a workspace folder.');
      return;
    }
    
    // Construct the expected path: collie/dist/<id>.html
    const compiledHtmlPath = path.join(workspaceFolder.uri.fsPath, 'collie', 'dist', `${logicalId}.html`);
    const compiledHtmlUri = Uri.file(compiledHtmlPath);
    
    // Check if the file exists
    try {
      await workspace.fs.stat(compiledHtmlUri);
      
      // File exists, open it
      const htmlDocument = await workspace.openTextDocument(compiledHtmlUri);
      await window.showTextDocument(htmlDocument);
      
      context.logger.info(`Opened compiled HTML partial: ${compiledHtmlPath}`);
    } catch (error) {
      // File does not exist
      window.showInformationMessage(
        `No compiled HTML partial found at "collie/dist/${logicalId}.html" for template id "${logicalId}".`
      );
    }
  } catch (error) {
    context.logger.error('Failed to open compiled HTML partial.', error);
    window.showErrorMessage('An error occurred while trying to open the compiled HTML partial.');
  }
}

function registerNavigationCommands(context: FeatureContext) {
  context.register(
    commands.registerCommand('collie.openCompiledHtmlPartial', () => {
      return openCompiledHtmlPartial(context);
    })
  );
  
  context.logger.info('Navigation commands registered.');
}

registerFeature(registerNavigationCommands);
