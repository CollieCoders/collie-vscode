import { CompletionItem, CompletionItemKind, languages, MarkdownString, Position, TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { getAllTemplateIds } from '../../lang/cache';
import { isFeatureFlagEnabled } from '../featureFlags';

/**
 * Checks if the cursor is inside an HTML id attribute value.
 * Returns true if we should provide Collie ID completions.
 */
function isInsideIdAttribute(document: TextDocument, position: Position): boolean {
  const line = document.lineAt(position.line);
  const lineText = line.text;
  const offset = position.character;
  
  // Look for id="..." or id='...' patterns before the cursor
  // We want to match when cursor is inside the quotes
  
  // Find all id attributes on this line
  const idPattern = /\bid\s*=\s*(["'])([^"']*)\1/gi;
  let match: RegExpExecArray | null;
  
  while ((match = idPattern.exec(lineText))) {
    const quoteChar = match[1];
    const idValue = match[2];
    
    // Find the start and end positions of the id value (not including quotes)
    const valueStart = match.index + match[0].indexOf(quoteChar) + 1;
    const valueEnd = valueStart + idValue.length;
    
    // Check if cursor is within the id value
    if (offset >= valueStart && offset <= valueEnd) {
      return true;
    }
  }
  
  // Also check for incomplete id attributes: id=" or id='
  const incompletePattern = /\bid\s*=\s*(["'])$/;
  const beforeCursor = lineText.slice(0, offset);
  if (incompletePattern.test(beforeCursor)) {
    return true;
  }
  
  return false;
}

/**
 * Provides completions for Collie template IDs in HTML id attributes.
 */
function provideHtmlIdCompletions(
  document: TextDocument,
  position: Position,
  context: FeatureContext
): CompletionItem[] | undefined {
  if (document.languageId !== 'html' || !isFeatureFlagEnabled('completions')) {
    return undefined;
  }
  
  // Only provide completions inside id attribute values
  if (!isInsideIdAttribute(document, position)) {
    return undefined;
  }
  
  try {
    // Get all known template IDs from the index
    const templateIds = getAllTemplateIds();
    const completionItems: CompletionItem[] = [];
    
    for (const [logicalId, entries] of templateIds.entries()) {
      const collieId = `${logicalId}-collie`;
      
      const item = new CompletionItem(collieId, CompletionItemKind.Value);
      item.insertText = collieId;
      item.detail = 'Collie template placeholder';
      
      // Create documentation showing template info
      const templateCount = entries.length;
      const templatePaths = entries.map(e => e.uri.fsPath).join('\n- ');
      
      const docs = new MarkdownString();
      docs.appendMarkdown(`Placeholder for Collie template \`${logicalId}\`.\n\n`);
      docs.appendMarkdown(`The runtime will fetch \`/collie/dist/${logicalId}.html\`.\n\n`);
      
      if (templateCount === 1) {
        docs.appendMarkdown(`**Template file:**\n- ${templatePaths}`);
      } else {
        docs.appendMarkdown(`**Template files (${templateCount}):**\n- ${templatePaths}`);
      }
      
      item.documentation = docs;
      
      // Sort Collie completions to the top
      item.sortText = `0_${collieId}`;
      
      completionItems.push(item);
    }
    
    return completionItems;
  } catch (error) {
    context.logger.error('HTML Collie ID completion provider failed.', error);
    return undefined;
  }
}

function activateHtmlCollieIdCompletionProvider(context: FeatureContext) {
  const provider = languages.registerCompletionItemProvider(
    { language: 'html', scheme: 'file' },
    {
      provideCompletionItems(document, position) {
        return provideHtmlIdCompletions(document, position, context);
      }
    },
    '"', // Trigger on quote
    "'"  // Trigger on single quote
  );
  
  context.register(provider);
  context.logger.info('HTML Collie ID completion provider registered.');
}

registerFeature(activateHtmlCollieIdCompletionProvider);
