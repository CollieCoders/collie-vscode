import {
  CodeAction,
  CodeActionKind,
  CodeActionProvider,
  EndOfLine,
  languages,
  Position,
  Range,
  TextDocument,
  WorkspaceEdit,
  commands,
  window,
  workspace,
  Uri
} from 'vscode';
import type { Diagnostic } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { getTemplateIdEntries } from '../../lang/cache';
// import * as path from 'path';

const ID_DIRECTIVE_PATTERN = /^(?:#|)id(?:\s+|:\s*|=\s*)(.+)$/i;
const DEFAULT_PROP_TYPE = 'unknown';

type DiagnosticFix = {
  range: Range;
  replacementText: string;
};

type DiagnosticData = {
  fix?: DiagnosticFix;
  kind?: string;
  propName?: string;
};

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
  const fixes: Array<DiagnosticFix & { startOffset: number; endOffset: number }> = [];

  for (const diagnostic of diagnostics) {
    const data = diagnostic.data as DiagnosticData | undefined;
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

class CollieIdCodeActionProvider implements CodeActionProvider {
  provideCodeActions(document: TextDocument, range: Range): CodeAction[] {
    const actions: CodeAction[] = [];
    const diagnostics = languages.getDiagnostics(document.uri);
    
    // Find ID collision diagnostics
    const collisionDiagnostics = diagnostics.filter(diag => 
      diag.code === 'COLLIE403' && diag.range.intersection(range)
    );
    
    for (const diagnostic of collisionDiagnostics) {
      // Extract the template ID from the diagnostic message
      const match = diagnostic.message.match(/Duplicate Collie template id "([^"]+)"/);
      if (!match) {
        continue;
      }
      
      const templateId = match[1];
      const entries = getTemplateIdEntries(templateId);
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
        const openAction = new CodeAction(
          `Open conflicting template${others.length > 1 ? 's' : ''}`,
          CodeActionKind.QuickFix
        );
        openAction.command = {
          title: 'Open conflicting templates',
          command: 'collie.openConflictingTemplates',
          arguments: [others.map(e => e.uri)]
        };
        openAction.diagnostics = [diagnostic];
        actions.push(openAction);
      }
    }
    
    // Find missing HTML placeholder diagnostics
    const placeholderDiagnostics = diagnostics.filter(diag => 
      diag.code === 'COLLIE404' && diag.range.intersection(range)
    );
    
    for (const diagnostic of placeholderDiagnostics) {
      // Extract the template ID from the diagnostic message
      const match = diagnostic.message.match(/Template id "([^"]+)" has no matching HTML placeholder/);
      if (!match) {
        continue;
      }
      
      const templateId = match[1];
      const placeholderId = `${templateId}-collie`;
      
      // Action 1: Search workspace for the placeholder ID
      const searchAction = new CodeAction(
        `Search workspace for "${placeholderId}"`,
        CodeActionKind.QuickFix
      );
      searchAction.command = {
        title: 'Search workspace',
        command: 'workbench.action.findInFiles',
        arguments: [{ query: placeholderId, isRegex: false }]
      };
      searchAction.diagnostics = [diagnostic];
      actions.push(searchAction);
      
      // Action 2: Open HTML files in workspace
      const openHtmlAction = new CodeAction(
        'Open HTML files in workspace',
        CodeActionKind.QuickFix
      );
      openHtmlAction.command = {
        title: 'Open HTML files',
        command: 'collie.openWorkspaceHtmlFiles'
      };
      openHtmlAction.diagnostics = [diagnostic];
      actions.push(openHtmlAction);
    }

    // Compiler-provided fixes and props actions
    const actionableDiagnostics = diagnostics.filter(diag => diag.range.intersection(range));
    for (const diagnostic of actionableDiagnostics) {
      const data = diagnostic.data as DiagnosticData | undefined;
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
          actions.push(buildRemovePropAction(document, diagnostic, data.fix));
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

function activateIdCodeActions(context: FeatureContext) {
  const provider = new CollieIdCodeActionProvider();
  
  context.register(
    languages.registerCodeActionsProvider(
      { language: 'collie' },
      provider,
      { providedCodeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceFixAll] }
    )
  );
  
  // Register the rename command
  context.register(
    commands.registerCommand(
      'collie.renameTemplateId',
      async (document: TextDocument, range: Range, currentId: string) => {
        const newId = await window.showInputBox({
          prompt: 'Enter new template ID',
          value: `${currentId}2`,
          validateInput: (value) => {
            if (!value || !value.trim()) {
              return 'ID cannot be empty';
            }
            if (/\s/.test(value)) {
              return 'ID cannot contain whitespace';
            }
            return null;
          }
        });
        
        if (!newId) {
          return;
        }
        
        const edit = new WorkspaceEdit();
        
        // Check if there's an explicit ID directive
        const firstLine = document.lineAt(0);
        const idDirectiveMatch = /^(#?id)(?:\s+|:\s*|=\s*)(.+)$/i.exec(firstLine.text.trim());
        
        if (idDirectiveMatch) {
          // Replace existing ID directive value
          const valueStart = firstLine.text.indexOf(idDirectiveMatch[2]);
          const valueRange = new Range(
            0,
            valueStart,
            0,
            valueStart + idDirectiveMatch[2].length
          );
          edit.replace(document.uri, valueRange, newId);
        } else {
          // Insert new ID directive at the top
          edit.insert(document.uri, document.positionAt(0), `#id ${newId}\n\n`);
        }
        
        await workspace.applyEdit(edit);
      }
    )
  );
  
  // Register the open conflicting templates command
  context.register(
    commands.registerCommand(
      'collie.openConflictingTemplates',
      async (uris: Array<{ toString(): string }>) => {
        for (const uri of uris) {
          await window.showTextDocument(uri as any, { preview: false });
        }
      }
    )
  );
  
  // Register the open workspace HTML files command
  context.register(
    commands.registerCommand(
      'collie.openWorkspaceHtmlFiles',
      async () => {
        const htmlFiles = await workspace.findFiles('**/*.html', '**/node_modules/**', 10);
        
        if (htmlFiles.length === 0) {
          window.showInformationMessage('No HTML files found in workspace.');
          return;
        }
        
        for (const uri of htmlFiles) {
          await window.showTextDocument(uri, { preview: false });
        }
      }
    )
  );
  
  context.logger.info('Collie ID code actions registered.');
}

registerFeature(activateIdCodeActions);
