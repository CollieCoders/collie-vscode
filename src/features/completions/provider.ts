import {
  CompletionItem,
  CompletionItemKind,
  FileType,
  Position,
  languages,
  Range,
  TextDocument,
  Uri,
  workspace
} from 'vscode';
import { dirname, extname, basename } from 'path';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { Node } from '../../format/parser/ast';
import { getParsedDocument } from '../../lang/cache';
import { isFeatureFlagEnabled } from '../featureFlags';

const DIRECTIVE_LABELS = ['@if', '@elseIf', '@else'] as const;
const COMMON_TAGS = ['div', 'span', 'section', 'header', 'footer', 'main', 'nav', 'button', 'input', 'label', 'article'];
const HTML_TAG_SET = new Set(COMMON_TAGS);
const COMPONENT_EXTENSIONS = new Set(['.collie', '.tsx']);
const SIBLING_CACHE_TTL_MS = 5000;

interface WordContext {
  word: string;
  range: Range;
}

interface SiblingComponentCacheEntry {
  names: string[];
  expires: number;
}

const siblingComponentCache = new Map<string, SiblingComponentCacheEntry>();

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function extractWordContext(document: TextDocument, position: Position): WordContext {
  const line = document.lineAt(position.line).text;
  let start = position.character;
  while (start > 0) {
    const ch = line.charAt(start - 1);
    if (!/[@A-Za-z0-9_-]/.test(ch)) {
      break;
    }
    start--;
  }
  const word = line.slice(start, position.character);
  const range = new Range(position.line, start, position.line, position.character);
  return { word, range };
}

function createDirectiveItems(range: Range): CompletionItem[] {
  return DIRECTIVE_LABELS.map(label => {
    const item = new CompletionItem(label, CompletionItemKind.Keyword);
    item.range = range;
    item.insertText = label;
    item.detail = 'Collie directive';
    item.sortText = `1_${label}`;
    return item;
  });
}

function createTagItems(range: Range): CompletionItem[] {
  return COMMON_TAGS.map(tag => {
    const item = new CompletionItem(tag, CompletionItemKind.Struct);
    item.range = range;
    item.detail = 'HTML tag';
    item.sortText = `2_${tag}`;
    return item;
  });
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function collectComponentNamesFromAst(nodes: Node[], set: Set<string>) {
  for (const node of nodes) {
    if (node.type === 'Element') {
      if (isComponentName(node.name)) {
        set.add(node.name);
      }
      collectComponentNamesFromAst(node.children, set);
    } else if (node.type === 'Conditional') {
      for (const branch of node.branches) {
        collectComponentNamesFromAst(branch.body, set);
      }
    }
  }
}

async function readSiblingComponents(document: TextDocument): Promise<string[]> {
  const dir = dirname(document.uri.fsPath);
  const cached = siblingComponentCache.get(dir);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.names;
  }

  const dirUri = Uri.file(dir);
  let entries: [string, FileType][];
  try {
    entries = await workspace.fs.readDirectory(dirUri);
  } catch {
    entries = [];
  }

  const names = new Set<string>();
  for (const [entryName, type] of entries) {
    if (type !== FileType.File) {
      continue;
    }
    const ext = extname(entryName);
    if (!COMPONENT_EXTENSIONS.has(ext)) {
      continue;
    }
    const base = basename(entryName, ext);
    if (isComponentName(base)) {
      names.add(base);
    }
  }

  const result = Array.from(names).sort();
  siblingComponentCache.set(dir, { names: result, expires: now + SIBLING_CACHE_TTL_MS });
  return result;
}

async function buildComponentItems(
  document: TextDocument,
  range: Range,
  context: FeatureContext
): Promise<CompletionItem[]> {
  try {
    const parsed = getParsedDocument(document);
    const names = new Set<string>();
    collectComponentNamesFromAst(parsed.ast.children, names);
    const siblingNames = await readSiblingComponents(document);
    for (const name of siblingNames) {
      names.add(name);
    }

    return Array.from(names)
      .filter(name => !HTML_TAG_SET.has(name.toLowerCase()))
      .sort()
      .map(name => {
        const item = new CompletionItem(name, CompletionItemKind.Class);
        item.range = range;
        item.detail = 'Local component';
        item.sortText = `3_${name}`;
        return item;
      });
  } catch (error) {
    context.logger.error('Collie completion provider failed to load components.', error);
    return [];
  }
}

async function provideCompletionItems(document: TextDocument, position: Position, _token: unknown, context: FeatureContext) {
  if (!shouldHandleDocument(document) || !isFeatureFlagEnabled('completions')) {
    return undefined;
  }

  const lineText = document.lineAt(position.line).text;
  const previousChar = position.character > 0 ? lineText.charAt(position.character - 1) : '';
  const { word, range } = extractWordContext(document, position);

  if (previousChar === '.' && word.length === 0) {
    return undefined;
  }
  if (word.startsWith('@')) {
    return createDirectiveItems(range);
  }

  const items: CompletionItem[] = [...createTagItems(range)];
  items.push(...(await buildComponentItems(document, range, context)));
  return items;
}

function activateCompletionFeature(context: FeatureContext) {
  const provider = languages.registerCompletionItemProvider(
    { language: 'collie' },
    {
      provideCompletionItems(document, position, token) {
        return provideCompletionItems(document, position, token, context);
      }
    },
    '@',
    '.'
  );

  context.register(provider);
  context.register(
    workspace.onDidChangeWorkspaceFolders(() => {
      siblingComponentCache.clear();
    })
  );
  context.register(
    workspace.onDidCreateFiles(() => {
      siblingComponentCache.clear();
    })
  );
  context.register(
    workspace.onDidDeleteFiles(() => {
      siblingComponentCache.clear();
    })
  );
  context.register(
    workspace.onDidRenameFiles(() => {
      siblingComponentCache.clear();
    })
  );
  context.logger.info('Collie completion provider registered.');
}

registerFeature(activateCompletionFeature);
