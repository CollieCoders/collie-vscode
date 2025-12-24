import { SemanticTokensLegend } from 'vscode';

export const collieSemanticTokenTypes = [
  'collieTag',
  'collieClassShorthand',
  'collieDirective',
  'colliePropsKeyword',
  'colliePropsField',
  'collieInterpolation',
  'colliePipeText',
  'collieComment',
  'collieClassesKeyword',
  'collieClassAliasName',
  'collieClassAliasUsage',
  'collieForLoop',
  'collieExpressionLine',
  'collieComponent',
  'collieSingleBraceInterpolation',
  'collieIdKeyword',
  'collieIdValue'
] as const;

export type CollieSemanticTokenType = (typeof collieSemanticTokenTypes)[number];

export const collieSemanticTokenModifiers: string[] = [];

export const collieSemanticTokensLegend = new SemanticTokensLegend(
  collieSemanticTokenTypes as readonly string[],
  collieSemanticTokenModifiers
);
