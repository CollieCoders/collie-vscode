## Context & Problem

You are working in the `collie-vscode` repo (VS Code extension). When converting TSX → Collie, the generated `#props` block currently includes TypeScript-y annotations like `: any`. Josh already removed the `: any` portion from the `const lines = ...` in `src/features/conversion/collieFileWriter.ts` so props now emit as plain names.

Now we want to improve the UX and unlock better semantic highlighting:

### Desired output format

Instead of emitting fake types, function/hook props should be annotated with `()`:

```collie
#props
  setCount()
  count
```

This is purely declarative inside the `#props` directive (it must NOT imply invocation). It’s just a visual cue that the prop is callable.

### Semantic highlighting goal

We want function-based props in the `#props` block to have a distinct semantic token type (separate from value props), so Josh can assign a different color in theme settings.

---

## Requirements

### A) Conversion output changes (TSX → Collie)

1. Update the conversion pipeline so it can determine a “prop kind”:

   * **fn** (callable): emit `name()`
   * **value**: emit `name`
   * If unsure: treat as `value` (do NOT emit `()`)

2. Heuristics to classify as fn:

   * If identifier is the callee of a call expression (e.g., `setCount(...)`) anywhere in collected expression text → fn
   * If identifier is passed as a bare identifier to an event handler prop like `onClick={setCount}` (or other `on*` prop names) → fn
   * If expression is an arrow function that calls the identifier → fn

3. The classification should be implemented in the same “collect identifiers from expressions” area used today (TS parser based) so we don’t create a separate slow parser.

4. Update `src/features/conversion/collieFileWriter.ts` to accept either:

   * an array of `{ name, kind }`
   * or a map `name -> kind`
     and output `name()` for kind `fn`, else `name`.

5. Ensure stable ordering of props in output (keep the current behavior, or sort alphabetically if it’s currently unstable — but don’t introduce random ordering changes).

### B) Parser support for #props lines

Update `src/lang/parseDocument.ts` so it can parse `#props` entries with the new syntax:

* Accept:

  * `foo`
  * `foo()`

* Continue accepting legacy formats if they exist:

  * `foo: any`
  * `foo: fn`
  * `foo?: any` etc.
    But normalize internally so that the parsed prop record includes:
  * `name: string`
  * `kind?: 'fn' | 'value'` (optional; default to `value` if absent)

Do NOT treat `()` as a call or parse arguments. Only allow exactly `()`.

### C) Semantic tokens for props

We want a brand new semantic token type for function props inside `#props`:

* New semantic token type name must be created and registered in:

  * `src/features/semanticTokens/legend.ts` (or wherever token types are listed)
  * Ensure provider includes it so VS Code sees it

* Update tokenizer:

  * Identify when we are inside a `#props` directive block
  * For each prop line:

    * If it matches `name()`:

      * emit token for `name` using the NEW function-prop token type
      * emit punctuation token(s) for `()` as you already do (or as plain punctuation — just don’t style it as the prop)
    * If it matches `name`:

      * emit token for `name` using the EXISTING props token type (current behavior)

* Update any regex patterns used for props fields in:

  * `src/features/semanticTokens/helpers/patterns.ts`
    so it matches both `name` and `name()` (and still matches legacy `name: type`).

### D) Verification steps

After implementing:

1. Run `pnpm lint` and `pnpm build` (or the repo’s normal scripts) and fix all TS errors.
2. Confirm that converting TSX produces:

   * `setCount()` for function/hook props
   * `count` for value props
3. Confirm in VS Code Semantic Tokens Inspector that the new token type is present and is applied to function props in the `#props` block.

---

## Do NOT write tests

No unit tests, no integration tests, no snapshots. Only implement the refactor and keep behavior stable otherwise.

---

## Notes / Guidance

* Prefer small, well-named helpers rather than huge functions.
* Keep changes localized to conversion + parseDocument + semanticTokens.
* Avoid circular dependencies; do not add new barrels unless necessary.
* When you create the new semantic token type, print it out in a short summary at the end of your response, like:

  “New semantic token type: `<tokenNameHere>`”

So I can then update the theme colors.
