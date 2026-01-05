import {
  CompletionItem,
  CompletionItemKind,
  Position,
  Range,
  TextDocument,
  languages,
  workspace
} from 'vscode';
import type { FeatureContext } from '../types';
import { getById, listIds } from '../../lang/templateIndex';
import { isFeatureFlagEnabled } from '../featureFlags';
import * as ts from 'typescript';

const COLLIE_COMPONENT_NAMES = new Set(['Collie']);

function isTsxDocument(document: TextDocument): boolean {
  return document.languageId === 'typescriptreact' || document.languageId === 'javascriptreact';
}

type CollieIdCompletionContext = {
  range: Range;
  prefix: string;
};

function findCollieIdCompletionContext(
  document: TextDocument,
  position: Position
): CollieIdCompletionContext | null {
  const sourceFile = ts.createSourceFile(
    document.uri.fsPath,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const offset = document.offsetAt(position);
  let result: CollieIdCompletionContext | null = null;

  const visit = (node: ts.Node): void => {
    if (result) {
      return;
    }

    if (ts.isJsxAttribute(node)) {
      if (!ts.isIdentifier(node.name) || node.name.text !== 'id') {
        return;
      }

      const initializer = node.initializer;
      if (!initializer || !ts.isStringLiteralLike(initializer)) {
        return;
      }

      const attributes = node.parent;
      const opening = attributes?.parent;
      if (!opening || (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening))) {
        return;
      }

      const tagName = opening.tagName;
      if (!ts.isIdentifier(tagName) || !COLLIE_COMPONENT_NAMES.has(tagName.text)) {
        return;
      }

      const valueStart = initializer.getStart(sourceFile) + 1;
      const valueEnd = Math.max(initializer.getEnd() - 1, valueStart);
      if (offset < valueStart || offset > valueEnd) {
        return;
      }

      const value = initializer.text ?? '';
      const prefixLength = Math.max(0, Math.min(value.length, offset - valueStart));
      const prefix = value.slice(0, prefixLength);
      result = {
        range: new Range(document.positionAt(valueStart), document.positionAt(valueEnd)),
        prefix
      };
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

function buildCompletionItems(context: CollieIdCompletionContext): CompletionItem[] {
  const ids = listIds();
  const normalizedPrefix = context.prefix.toLowerCase();

  return ids
    .map(id => {
      const lower = id.toLowerCase();
      if (normalizedPrefix && !lower.includes(normalizedPrefix)) {
        return null;
      }
      const startsWith = normalizedPrefix ? lower.startsWith(normalizedPrefix) : true;
      const item = new CompletionItem(id, CompletionItemKind.Value);
      item.range = context.range;
      item.insertText = id;
      const entry = getById(id);
      if (entry) {
        item.detail = workspace.asRelativePath(entry.uri);
      } else {
        item.detail = 'Collie template';
      }
      item.sortText = `${startsWith ? '0' : '1'}_${id}`;
      return item;
    })
    .filter((item): item is CompletionItem => item !== null);
}

function provideCollieIdCompletions(
  document: TextDocument,
  position: Position
): CompletionItem[] | undefined {
  if (!isTsxDocument(document) || !isFeatureFlagEnabled('completions')) {
    return undefined;
  }

  const context = findCollieIdCompletionContext(document, position);
  if (!context) {
    return undefined;
  }

  const items = buildCompletionItems(context);
  return items.length > 0 ? items : undefined;
}

export function registerCollieIdCompletionProvider(context: FeatureContext) {
  const provider = languages.registerCompletionItemProvider(
    [{ language: 'typescriptreact', scheme: 'file' }, { language: 'javascriptreact', scheme: 'file' }],
    {
      provideCompletionItems(document, position) {
        return provideCollieIdCompletions(document, position);
      }
    },
    '"',
    "'"
  );

  context.register(provider);
  context.logger.info('Collie TSX ID completion provider registered.');
}
