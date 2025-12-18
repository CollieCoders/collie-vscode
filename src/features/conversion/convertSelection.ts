import { commands, window } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';

const COMMAND_ID = 'collie.convertTsxSelectionToCollie';
const SUPPORTED_LANGUAGE_IDS = new Set(['typescriptreact', 'javascriptreact']);
const OUTPUT_CHANNEL_NAME = 'Collie Conversion';

function getSelectedText() {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage('Collie conversion requires an active TSX/JSX editor.');
    return undefined;
  }

  const { document, selection } = editor;
  if (!SUPPORTED_LANGUAGE_IDS.has(document.languageId)) {
    window.showErrorMessage('Collie conversion only runs in TSX/JSX editors.');
    return undefined;
  }

  if (selection.isEmpty) {
    window.showErrorMessage('Select JSX before running Collie conversion.');
    return undefined;
  }

  return document.getText(selection);
}

function registerConversionCommand(context: FeatureContext) {
  const outputChannel = window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.register(outputChannel);

  const disposable = commands.registerCommand(COMMAND_ID, () => {
    const selectionText = getSelectedText();
    if (!selectionText) {
      return;
    }

    context.logger.info('Collie conversion command invoked.');
    outputChannel.appendLine('--- JSX Selection ---');
    outputChannel.appendLine(selectionText);
    outputChannel.appendLine('--- End Selection ---\n');
    outputChannel.show(true);
    window.showInformationMessage('Logged JSX selection to the Collie Conversion output channel.');
  });

  context.register(disposable);
}

registerFeature(registerConversionCommand);
