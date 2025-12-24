import { languages, Location, Position, Range, Uri, type DefinitionLink, type TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { findTemplatesByLogicalId, getLogicalIdFromHtmlIdAttribute } from '../../lang/navigation';
import { isFeatureFlagEnabled } from '../featureFlags';

/**
 * Attempts to find the id="..." attribute value at the given position in an HTML document.
 * Returns the id value (e.g., "homeHero-collie") if found, otherwise undefined.
 */
function extractIdValueAtPosition(document: TextDocument, position: Position): string | undefined {
  const line = document.lineAt(position.line);
  const lineText = line.text;
  const offset = position.character;
  
  // Match id="value" or id='value'
  // We'll search the entire line for id attributes and check if the cursor is within one
  const idPattern = /\bid\s*=\s*(["'])([^"']*)\1/gi;
  let match: RegExpExecArray | null;
  
  while ((match = idPattern.exec(lineText))) {
    const quoteChar = match[1];
    const idValue = match[2];
    
    // Find the start and end positions of the id value (not including quotes)
    const valueStart = match.index + match[0].indexOf(quoteChar) + 1;
    const valueEnd = valueStart + idValue.length;
    
    // Check if the cursor is within the id value
    if (offset >= valueStart && offset <= valueEnd) {
      return idValue;
    }
  }
  
  return undefined;
}

/**
 * Converts a SourceSpan to a VS Code Range.
 */
function sourceSpanToRange(span: { start: { line: number; col: number }; end: { line: number; col: number } }): Range {
  return new Range(
    new Position(span.start.line, span.start.col),
    new Position(span.end.line, span.end.col)
  );
}

async function provideHtmlToCollieDefinition(
  document: TextDocument,
  position: Position,
  context: FeatureContext
): Promise<DefinitionLink[] | undefined> {
  if (document.languageId !== 'html' || !isFeatureFlagEnabled('navigation')) {
    return undefined;
  }
  
  try {
    // Extract the id attribute value at the cursor position
    const idValue = extractIdValueAtPosition(document, position);
    if (!idValue) {
      return undefined;
    }
    
    // Check if this is a Collie placeholder ID
    const logicalId = getLogicalIdFromHtmlIdAttribute(idValue);
    if (!logicalId) {
      return undefined;
    }
    
    // Find matching Collie templates
    const templates = findTemplatesByLogicalId(logicalId);
    if (templates.length === 0) {
      return undefined;
    }
    
    // Create definition links for each matching template
    const definitionLinks: DefinitionLink[] = [];
    
    for (const template of templates) {
      let targetRange: Range;
      
      if (template.idSpan) {
        // Jump to the explicit id directive
        targetRange = sourceSpanToRange(template.idSpan);
      } else {
        // Jump to the top of the file (implicit ID from filename)
        targetRange = new Range(new Position(0, 0), new Position(0, 0));
      }
      
      definitionLinks.push({
        targetUri: template.uri,
        targetRange: targetRange,
        targetSelectionRange: targetRange
      });
    }
    
    return definitionLinks;
  } catch (error) {
    context.logger.error('HTML to Collie definition provider failed.', error);
    return undefined;
  }
}

function activateHtmlToCollieDefinitionProvider(context: FeatureContext) {
  const provider = languages.registerDefinitionProvider(
    { language: 'html', scheme: 'file' },
    {
      provideDefinition(document, position) {
        return provideHtmlToCollieDefinition(document, position, context);
      }
    }
  );
  
  context.register(provider);
  context.logger.info('HTML to Collie definition provider registered.');
}

registerFeature(activateHtmlToCollieDefinitionProvider);
