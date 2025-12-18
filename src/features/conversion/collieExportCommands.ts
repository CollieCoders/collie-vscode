import { commands, env, window, workspace, type OutputChannel, type TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { CollieExportResult, CollieExportTarget } from '../../convert/export/collieExport';
import { exportCollieDocument } from '../../convert/export/collieExport';

const COLLIE_LANGUAGE_ID = 'collie';
const COPY_AS_JSX_COMMAND = 'collie.copyAsJsx';
const COPY_AS_TSX_COMMAND = 'collie.copyAsTsx';
const OUTPUT_CHANNEL_NAME = 'Collie Export';

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

async function runCopyCommand(context: FeatureContext, target: CollieExportTarget, outputChannel: OutputChannel) {
  const document = requireActiveCollieDocument();
  if (!document) {
    return;
  }

  const documentText = document.getText();
  context.logger.info(`[${target}] Collie export command invoked for ${document.uri.toString(true)}.`);
  context.logger.info(`[${target}] Collie document contents:\n${documentText}`);

  const exportResult = exportCollieDocument(document, target);
  logExportResult(document, documentText, exportResult, outputChannel);

  if (exportResult.kind === 'failure') {
    window.showWarningMessage(`Collie export could not parse the document. See ${OUTPUT_CHANNEL_NAME} output for details.`);
    return;
  }

  await deliverExportSnippet(exportResult);
}

function logExportResult(
  document: TextDocument,
  sourceText: string,
  result: CollieExportResult,
  outputChannel: OutputChannel
) {
  outputChannel.appendLine(`--- Collie Export (${result.target}) ---`);
  outputChannel.appendLine(`Document: ${document.uri.toString(true)}`);
  outputChannel.appendLine('--- Source ---');
  outputChannel.appendLine(sourceText || '(Empty document)');
  outputChannel.appendLine('--- Output ---');
  outputChannel.appendLine(result.outputText);

  if (result.kind === 'success') {
    outputChannel.appendLine('--- AST (JSON) ---');
    outputChannel.appendLine(JSON.stringify(result.ast, null, 2));
    outputChannel.appendLine('--- IR (JSON) ---');
    outputChannel.appendLine(JSON.stringify(result.irNodes, null, 2));
  }

  if (result.diagnostics.length > 0) {
    outputChannel.appendLine('--- Diagnostics ---');
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.span?.start;
      const locationText = location ? ` (line ${location.line}, column ${location.col})` : '';
      outputChannel.appendLine(`• ${diagnostic.message}${locationText}`);
    }
  }

  outputChannel.appendLine('--- End Export ---\n');
  outputChannel.show(true);
}

async function deliverExportSnippet(result: Extract<CollieExportResult, { kind: 'success' }>) {
  await env.clipboard.writeText(result.outputText);
  const document = await workspace.openTextDocument({
    language: result.target === 'TSX' ? 'typescriptreact' : 'javascriptreact',
    content: result.outputText
  });
  await window.showTextDocument(document, { preview: true });
  window.showInformationMessage(`Copied Collie ${result.target} snippet to clipboard and opened a preview.`);
}

function registerCollieExportCommands(context: FeatureContext) {
  const outputChannel = window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.register(outputChannel);

  context.register(
    commands.registerCommand(COPY_AS_JSX_COMMAND, () => {
      return runCopyCommand(context, 'JSX', outputChannel);
    })
  );

  context.register(
    commands.registerCommand(COPY_AS_TSX_COMMAND, () => {
      return runCopyCommand(context, 'TSX', outputChannel);
    })
  );
}

registerFeature(registerCollieExportCommands);
