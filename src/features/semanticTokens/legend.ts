import { SemanticTokensLegend } from 'vscode';

export const collieSemanticTokenTypes = [
  'collieTag',
  'collieClassShorthand',
  'collieDirective',
  'collieInputsKeyword',
  'collieInputsField',
  'collieInputsFieldFn',
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
  'collieIdValue',
  'collieEventHandler'
] as const;

export type CollieSemanticTokenType = (typeof collieSemanticTokenTypes)[number];

export const collieSemanticTokenModifiers: string[] = [];

export const collieSemanticTokensLegend = new SemanticTokensLegend(
  collieSemanticTokenTypes as unknown as string[],
  collieSemanticTokenModifiers
);
