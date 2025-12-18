import * as ts from 'typescript';
import { commands, window, type OutputChannel } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { IrNode } from '../../convert/ir/nodes';
import { printCollieDocument } from '../../convert/collie/print';
import { convertJsxNodesToIr } from '../../convert/tsx/jsxToIr';
import { JsxParseError, parseJsxSelection } from '../../convert/tsx/parseSelection';

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

    try {
      const parseResult = parseJsxSelection(selectionText);
      const conversion = convertJsxNodesToIr(parseResult.rootNodes, parseResult.sourceFile);
      const collieText = printCollieDocument(conversion.nodes);
      logSelection(
        selectionText,
        parseResult.rootNodes,
        parseResult.sourceFile,
        conversion.nodes,
        collieText,
        conversion.diagnostics.warnings,
        outputChannel
      );
      if (conversion.diagnostics.warnings.length > 0) {
        window.showWarningMessage('JSX parsed with warnings. See the Collie Conversion output for details.');
      } else {
        window.showInformationMessage('Parsed JSX selection. See the Collie Conversion output for details.');
      }
    } catch (error) {
      if (error instanceof JsxParseError) {
        context.logger.warn('Failed to parse JSX selection.', error);
        window.showErrorMessage(error.message);
        return;
      }

      context.logger.error('Unexpected error while parsing JSX selection.', error);
      window.showErrorMessage('Unexpected error while parsing the JSX selection.');
    }
  });

  context.register(disposable);
}

registerFeature(registerConversionCommand);

function logSelection(
  selectionText: string,
  rootNodes: readonly ts.JsxChild[],
  sourceFile: ts.SourceFile,
  irNodes: readonly IrNode[],
  collieText: string,
  warnings: readonly string[],
  outputChannel: OutputChannel
) {
  outputChannel.appendLine('--- JSX Selection ---');
  outputChannel.appendLine(selectionText);
  outputChannel.appendLine('--- Parsed Nodes ---');

  if (rootNodes.length === 0) {
    outputChannel.appendLine('(No JSX nodes detected)');
  } else {
    for (const node of rootNodes) {
      outputChannel.appendLine(describeJsxNode(node, sourceFile));
    }
  }

  outputChannel.appendLine('--- Collie IR ---');
  outputChannel.appendLine(JSON.stringify(irNodes, null, 2));
  outputChannel.appendLine('--- Collie Output ---');
  outputChannel.appendLine(collieText || '(No Collie output generated)');

  if (warnings.length > 0) {
    outputChannel.appendLine('--- Warnings ---');
    for (const warning of warnings) {
      outputChannel.appendLine(`• ${warning}`);
    }
  }

  outputChannel.appendLine('--- End Selection ---\n');
  outputChannel.show(true);
}

function describeJsxNode(node: ts.JsxChild, sourceFile: ts.SourceFile) {
  const kind = ts.SyntaxKind[node.kind];
  const preview = summarizeNodeText(node, sourceFile);
  return `${kind}: ${preview}`;
}

function summarizeNodeText(node: ts.JsxChild, sourceFile: ts.SourceFile) {
  const raw = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  if (!raw) {
    return '(whitespace)';
  }

  const maxLength = 80;
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw;
}
