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
import { TextDecoder } from 'util';
import type { FeatureContext } from '../types';
import type { IrNode } from '../../convert/ir/nodes';
import { printCollieDocument } from '../../convert/collie/print';
import { convertJsxNodesToIr } from '../../convert/tsx/jsxToIr';
import { JsxParseError, parseJsxSelection } from '../../convert/tsx/parseSelection';
import { warnIfMissingConfig, warnIfMissingTooling } from '../config/warnings';
import { writeTemplateBlock } from './collieFileWriter';
import { ensureCollieImport } from './imports';
import { deriveTargetFileBase, deriveTemplateId } from './templateId';

const SUPPORTED_LANGUAGE_IDS = new Set(['typescriptreact', 'javascriptreact']);
const OUTPUT_CHANNEL_NAME = 'Collie Conversion';
const textDecoder = new TextDecoder('utf-8');

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
    const propKinds = collectIdentifiersFromIrNodes(conversion.nodes);
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

    const existingIds = await collectExistingTemplateIds(targetUri);
    const templateId = deriveTemplateId(selection.document, selection.selection, existingIds);
    const created = await deliverCollieOutput(
      selection.document,
      collieText,
      templateId,
      targetUri,
      propKinds
    );
    if (created) {
      const propNames = Array.from(propKinds.keys());
      const applied = await applyTsxEdits(selection, created.templateId, propNames);
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
  targetUri: Uri | undefined,
  propKinds: Map<string, PropKindInfo>
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
    document.eol === EndOfLine.CRLF ? '\r\n' : '\n',
    propKinds
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

async function collectExistingTemplateIds(targetUri: Uri | undefined): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!targetUri) {
    return ids;
  }

  try {
    const bytes = await workspace.fs.readFile(targetUri);
    const contents = textDecoder.decode(bytes);
    const lines = contents.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*#id\s+([^\s]+)/);
      if (!match) {
        continue;
      }
      const id = match[1].trim();
      if (id) {
        ids.add(id);
      }
    }
  } catch {
    return ids;
  }

  return ids;
}

async function applyTsxEdits(
  selection: SelectionContext,
  templateId: string,
  propNames: string[]
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
  const replaceRange = getReplacementRange(selection);
  const replacement = buildCollieComponentReplacement(templateId, propNames);
  edit.replace(document.uri, replaceRange, replacement);
  ensureCollieImport(document, sourceFile, edit);

  return workspace.applyEdit(edit);
}

function getReplacementRange(selection: SelectionContext): Range {
  const text = selection.text;
  const fragment = findFragmentBounds(text);
  if (!fragment) {
    return selection.selection;
  }

  const selectionStartOffset = selection.document.offsetAt(selection.selection.start);
  const startOffset = selectionStartOffset + fragment.innerStart;
  const endOffset = selectionStartOffset + fragment.innerEnd;

  if (startOffset > endOffset) {
    return selection.selection;
  }

  return new Range(
    selection.document.positionAt(startOffset),
    selection.document.positionAt(endOffset)
  );
}

interface FragmentBounds {
  innerStart: number;
  innerEnd: number;
}

function findFragmentBounds(text: string): FragmentBounds | null {
  const lead = skipLeadingTrivia(text, 0);
  const hasOpen = text.startsWith('<>', lead);
  const openEnd = hasOpen ? lead + 2 : 0;
  const innerStart = hasOpen ? skipLeadingTrivia(text, openEnd) : 0;

  const trail = skipTrailingTrivia(text, text.length);
  const hasClose = trail >= 3 && text.slice(trail - 3, trail) === '</>';
  const closeStart = hasClose ? trail - 3 : text.length;
  const innerEnd = hasClose ? skipTrailingTrivia(text, closeStart) : text.length;

  if (!hasOpen && !hasClose) {
    return null;
  }

  return { innerStart, innerEnd };
}

function skipLeadingTrivia(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (text.startsWith('//', index)) {
      const newline = text.indexOf('\n', index + 2);
      if (newline === -1) {
        return text.length;
      }
      index = newline + 1;
      continue;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      if (end === -1) {
        return text.length;
      }
      index = end + 2;
      continue;
    }
    if (text.startsWith('{/*', index)) {
      const end = text.indexOf('*/}', index + 3);
      if (end === -1) {
        return text.length;
      }
      index = end + 3;
      continue;
    }
    break;
  }
  return index;
}

function skipTrailingTrivia(text: string, end: number): number {
  let index = end;
  while (index > 0) {
    const char = text[index - 1];
    if (isWhitespace(char)) {
      index -= 1;
      continue;
    }
    if (index >= 3 && text.slice(index - 3, index) === '*/}') {
      const start = text.lastIndexOf('{/*', index - 3);
      if (start === -1) {
        break;
      }
      index = start;
      continue;
    }
    if (index >= 2 && text.slice(index - 2, index) === '*/') {
      const start = text.lastIndexOf('/*', index - 2);
      if (start === -1) {
        break;
      }
      index = start;
      continue;
    }
    if (index >= 2 && text.slice(index - 2, index) === '//') {
      const lineStart = text.lastIndexOf('\n', index - 3);
      index = lineStart === -1 ? 0 : lineStart + 1;
      continue;
    }
    break;
  }
  return index;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function buildCollieComponentReplacement(templateId: string, propNames: string[]): string {
  const normalized = Array.from(new Set(propNames.filter(Boolean)));
  if (normalized.length === 0) {
    return `<Collie id="${templateId}" />`;
  }
  const props = normalized.map(name => `${name}={${name}}`).join(' ');
  return `<Collie id="${templateId}" ${props} />`;
}

interface PropKindInfo {
  kind: 'fn' | 'value';
}

function collectIdentifiersFromIrNodes(nodes: readonly IrNode[]): Map<string, PropKindInfo> {
  const names = new Map<string, Set<'call' | 'event' | 'arrow' | 'ref'>>();

  const visit = (node: IrNode): void => {
    switch (node.kind) {
      case 'element':
        for (const prop of node.props) {
          if (prop.kind === 'prop') {
            if (prop.value) {
              const isEventHandler = /^on[A-Z]/.test(prop.name);
              collectIdentifiersFromExpressionText(prop.value, names, isEventHandler);
            }
          } else {
            collectIdentifiersFromExpressionText(prop.expressionText, names, false);
          }
        }
        for (const child of node.children) {
          visit(child);
        }
        break;
      case 'text':
        break;
      case 'expression':
        collectIdentifiersFromExpressionText(node.expressionText, names, false);
        break;
      case 'fragment':
        for (const child of node.children) {
          visit(child);
        }
        break;
      case 'conditional':
        for (const branch of node.branches) {
          if (branch.test) {
            collectIdentifiersFromExpressionText(branch.test, names, false);
          }
          for (const child of branch.children) {
            visit(child);
          }
        }
        break;
      default: {
        const exhaustive: never = node;
        throw new Error(`Unsupported IR node: ${(exhaustive as IrNode).kind}`);
      }
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  const result = new Map<string, PropKindInfo>();
  for (const [name, usages] of names.entries()) {
    if (usages.has('call') || usages.has('event') || usages.has('arrow')) {
      result.set(name, { kind: 'fn' });
    } else {
      result.set(name, { kind: 'value' });
    }
  }

  return result;
}

function collectIdentifiersFromExpressionText(
  expressionText: string,
  names: Map<string, Set<'call' | 'event' | 'arrow' | 'ref'>>,
  isEventHandler: boolean
): void {
  const normalized = normalizeExpressionText(expressionText);
  if (!normalized) {
    return;
  }

  const sourceFile = ts.createSourceFile(
    '__collie_expr__.ts',
    `const __collie_expr__ = (${normalized});`,
    ts.ScriptTarget.Latest,
    true
  );

  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) {
    return;
  }
  const declaration = statement.declarationList.declarations[0];
  if (!declaration?.initializer) {
    return;
  }

  collectIdentifiersFromExpression(declaration.initializer, names, isEventHandler);
}

function normalizeExpressionText(expressionText: string): string | null {
  let trimmed = expressionText.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  if (trimmed.startsWith('...')) {
    trimmed = trimmed.slice(3).trim();
  }

  return trimmed || null;
}

function collectIdentifiersFromExpression(
  expression: ts.Expression,
  names: Map<string, Set<'call' | 'event' | 'arrow' | 'ref'>>,
  isEventHandler: boolean
): void {
  // Scope stack to track locally-bound identifiers
  const scopeStack: Set<string>[] = [];

  const pushScope = () => {
    scopeStack.push(new Set<string>());
  };

  const popScope = () => {
    scopeStack.pop();
  };

  const addBinding = (name: string) => {
    if (scopeStack.length > 0) {
      scopeStack[scopeStack.length - 1].add(name);
    }
  };

  const isBound = (name: string): boolean => {
    for (const scope of scopeStack) {
      if (scope.has(name)) {
        return true;
      }
    }
    return false;
  };

  // Extract bound names from binding patterns
  const extractBindingNames = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      addBinding(name.text);
      return;
    }

    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        extractBindingNames(element.name);
      }
      return;
    }

    if (ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          extractBindingNames(element.name);
        }
      }
    }
  };

  const visit = (node: ts.Node, isCalleeContext: boolean = false, isArrowBody: boolean = false): void => {
    if (ts.isIdentifier(node)) {
      if (isIdentifierReference(node)) {
        // Only treat as prop if not bound locally and not 'props'
        if (node.text !== 'props' && !isBound(node.text)) {
          const usages = names.get(node.text) ?? new Set();
          if (isCalleeContext) {
            usages.add('call');
          } else if (isEventHandler) {
            usages.add('event');
          } else if (isArrowBody) {
            usages.add('arrow');
          } else {
            usages.add('ref');
          }
          names.set(node.text, usages);
        }
      }
      return;
    }

    if (ts.isCallExpression(node)) {
      visit(node.expression, true, isArrowBody);
      for (const arg of node.arguments) {
        visit(arg, false, isArrowBody);
      }
      return;
    }

    if (ts.isArrowFunction(node)) {
      pushScope();
      // Bind arrow function parameters
      for (const param of node.parameters) {
        extractBindingNames(param.name);
      }
      const body = node.body;
      if (ts.isCallExpression(body)) {
        visit(body, false, true);
      } else {
        visit(body, false, false);
      }
      popScope();
      return;
    }

    if (ts.isFunctionExpression(node)) {
      pushScope();
      // Bind function parameters
      for (const param of node.parameters) {
        extractBindingNames(param.name);
      }
      if (node.body) {
        visit(node.body, false, false);
      }
      popScope();
      return;
    }

    if (ts.isCatchClause(node)) {
      pushScope();
      // Bind catch parameter
      if (node.variableDeclaration) {
        extractBindingNames(node.variableDeclaration.name);
      }
      visit(node.block, false, false);
      popScope();
      return;
    }

    if (ts.isVariableDeclaration(node)) {
      // Bind variable name
      extractBindingNames(node.name);
      if (node.initializer) {
        visit(node.initializer, false, isArrowBody);
      }
      return;
    }

    if (ts.isVariableDeclarationList(node)) {
      for (const decl of node.declarations) {
        visit(decl, false, isArrowBody);
      }
      return;
    }

    if (ts.isBlock(node)) {
      pushScope();
      ts.forEachChild(node, (child) => visit(child, false, isArrowBody));
      popScope();
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression, false, isArrowBody);
      return;
    }

    if (ts.isElementAccessExpression(node)) {
      visit(node.expression, false, isArrowBody);
      if (node.argumentExpression) {
        visit(node.argumentExpression, false, isArrowBody);
      }
      return;
    }

    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      visit(node.expression, false, isArrowBody);
      return;
    }

    ts.forEachChild(node, (child) => visit(child, false, isArrowBody));
  };

  visit(expression);
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) {
    return true;
  }

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return false;
  }

  if (ts.isQualifiedName(parent) && parent.right === node) {
    return false;
  }

  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return false;
  }

  if (ts.isVariableDeclaration(parent) && parent.name === node) {
    return false;
  }

  if (ts.isParameter(parent) && parent.name === node) {
    return false;
  }

  if (ts.isBindingElement(parent) && parent.name === node) {
    return false;
  }

  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) {
    return false;
  }

  if (ts.isShorthandPropertyAssignment(parent)) {
    return true;
  }

  return true;
}
