import {
  CodeAction,
  CodeActionKind,
  CodeActionProvider,
  languages,
  Range,
  TextDocument,
  WorkspaceEdit,
  commands,
  window,
  workspace
} from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { getTemplateIdEntries } from '../../lang/cache';
// import * as path from 'path';

class CollieIdCodeActionProvider implements CodeActionProvider {
  provideCodeActions(document: TextDocument, range: Range): CodeAction[] {
    const actions: CodeAction[] = [];
    const diagnostics = languages.getDiagnostics(document.uri);
    
    // Find diagnostics that overlap with the current range
    const relevantDiagnostics = diagnostics.filter(diag => 
      diag.code === 'COLLIE403' && diag.range.intersection(range)
    );
    
    if (relevantDiagnostics.length === 0) {
      return actions;
    }
    
    for (const diagnostic of relevantDiagnostics) {
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
    
    return actions;
  }
}

function activateIdCodeActions(context: FeatureContext) {
  const provider = new CollieIdCodeActionProvider();
  
  context.register(
    languages.registerCodeActionsProvider(
      { language: 'collie' },
      provider,
      { providedCodeActionKinds: [CodeActionKind.QuickFix] }
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
  
  context.logger.info('Collie ID code actions registered.');
}

registerFeature(activateIdCodeActions);
