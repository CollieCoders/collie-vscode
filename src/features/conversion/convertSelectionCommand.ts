import * as ts from 'typescript';
import { basename, dirname, join } from 'path';
import {
  env,
  Uri,
  window,
  workspace,
  type OutputChannel,
  type TextDocument,
  Range,
  Position,
  WorkspaceEdit,
  EndOfLine
} from 'vscode';
import type { FeatureContext } from '..';
import type { IrNode } from '../../convert/ir/nodes';
import { printCollieDocument } from '../../convert/collie/print';
import { convertJsxNodesToIr } from '../../convert/tsx/jsxToIr';
import { JsxParseError, parseJsxSelection } from '../../convert/tsx/parseSelection';
import { listByFile, listIds } from '../../lang/templateIndex';
import { warnIfMissingConfig, warnIfMissingTooling } from '../config/warnings';
import { findMatchingTemplates, writeTemplateBlock } from './collieFileWriter';
import { ensureCollieImport } from './imports';
import { deriveTargetFileBase, deriveTemplateId } from './templateId';

const SUPPORTED_LANGUAGE_IDS = new Set(['typescriptreact', 'javascriptreact']);
const OUTPUT_CHANNEL_NAME = 'Collie Conversion';

interface SelectionContext {
  readonly document: TextDocument;
  readonly text: string;
  readonly selection: Range;
}

function getSelectionContext(): SelectionContext | undefined {
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

  if (document.isUntitled || document.uri.scheme !== 'file') {
    window.showErrorMessage('Save the file before running Collie conversion.');
    return undefined;
  }

  return {
    document,
    text: document.getText(selection),
    selection
  };
}

let outputChannel: OutputChannel | undefined;

function getConversionOutputChannel(context: FeatureContext): OutputChannel {
  if (!outputChannel) {
    outputChannel = window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.register(outputChannel);
  }
  return outputChannel;
}

export async function runConvertTsxSelectionToCollie(context: FeatureContext): Promise<void> {
  const selection = getSelectionContext();
  if (!selection) {
    return;
  }

  await warnIfMissingConfig(selection.document, context);
  await warnIfMissingTooling(selection.document, context);

  const channel = getConversionOutputChannel(context);
  context.logger.info('Collie conversion command invoked.');

  try {
    const parseResult = parseJsxSelection(selection.text);
    const conversion = convertJsxNodesToIr(parseResult.rootNodes, parseResult.sourceFile);
    const collieText = printCollieDocument(conversion.nodes);
    const warnings = conversion.diagnostics.warnings;
    const extractedSelection = parseResult.selectionText !== selection.text;
    logSelection(
      parseResult.selectionText,
      parseResult.rootNodes,
      parseResult.sourceFile,
      conversion.nodes,
      collieText,
      warnings,
      channel,
      extractedSelection
    );

    const targetUri = suggestCollieFileUri(selection.document);

    if (targetUri) {
      const matches = await findMatchingTemplates(targetUri, collieText);
      if (matches.length > 0) {
        const pickItems: Array<{ label: string; description?: string; templateId?: string }> = [
          { label: 'Create new template' },
          ...matches.map(match => ({
            label: `Reuse existing id: ${match.id}`,
            description: `${basename(targetUri.fsPath)}:${match.idLine + 1}`,
            templateId: match.id
          }))
        ];

        const picked = await window.showQuickPick(pickItems, {
          placeHolder: 'Found a matching template. Reuse an existing id or create a new template.'
        });

        if (!picked) {
          return;
        }

        if (picked.templateId) {
          const applied = await applyTsxEdits(selection, picked.templateId);
          if (applied) {
            if (warnings.length > 0) {
              window.showWarningMessage(
                `Reused existing template id "${picked.templateId}". JSX parsed with warnings; see the Collie Conversion output.`
              );
            } else {
              window.showInformationMessage(`Reused existing template id "${picked.templateId}".`);
            }
          } else {
            window.showWarningMessage(`Reused template id "${picked.templateId}" but could not update the TSX selection.`);
          }
          return;
        }
      }
    }

    const existingIds = new Set(listIds());
    if (targetUri) {
      for (const entry of listByFile(targetUri)) {
        existingIds.add(entry.id);
      }
    }
    const templateId = deriveTemplateId(selection.document, selection.selection, existingIds);
    const created = await deliverCollieOutput(selection.document, collieText, templateId, targetUri);
    if (created) {
      const applied = await applyTsxEdits(selection, created.templateId);
      const filename = basename(created.uri.fsPath);
      const action = created.wasCreated ? 'Created' : 'Updated';
      const insertionMessage = `${action} ${filename}, inserted <Collie id="${created.templateId}">.`;
      if (applied) {
        if (warnings.length > 0) {
          window.showWarningMessage(
            `${insertionMessage} JSX parsed with warnings; see the Collie Conversion output.`
          );
        } else {
          window.showInformationMessage(insertionMessage);
        }
      } else {
        window.showWarningMessage(`${action} ${filename} but could not update the TSX selection.`);
      }
    }
  } catch (error) {
    if (error instanceof JsxParseError) {
      context.logger.warn('Failed to parse JSX selection.', error);
      window.showErrorMessage(error.message);
      if (error.message.includes('Selection must contain at least one valid JSX element or fragment')) {
        channel.appendLine('Tip: Select a full JSX element or fragment. The converter can extract JSX from extra tokens,');
        channel.appendLine('but it still needs a complete element or fragment boundary.');
        channel.show(true);
      }
      return;
    }

    context.logger.error('Unexpected error while converting JSX selection.', error);
    window.showErrorMessage('Unexpected error while converting the JSX selection.');
  }
}

function logSelection(
  selectionText: string,
  rootNodes: readonly ts.JsxChild[],
  sourceFile: ts.SourceFile,
  irNodes: readonly IrNode[],
  collieText: string,
  warnings: readonly string[],
  outputChannel: OutputChannel,
  extractedSelection: boolean
) {
  outputChannel.appendLine('--- JSX Selection ---');
  outputChannel.appendLine(selectionText);
  if (extractedSelection) {
    outputChannel.appendLine('--- Note ---');
    outputChannel.appendLine('Extracted JSX from selection boundaries.');
  }
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

interface CollieCreationResult {
  uri: Uri;
  templateId: string;
  idLine: number;
  wasCreated: boolean;
}

async function deliverCollieOutput(
  document: TextDocument,
  collieText: string,
  templateId: string,
  targetUri: Uri | undefined
): Promise<CollieCreationResult | null> {
  if (!collieText.trim()) {
    window.showWarningMessage('Collie conversion produced empty output. Nothing to deliver.');
    return null;
  }

  if (!targetUri) {
    window.showWarningMessage('Unable to determine where to create the Collie file.');
    await copyCollieToClipboard(collieText);
    return null;
  }

  const result = await writeTemplateBlock(
    targetUri,
    templateId,
    collieText,
    document.eol === EndOfLine.CRLF ? '\r\n' : '\n'
  );
  await openCollieDocumentAt(result.uri, result.idLine);
  return { uri: result.uri, templateId, idLine: result.idLine, wasCreated: result.wasCreated };
}

async function copyCollieToClipboard(collieText: string) {
  await env.clipboard.writeText(collieText);
  const doc = await workspace.openTextDocument({
    language: 'collie',
    content: collieText
  });
  await window.showTextDocument(doc, { preview: true });
  window.showInformationMessage('Copied Collie output to clipboard and opened a preview.');
}

async function openCollieDocumentAt(uri: Uri, idLine: number): Promise<void> {
  const doc = await workspace.openTextDocument(uri);
  const line = Math.min(Math.max(idLine, 0), Math.max(doc.lineCount - 1, 0));
  const position = new Position(line, 0);
  await window.showTextDocument(doc, { preview: false, selection: new Range(position, position) });
}

function suggestCollieFileUri(document: TextDocument): Uri | undefined {
  if (document.uri.scheme !== 'file') {
    return undefined;
  }

  const fsPath = document.uri.fsPath;
  const dir = dirname(fsPath);
  const base = deriveTargetFileBase(document);
  return Uri.file(join(dir, `${base}.collie`));
}

async function applyTsxEdits(
  selection: SelectionContext,
  templateId: string
): Promise<boolean> {
  const document = selection.document;
  const sourceText = document.getText();
  const sourceFile = ts.createSourceFile(
    document.uri.fsPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    document.languageId === 'javascriptreact' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  );

  const edit = new WorkspaceEdit();
  edit.replace(document.uri, selection.selection, `<Collie id="${templateId}" />`);
  ensureCollieImport(document, sourceFile, edit);

  return workspace.applyEdit(edit);
}
