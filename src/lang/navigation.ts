import type { Uri, Range, Position } from 'vscode';
import type { SourceSpan } from '../format/parser/diagnostics';
import { getTemplateIdEntries } from './cache';
import { getHtmlPlaceholders, getHtmlPlaceholderRanges } from './htmlAnchorIndex';

export interface TemplateMatch {
  id: string;
  uri: Uri;
  idSpan?: SourceSpan;
  derivedFromFilename: boolean;
}

export interface HtmlAnchorMatch {
  id: string;          // logical ID
  uri: Uri;
  ranges: Range[];     // locations of id="<id>-collie"
}

/**
 * Finds all Collie templates with the given logical ID.
 */
export function findTemplatesByLogicalId(id: string): TemplateMatch[] {
  const entries = getTemplateIdEntries(id);
  return entries.map(entry => ({
    id: entry.id,
    uri: entry.uri,
    idSpan: entry.idSpan,
    derivedFromFilename: entry.derivedFromFilename
  }));
}

/**
 * Finds all HTML files that contain placeholders for the given logical template ID,
 * along with the ranges where those placeholders appear.
 */
export function findHtmlAnchorsByLogicalId(id: string): HtmlAnchorMatch[] {
  const htmlUris = getHtmlPlaceholders(id);
  const results: HtmlAnchorMatch[] = [];
  
  for (const uri of htmlUris) {
    const ranges = getHtmlPlaceholderRanges(uri, id);
    
    if (ranges.length > 0) {
      results.push({
        id,
        uri,
        ranges
      });
    }
  }
  
  return results;
}

/**
 * Extracts the logical template ID from an HTML id attribute value.
 * 
 * @param raw The raw id attribute value (e.g., "homeHero-collie")
 * @returns The logical template ID (e.g., "homeHero"), or undefined if not a Collie placeholder
 * 
 * @example
 * getLogicalIdFromHtmlIdAttribute("homeHero-collie") // returns "homeHero"
 * getLogicalIdFromHtmlIdAttribute("regular-id") // returns undefined
 */
export function getLogicalIdFromHtmlIdAttribute(raw: string): string | undefined {
  if (raw.endsWith('-collie')) {
    const logicalId = raw.slice(0, -7);
    return logicalId.length > 0 ? logicalId : undefined;
  }
  return undefined;
}
