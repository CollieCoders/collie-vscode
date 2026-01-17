/**
 * Safely execute a regex pattern without leaving lastIndex in an inconsistent state.
 * Always resets lastIndex to 0 before execution.
 * 
 * @param pattern - The RegExp pattern to execute (should have 'g' flag if used in loops)
 * @param text - The text to match against
 * @returns The match result or null
 */
export function execPattern(pattern: RegExp, text: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(text);
}

/**
 * Execute a regex pattern in a loop, yielding all matches.
 * Safely manages lastIndex state throughout iteration.
 * 
 * @param pattern - The RegExp pattern to execute (must have 'g' flag)
 * @param text - The text to match against
 * @returns An iterable of match results
 */
export function* execPatternAll(pattern: RegExp, text: string): IterableIterator<RegExpExecArray> {
  if (!pattern.global) {
    throw new Error('execPatternAll requires a global RegExp pattern (use /pattern/g)');
  }
  
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    yield match;
  }
  pattern.lastIndex = 0;
}

/**
 * Test if a pattern matches text, always resetting lastIndex.
 * 
 * @param pattern - The RegExp pattern to test
 * @param text - The text to test against
 * @returns true if the pattern matches
 */
export function testPattern(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}
