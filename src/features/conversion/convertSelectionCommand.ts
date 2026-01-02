import * as ts from 'typescript';
import { basename, dirname, extname, join, relative } from 'path';
import { TextEncoder } from 'util';
import {
  env,
  Uri,
  window,
  workspace,
  type OutputChannel,
  type TextDocument,
  Range,
  WorkspaceEdit,
  EndOfLine
} from 'vscode';
import type { FeatureContext } from '..';
import type { IrNode } from '../../convert/ir/nodes';
import { printCollieDocument } from '../../convert/collie/print';
import { convertJsxNodesToIr } from '../../convert/tsx/jsxToIr';
import { JsxParseError, parseJsxSelection } from '../../convert/tsx/parseSelection';

const SUPPORTED_LANGUAGE_IDS = new Set(['typescriptreact', 'javascriptreact']);
const OUTPUT_CHANNEL_NAME = 'Collie Conversion';
const DEFAULT_COMPONENT_NAME = 'CollieSelection';

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

  const channel = getConversionOutputChannel(context);
  context.logger.info('Collie conversion command invoked.');

  try {
    const parseResult = parseJsxSelection(selection.text);
    const conversion = convertJsxNodesToIr(parseResult.rootNodes, parseResult.sourceFile);
    const collieText = printCollieDocument(conversion.nodes);
    const warnings = conversion.diagnostics.warnings;
    logSelection(
      selection.text,
      parseResult.rootNodes,
      parseResult.sourceFile,
      conversion.nodes,
      collieText,
      warnings,
      channel
    );
    const created = await deliverCollieOutput(selection.document, collieText);
    if (created) {
      const applied = await applyTsxEdits(selection, created.componentName, created.uri);
      const filename = basename(created.uri.fsPath);
      if (applied) {
        if (warnings.length > 0) {
          window.showWarningMessage(
            `Created ${filename} and replaced selection. JSX parsed with warnings; see the Collie Conversion output.`
          );
        } else {
          window.showInformationMessage(`Created ${filename} and replaced selection.`);
        }
      } else {
        window.showWarningMessage(`Created ${filename} but could not update the TSX selection.`);
      }
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
}

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

interface CollieCreationResult {
  uri: Uri;
  componentName: string;
}

async function deliverCollieOutput(
  document: TextDocument,
  collieText: string
): Promise<CollieCreationResult | null> {
  if (!collieText.trim()) {
    window.showWarningMessage('Collie conversion produced empty output. Nothing to deliver.');
    return null;
  }

  const created = await createCollieFile(document, collieText);
  if (!created) {
    await copyCollieToClipboard(collieText);
    return null;
  }
  return created;
}

async function createCollieFile(
  document: TextDocument,
  collieText: string
): Promise<CollieCreationResult | null> {
  const suggested = suggestCollieFileUri(document);
  if (!suggested) {
    window.showWarningMessage('Unable to determine where to create the Collie file.');
    return null;
  }

  const baseName = deriveComponentName(document);
  const targetUri = await findAvailableCollieFileUri(suggested, baseName);
  const componentName = deriveComponentNameFromUri(targetUri);
  const finalContents = buildCollieFileContents(collieText, componentName);

  const encoder = new TextEncoder();
  await workspace.fs.writeFile(targetUri, encoder.encode(finalContents));
  const doc = await workspace.openTextDocument(targetUri);
  await window.showTextDocument(doc);
  return { uri: targetUri, componentName };
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

function suggestCollieFileUri(document: TextDocument): Uri | undefined {
  if (document.uri.scheme !== 'file') {
    return undefined;
  }

  const fsPath = document.uri.fsPath;
  const dir = dirname(fsPath);
  return Uri.file(join(dir, `${DEFAULT_COMPONENT_NAME}.collie`));
}

async function fileExists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function findAvailableCollieFileUri(baseUri: Uri, componentName: string): Promise<Uri> {
  const dir = dirname(baseUri.fsPath);
  let index = 0;
  while (true) {
    const suffix = index === 0 ? '' : `-${index}`;
    const candidate = Uri.file(join(dir, `${componentName}${suffix}.collie`));
    if (!(await fileExists(candidate))) {
      return candidate;
    }
    index += 1;
  }
}

function deriveComponentName(document: TextDocument): string {
  if (document.uri.scheme !== 'file') {
    return DEFAULT_COMPONENT_NAME;
  }

  const fsPath = document.uri.fsPath;
  const base = basename(fsPath, extname(fsPath));
  let raw = base;
  if (!raw || raw.toLowerCase() === 'index') {
    raw = basename(dirname(fsPath));
  }

  return toPascalCase(raw || DEFAULT_COMPONENT_NAME);
}

function deriveComponentNameFromUri(uri: Uri): string {
  if (uri.scheme !== 'file') {
    return DEFAULT_COMPONENT_NAME;
  }
  const base = basename(uri.fsPath, '.collie');
  return toPascalCase(base || DEFAULT_COMPONENT_NAME);
}

function toPascalCase(value: string): string {
  const tokens = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const combined =
    tokens.map(token => token[0].toUpperCase() + token.slice(1)).join('') || DEFAULT_COMPONENT_NAME;
  return /^[A-Za-z_]/.test(combined) ? combined : `Collie${combined}`;
}

function buildCollieFileContents(collieText: string, componentName: string): string {
  const trimmed = collieText.trimEnd();
  const hasIdDirective = /^\s*#id\b/im.test(trimmed);
  if (hasIdDirective) {
    return trimmed.length ? `${trimmed}\n` : trimmed;
  }
  const header = `#id ${componentName}\n\n`;
  if (!trimmed) {
    return header;
  }
  return `${header}${trimmed}\n`;
}

async function applyTsxEdits(
  selection: SelectionContext,
  componentName: string,
  collieUri: Uri
): Promise<boolean> {
  const document = selection.document;
  const importPath = buildRelativeImportPath(document, collieUri);
  const sourceText = document.getText();
  const sourceFile = ts.createSourceFile(
    document.uri.fsPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    document.languageId === 'javascriptreact' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  );

  const edit = new WorkspaceEdit();
  edit.replace(document.uri, selection.selection, `<${componentName} />`);

  if (!hasImportForModule(sourceFile, importPath)) {
    const insertion = findImportInsertion(sourceFile);
    const insertText = buildImportInsertionText(
      sourceText,
      insertion.offset,
      document.eol === EndOfLine.CRLF ? '\r\n' : '\n',
      `import ${componentName} from '${importPath}';`
    );
    edit.insert(document.uri, document.positionAt(insertion.offset), insertText);
  }

  return workspace.applyEdit(edit);
}

function buildRelativeImportPath(document: TextDocument, targetUri: Uri): string {
  const fromDir = dirname(document.uri.fsPath);
  let relativePath = relative(fromDir, targetUri.fsPath);
  relativePath = relativePath.replace(/\\/g, '/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

function isDirectiveStatement(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) {
    return false;
  }
  const expr = statement.expression;
  return ts.isStringLiteralLike(expr);
}

function findImportInsertion(sourceFile: ts.SourceFile): { offset: number } {
  const statements = sourceFile.statements;
  let index = 0;
  let directiveEnd = 0;

  while (index < statements.length && isDirectiveStatement(statements[index])) {
    directiveEnd = statements[index].end;
    index += 1;
  }

  let lastImportEnd = -1;
  for (; index < statements.length; index += 1) {
    const statement = statements[index];
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      lastImportEnd = statement.end;
      continue;
    }
    break;
  }

  if (lastImportEnd >= 0) {
    return { offset: lastImportEnd };
  }

  return { offset: directiveEnd };
}

function hasImportForModule(sourceFile: ts.SourceFile, modulePath: string): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text === modulePath) {
      return true;
    }
  }
  return false;
}

function buildImportInsertionText(
  sourceText: string,
  offset: number,
  eol: string,
  importStatement: string
): string {
  const prevChar = offset > 0 ? sourceText[offset - 1] : '';
  const nextChar = offset < sourceText.length ? sourceText[offset] : '';
  const needsPrefix = offset > 0 && !isLineBreakChar(prevChar);
  const needsSuffix = offset >= sourceText.length || !isLineBreakChar(nextChar);
  return `${needsPrefix ? eol : ''}${importStatement}${needsSuffix ? eol : ''}`;
}

function isLineBreakChar(char: string): boolean {
  return char === '\n' || char === '\r';
}
