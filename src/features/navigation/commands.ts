import { commands, Uri, window, workspace } from 'vscode';
import * as path from 'path';
import type { FeatureContext } from '../types';
import { getParsedDocument } from '../../lang/cache';

/**
 * Opens the compiled HTML partial for the active Collie template.
 * Expected location: collie/dist/<id>.html relative to workspace folder.
 */
async function openCompiledHtmlPartial(context: FeatureContext) {
  const activeEditor = window.activeTextEditor;

  // Check if there's an active editor with a Collie file
  if (activeEditor?.document.languageId !== 'collie') {
    window.showWarningMessage('Please open a Collie template file to use this command.');
    return;
  }

  const document = activeEditor.document;

  try {
    // Get the logical ID from the document
    const parsed = getParsedDocument(document);
    const offset = document.offsetAt(activeEditor.selection.active);
    const section = findSectionByOffset(parsed.ast.sections, offset);
    let logicalId: string;

    if (section?.id) {
      logicalId = section.id;
    } else {
      const basename = path.basename(document.uri.fsPath, '.collie');
      let normalized = basename;
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

function findSectionByOffset(sections: { span?: { start: { offset: number }; end: { offset: number } } }[], offset: number) {
  for (const section of sections) {
    const start = section.span?.start.offset ?? 0;
    const end = section.span?.end.offset ?? Number.MAX_SAFE_INTEGER;
    if (offset >= start && offset < end) {
      return section;
    }
  }
  return sections[0];
}

export function registerNavigationCommands(context: FeatureContext) {
  context.register(
    commands.registerCommand('collie.openCompiledHtmlPartial', () => {
      return openCompiledHtmlPartial(context);
    })
  );

  context.logger.info('Navigation commands registered.');
}
