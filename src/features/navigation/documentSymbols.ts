import { basename } from 'path';
import { DocumentSymbol, languages, Range, SymbolKind, TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { ElementNode, Node, ConditionalNode, ConditionalBranch, PropsDecl } from '../../format/parser/ast';
import type { SourceSpan } from '../../format/parser/diagnostics';
import { getParsedDocument } from '../../lang/cache';
import { isFeatureFlagEnabled } from '../featureFlags';

function spanToRange(document: TextDocument, span?: SourceSpan): Range {
  if (span) {
    return new Range(document.positionAt(span.start.offset), document.positionAt(span.end.offset));
  }
  const start = document.positionAt(0);
  return new Range(start, start);
}

function createDocumentRootSymbol(document: TextDocument, children: DocumentSymbol[]): DocumentSymbol[] {
  const start = document.positionAt(0);
  const end = document.lineCount === 0 ? start : document.lineAt(document.lineCount - 1).range.end;
  const range = new Range(start, end);
  const name = basename(document.fileName) || document.uri.toString();
  const root = new DocumentSymbol(name, 'Collie template', SymbolKind.Module, range, range);
  root.children = children;
  return [root];
}

function buildPropsSymbol(document: TextDocument, props: PropsDecl): DocumentSymbol | null {
  const range = spanToRange(document, props.span);
  const symbol = new DocumentSymbol('props', 'Props block', SymbolKind.Field, range, range);
  return symbol;
}

function buildElementSymbol(document: TextDocument, node: ElementNode): DocumentSymbol {
  const detail = node.classes.length ? node.classes.map(cls => `.${cls}`).join('') : '';
  const range = spanToRange(document, node.span);
  const symbol = new DocumentSymbol(node.name, detail, SymbolKind.Class, range, range);
  const children: DocumentSymbol[] = [];

  for (const child of node.children) {
    const childSymbol = buildNodeSymbol(document, child);
    if (childSymbol) {
      children.push(childSymbol);
    }
  }

  symbol.children = children;
  return symbol;
}

function buildConditionalSymbol(document: TextDocument, node: ConditionalNode): DocumentSymbol {
  const firstBranch = node.branches[0];
  const label = firstBranch?.test ? `@if (${firstBranch.test})` : '@if';
  const range = spanToRange(document, node.span ?? firstBranch?.span);
  const symbol = new DocumentSymbol(label, 'Conditional block', SymbolKind.Namespace, range, range);
  const branchSymbols: DocumentSymbol[] = [];

  node.branches.forEach((branch, index) => {
    const branchSymbol = buildConditionalBranchSymbol(document, branch, index);
    if (branchSymbol) {
      branchSymbols.push(branchSymbol);
    }
  });

  symbol.children = branchSymbols;
  return symbol;
}

function buildConditionalBranchSymbol(
  document: TextDocument,
  branch: ConditionalBranch,
  index: number
): DocumentSymbol | null {
  const directive = branch.test ? (index === 0 ? '@if' : '@elseIf') : '@else';
  const detail = branch.test ?? '';
  const range = spanToRange(document, branch.span);
  const symbol = new DocumentSymbol(directive, detail, SymbolKind.Method, range, range);
  const children: DocumentSymbol[] = [];

  for (const child of branch.body) {
    const childSymbol = buildNodeSymbol(document, child);
    if (childSymbol) {
      children.push(childSymbol);
    }
  }

  symbol.children = children;
  return symbol;
}

function buildNodeSymbol(document: TextDocument, node: Node): DocumentSymbol | null {
  switch (node.type) {
    case 'Element':
      return buildElementSymbol(document, node);
    case 'Conditional':
      return buildConditionalSymbol(document, node);
    default:
      return null;
  }
}

function buildDocumentSymbols(document: TextDocument): DocumentSymbol[] {
  const parsed = getParsedDocument(document);
  const children: DocumentSymbol[] = [];

  if (parsed.ast.props) {
    const propsSymbol = buildPropsSymbol(document, parsed.ast.props);
    if (propsSymbol) {
      children.push(propsSymbol);
    }
  }

  for (const child of parsed.ast.children) {
    const symbol = buildNodeSymbol(document, child);
    if (symbol) {
      children.push(symbol);
    }
  }

  return createDocumentRootSymbol(document, children);
}

function activateDocumentSymbolsFeature(context: FeatureContext) {
  const provider = languages.registerDocumentSymbolProvider({ language: 'collie' }, {
    provideDocumentSymbols(document) {
      if (!isFeatureFlagEnabled('navigation')) {
        return [];
      }

      try {
        return buildDocumentSymbols(document);
      } catch (error) {
        context.logger.error('Failed to build Collie document symbols.', error);
        return [];
      }
    }
  });

  context.register(provider);
  context.logger.info('Collie document symbols provider registered.');
}

registerFeature(activateDocumentSymbolsFeature);
