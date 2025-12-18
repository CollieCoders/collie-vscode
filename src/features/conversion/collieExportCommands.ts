import { commands, window, type TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';

const COLLIE_LANGUAGE_ID = 'collie';
const COPY_AS_JSX_COMMAND = 'collie.copyAsJsx';
const COPY_AS_TSX_COMMAND = 'collie.copyAsTsx';

type ExportTarget = 'JSX' | 'TSX';

function requireActiveCollieDocument(): TextDocument | undefined {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage('Collie export requires an active Collie editor.');
    return undefined;
  }

  if (editor.document.languageId !== COLLIE_LANGUAGE_ID) {
    window.showErrorMessage('Open a Collie file to export it as JSX or TSX.');
    return undefined;
  }

  return editor.document;
}

async function runCopyCommand(context: FeatureContext, target: ExportTarget) {
  const document = requireActiveCollieDocument();
  if (!document) {
    return;
  }

  const documentText = document.getText();
  context.logger.info(`[${target}] Collie export command invoked for ${document.uri.toString(true)}.`);
  context.logger.info(`[${target}] Collie document contents:\n${documentText}`);

  window.showInformationMessage(`Collie: Copy as ${target} command registered. Conversion coming soon.`);
}

function registerCollieExportCommands(context: FeatureContext) {
  context.register(
    commands.registerCommand(COPY_AS_JSX_COMMAND, () => {
      return runCopyCommand(context, 'JSX');
    })
  );

  context.register(
    commands.registerCommand(COPY_AS_TSX_COMMAND, () => {
      return runCopyCommand(context, 'TSX');
    })
  );
}

registerFeature(registerCollieExportCommands);
