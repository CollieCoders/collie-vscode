import {
  CodeAction,
  CodeActionKind,
  EndOfLine,
  languages,
  Range,
  Uri,
  WorkspaceEdit,
  commands,
  window,
  workspace
} from 'vscode';
import type { Diagnostic ,
  CodeActionProvider,
  Position,
  TextDocument} from 'vscode';
import type { FeatureContext } from '../types';
import { listByFile, onDidChangeTemplateIndex, type TemplateLocation } from '../../lang/templateIndex';

const ID_DIRECTIVE_PATTERN = /^(?:#|)id(?:\s+|:\s*|=\s*)(.+)$/i;
const ID_DIRECTIVE_WITH_VALUE_PATTERN = /^(\s*(?:#|)id(?:\s+|:\s*|=\s*))(.*)$/i;
const TEMPLATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const COLLIE_GLOB = '**/*.collie';
const COLLIE_EXCLUDE_GLOB = '**/node_modules/**';
const DEFAULT_PROP_TYPE = 'unknown';
const FILE_IGNORE_PATTERN = /^\s*#collie-ignore-file\s+(.+?)\s*$/;
const LINE_IGNORE_PATTERN = /^\s*#collie-ignore-next-line\s+(.+?)\s*$/;

let templateIndexVersion = 0;
let cachedTemplateEntriesVersion = -1;
let cachedTemplateEntries: Map<string, TemplateLocation[]> = new Map();
let cachedTemplateEntriesPromise: Promise<Map<string, TemplateLocation[]>> | null = null;

interface DiagnosticFix {
  range: Range;
  replacementText: string;
}

interface DiagnosticData {
  fix?: DiagnosticFix;
  kind?: string;
  propName?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getEol(document: TextDocument): string {
  return document.eol === EndOfLine.CRLF ? '\r\n' : '\n';
}

function getIndentSize(): number {
  const config = workspace.getConfiguration('collie');
  return Math.max(1, config.get<number>('format.indentSize', 2));
}

function invalidateTemplateEntryCache(): void {
  templateIndexVersion += 1;
  cachedTemplateEntriesVersion = -1;
  cachedTemplateEntries.clear();
  cachedTemplateEntriesPromise = null;
}

async function getTemplateEntriesById(): Promise<Map<string, TemplateLocation[]>> {
  if (cachedTemplateEntriesVersion === templateIndexVersion) {
    return cachedTemplateEntries;
  }

  if (cachedTemplateEntriesPromise) {
    return cachedTemplateEntriesPromise;
  }

  cachedTemplateEntriesPromise = (async () => {
    const entriesById = new Map<string, TemplateLocation[]>();
    const files = await workspace.findFiles(COLLIE_GLOB, COLLIE_EXCLUDE_GLOB);

    for (const uri of files) {
      const entries = listByFile(uri);
      for (const entry of entries) {
        const existing = entriesById.get(entry.id) ?? [];
        existing.push(entry);
        entriesById.set(entry.id, existing);
      }
    }

    cachedTemplateEntries = entriesById;
    cachedTemplateEntriesVersion = templateIndexVersion;
    cachedTemplateEntriesPromise = null;
    return entriesById;
  })();

  return cachedTemplateEntriesPromise;
}

function findPropsBlock(document: TextDocument): { line: number; indent: number; insertLine: number } | null {
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    if (line.text.trim() !== 'props') {
      continue;
    }

    const propsIndent = line.firstNonWhitespaceCharacterIndex;
    let insertLine = lineNumber + 1;

    for (let i = lineNumber + 1; i < document.lineCount; i++) {
      const nextLine = document.lineAt(i);
      const trimmed = nextLine.text.trim();

      if (trimmed.length === 0) {
        continue;
      }

      if (nextLine.firstNonWhitespaceCharacterIndex <= propsIndent) {
        insertLine = i;
        return { line: lineNumber, indent: propsIndent, insertLine };
      }

      insertLine = i + 1;
    }

    return { line: lineNumber, indent: propsIndent, insertLine };
  }

  return null;
}

function hasPropDeclarationInBlock(
  document: TextDocument,
  propsBlock: { line: number; indent: number; insertLine: number },
  propName: string
): boolean {
  const propPattern = new RegExp(`^${escapeRegExp(propName)}\\??\\s*:`);
  for (let i = propsBlock.line + 1; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const trimmed = line.text.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const indent = line.firstNonWhitespaceCharacterIndex;
    if (indent <= propsBlock.indent) {
      break;
    }

    if (propPattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

function findInsertLineForNewPropsBlock(document: TextDocument): number {
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    const trimmed = line.text.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (ID_DIRECTIVE_PATTERN.test(trimmed) && line.firstNonWhitespaceCharacterIndex === 0) {
      return lineNumber + 1;
    }

    return lineNumber;
  }

  return 0;
}

function getInsertPosition(
  document: TextDocument,
  lineNumber: number
): { position: Position; prefix: string } {
  const eol = getEol(document);
  if (lineNumber < document.lineCount) {
    return { position: document.lineAt(lineNumber).range.start, prefix: '' };
  }

  const lastLine = document.lineAt(document.lineCount - 1);
  const needsLeadingEol = lastLine.text.length > 0;
  return {
    position: lastLine.range.end,
    prefix: needsLeadingEol ? eol : ''
  };
}

function buildApplyFixAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  fix: DiagnosticFix
): CodeAction {
  const action = new CodeAction('Apply fix', CodeActionKind.QuickFix);
  const edit = new WorkspaceEdit();
  edit.replace(document.uri, fix.range, fix.replacementText);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function buildDialectFixAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  fix: DiagnosticFix
): CodeAction {
  const action = new CodeAction('Convert to preferred token spelling', CodeActionKind.QuickFix);
  const edit = new WorkspaceEdit();
  edit.replace(document.uri, fix.range, fix.replacementText);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function buildRemovePropAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  fix: DiagnosticFix
): CodeAction {
  const action = new CodeAction('Remove unused prop declaration', CodeActionKind.QuickFix);
  const edit = new WorkspaceEdit();
  edit.replace(document.uri, fix.range, fix.replacementText);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function buildPascalCaseIdAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  fix: DiagnosticFix
): CodeAction {
  const action = new CodeAction('Convert to PascalCase', CodeActionKind.QuickFix);
  const edit = new WorkspaceEdit();
  edit.replace(document.uri, fix.range, fix.replacementText);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function buildAddPropDeclarationAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  propName: string
): CodeAction | null {
  const propsBlock = findPropsBlock(document);
  if (propsBlock && hasPropDeclarationInBlock(document, propsBlock, propName)) {
    return null;
  }

  const indentSize = getIndentSize();
  const eol = getEol(document);
  const propLine = `${' '.repeat((propsBlock?.indent ?? 0) + indentSize)}${propName}: ${DEFAULT_PROP_TYPE}`;

  let insertLine = 0;
  let insertText = '';

  if (propsBlock) {
    insertLine = propsBlock.insertLine;
    insertText = `${propLine}${eol}`;
  } else {
    insertLine = findInsertLineForNewPropsBlock(document);
    insertText = `props${eol}${propLine}${eol}${eol}`;
  }

  const { position, prefix } = getInsertPosition(document, insertLine);
  const edit = new WorkspaceEdit();
  edit.insert(document.uri, position, `${prefix}${insertText}`);

  const action = new CodeAction(`Add "${propName}" to props block`, CodeActionKind.QuickFix);
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function hasFileIgnoreDirective(document: TextDocument, code: string): boolean {
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber).text;
    const match = FILE_IGNORE_PATTERN.exec(line);
    if (match) {
      const codes = match[1].trim().split(/\s+/);
      if (codes.includes(code)) {
        return true;
      }
    }
  }
  return false;
}

function hasLineIgnoreDirective(document: TextDocument, lineNumber: number, code: string): boolean {
  if (lineNumber === 0) {
    return false;
  }
  const previousLine = document.lineAt(lineNumber - 1).text;
  const match = LINE_IGNORE_PATTERN.exec(previousLine);
  if (match) {
    const codes = match[1].trim().split(/\s+/);
    return codes.includes(code);
  }
  return false;
}

function buildIgnoreOnLineAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  code: string
): CodeAction | null {
  const diagnosticLine = diagnostic.range.start.line;
  
  // Check if directive already exists
  if (hasLineIgnoreDirective(document, diagnosticLine, code)) {
    return null;
  }

  const targetLine = document.lineAt(diagnosticLine);
  const indent = ' '.repeat(targetLine.firstNonWhitespaceCharacterIndex);
  const eol = getEol(document);
  const directiveText = `${indent}#collie-ignore-next-line ${code}${eol}`;

  const edit = new WorkspaceEdit();
  edit.insert(document.uri, targetLine.range.start, directiveText);

  const action = new CodeAction(
    `Ignore this ${code} on this line`,
    CodeActionKind.QuickFix
  );
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function buildIgnoreInFileAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  code: string
): CodeAction | null {
  // Check if directive already exists
  if (hasFileIgnoreDirective(document, code)) {
    return null;
  }

  const eol = getEol(document);
  let insertLine = 0;
  
  // Find insertion point (after #id if present, otherwise at top)
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber).text;
    const trimmed = line.trim();
    
    if (trimmed.length === 0) {
      continue;
    }
    
    if (ID_DIRECTIVE_PATTERN.test(trimmed)) {
      insertLine = lineNumber + 1;
      break;
    }
    
    // If we hit a non-id directive, insert before it
    insertLine = lineNumber;
    break;
  }

  const directiveText = `#collie-ignore-file ${code}${eol}`;
  const { position, prefix } = getInsertPosition(document, insertLine);
  
  const edit = new WorkspaceEdit();
  edit.insert(document.uri, position, `${prefix}${directiveText}`);

  const action = new CodeAction(
    `Ignore this ${code} in this file`,
    CodeActionKind.QuickFix
  );
  action.edit = edit;
  action.diagnostics = [diagnostic];
  return action;
}

function buildFixAllAction(document: TextDocument, diagnostics: Diagnostic[]): CodeAction | null {
  const edits = collectFixEdits(document, diagnostics);
  if (edits.length === 0) {
    return null;
  }

  const edit = new WorkspaceEdit();
  for (const fix of edits) {
    edit.replace(document.uri, fix.range, fix.replacementText);
  }

  const action = new CodeAction('Fix all Collie issues', CodeActionKind.SourceFixAll);
  action.edit = edit;
  return action;
}

function collectFixEdits(document: TextDocument, diagnostics: Diagnostic[]): DiagnosticFix[] {
  const fixes: (DiagnosticFix & { startOffset: number; endOffset: number })[] = [];

  for (const diagnostic of diagnostics) {
    const data = diagnostic as DiagnosticData | undefined;
    if (!data?.fix) {
      continue;
    }
    const startOffset = document.offsetAt(data.fix.range.start);
    const endOffset = document.offsetAt(data.fix.range.end);
    fixes.push({ ...data.fix, startOffset, endOffset });
  }

  fixes.sort((a, b) => a.startOffset - b.startOffset);

  const filtered: DiagnosticFix[] = [];
  let lastEnd = -1;
  for (const fix of fixes) {
    if (fix.startOffset < lastEnd) {
      continue;
    }
    filtered.push({ range: fix.range, replacementText: fix.replacementText });
    lastEnd = fix.endOffset;
  }

  return filtered;
}

function findNearestIdDirective(
  document: TextDocument,
  startLine: number
): { line: number; range: Range; currentId: string } | null {
  for (let lineNumber = startLine; lineNumber >= 0; lineNumber -= 1) {
    const lineText = document.lineAt(lineNumber).text;
    const match = ID_DIRECTIVE_WITH_VALUE_PATTERN.exec(lineText);
    if (!match) {
      continue;
    }

    const prefix = match[1] ?? '';
    const value = match[2] ?? '';
    const trimmed = value.trim();
    const valueOffset = trimmed ? value.indexOf(trimmed) : 0;
    const startCharacter = prefix.length + Math.max(valueOffset, 0);
    const endCharacter = trimmed ? startCharacter + trimmed.length : startCharacter;

    return {
      line: lineNumber,
      range: new Range(lineNumber, startCharacter, lineNumber, endCharacter),
      currentId: trimmed
    };
  }

  return null;
}

class CollieIdCodeActionProvider implements CodeActionProvider {
  async provideCodeActions(document: TextDocument, range: Range): Promise<CodeAction[]> {
    const actions: CodeAction[] = [];
    const diagnostics = languages.getDiagnostics(document.uri);
    let entriesById: Map<string, TemplateLocation[]> | null = null;

    // Find ID collision diagnostics
    const collisionDiagnostics = diagnostics.filter(diag =>
      diag.code === 'COLLIE403' && diag.range.intersection(range)
    );

    if (collisionDiagnostics.length > 0) {
      entriesById = await getTemplateEntriesById();
    }

    for (const diagnostic of collisionDiagnostics) {
      // Extract the template ID from the diagnostic message
      const match =
        diagnostic.message.match(/Duplicate Collie template id "([^"]+)"/) ??
        diagnostic.message.match(/Duplicate #id "([^"]+)"/);
      if (!match) {
        continue;
      }

      const templateId = match[1];
      const entries = entriesById?.get(templateId) ?? [];
      const currentUri = document.uri.toString();
      const others = entries.filter(entry => entry.uri.toString() !== currentUri);

      // Action 1: Rename ID in this file
      const renameAction = new CodeAction(
        'Rename ID in this file...',
        CodeActionKind.QuickFix
      );
      renameAction.command = {
        title: 'Rename ID',
        command: 'collie.renameTemplateId',
        arguments: [document, diagnostic.range, templateId]
      };
      renameAction.diagnostics = [diagnostic];
      actions.push(renameAction);

      // Action 2: Open conflicting templates
      if (others.length > 0) {
        const otherUris = Array.from(new Set(others.map(entry => entry.uri.toString())))
          .map(uri => Uri.parse(uri));
        const openAction = new CodeAction(
          `Open conflicting template${others.length > 1 ? 's' : ''}`,
          CodeActionKind.QuickFix
        );
        openAction.command = {
          title: 'Open conflicting templates',
          command: 'collie.openConflictingTemplates',
          arguments: [otherUris]
        };
        openAction.diagnostics = [diagnostic];
        actions.push(openAction);
      }
    }

    // Compiler-provided fixes and props actions
    const actionableDiagnostics = diagnostics.filter(diag => diag.range.intersection(range));
    for (const diagnostic of actionableDiagnostics) {
      // Add ignore quick fixes for diagnostics with string codes
      if (typeof diagnostic.code === 'string') {
        const ignoreLineAction = buildIgnoreOnLineAction(document, diagnostic, diagnostic.code);
        if (ignoreLineAction) {
          actions.push(ignoreLineAction);
        }
        
        const ignoreFileAction = buildIgnoreInFileAction(document, diagnostic, diagnostic.code);
        if (ignoreFileAction) {
          actions.push(ignoreFileAction);
        }
      }

      const data = diagnostic as DiagnosticData | undefined;
      if (!data) {
        continue;
    }

    if (data.fix) {
      if (data.kind === 'pascalCaseId') {
        actions.push(buildPascalCaseIdAction(document, diagnostic, data.fix));
      } else {
        actions.push(buildApplyFixAction(document, diagnostic, data.fix));
      }

      if (data.kind === 'dialectToken') {
        actions.push(buildDialectFixAction(document, diagnostic, data.fix));
      }

        if (data.kind === 'removePropDeclaration') {
          actions.push(buildRemovePropDeclaration(document, diagnostic, data.fix));
        }
      }

      if (data.kind === 'addPropDeclaration' && data.propName) {
        const action = buildAddPropDeclarationAction(document, diagnostic, data.propName);
        if (action) {
          actions.push(action);
        }
      }
    }

    const fixAll = buildFixAllAction(document, diagnostics);
    if (fixAll) {
      actions.push(fixAll);
    }

    return actions;
  }
}

export function registerDiagnosticsCodeActions(context: FeatureContext) {
  const provider = new CollieIdCodeActionProvider();

  context.register(
    languages.registerCodeActionsProvider(
      { language: 'collie' },
      provider,
      { providedCodeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceFixAll] }
    )
  );

  context.register(
    onDidChangeTemplateIndex(() => {
      invalidateTemplateEntryCache();
    })
  );

    // Register the rename command
  context.register(
    commands.registerCommand(
      'collie.renameTemplateId',
      async (document: TextDocument, range: Range, currentId: string) => {
        const activeLine = range?.start.line ?? window.activeTextEditor?.selection.active.line ?? 0;
        const target = findNearestIdDirective(document, activeLine);
        if (!target) {
          window.showWarningMessage('No #id directive found above the cursor.');
          return;
        }

        const initialValue = currentId || target.currentId;
        const newId = await window.showInputBox({
          prompt: 'Enter new template ID',
          value: initialValue ? `${initialValue}2` : '',
          validateInput: (value) => {
            if (!value?.trim()) {
              return 'ID cannot be empty';
            }
            if (!TEMPLATE_ID_PATTERN.test(value)) {
              return 'ID must start with a letter and contain only letters, numbers, ".", "_", or "-".';
            }
            return null;
          }
        });

        if (!newId) {
          return;
        }

        const edit = new WorkspaceEdit();
        edit.replace(document.uri, target.range, newId);

        await workspace.applyEdit(edit);
      }
    )
  );

  // Register the open conflicting templates command
  context.register(
    commands.registerCommand(
      'collie.openConflictingTemplates',
      async (uris: { toString(): string }[]) => {
        for (const uri of uris) {
          await window.showTextDocument(uri as any, { preview: false });
        }
      }
    )
  );

  context.logger.info('Collie ID code actions registered.');
}
