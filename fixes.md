## Stage 1 — Make the conversion output valid Collie (attributes + text mixing)

**Repo:** `collie-vscode`

## Context & Problem

The TSX selection → Collie conversion currently generates Collie that triggers parser diagnostics in the VS Code extension.

Root cause: `src/format/parser/parse.ts` does NOT support attributes after tag names, but the converter prints them as space-separated tokens (e.g. `a href="..." target="_blank"`).

We need the converter to emit *valid Collie attribute syntax* consistent with the Collie compiler, which uses parentheses:
- `a(href="..." target="_blank")`
- `img.logo(src={viteLogo} alt="Vite logo")`

## Goal

Update the conversion printer so elements with props print props in parentheses, not as space-separated tokens.

Also ensure mixed inline content like:
`Edit <code>src/App.tsx</code> and save`
becomes valid Collie under `p`:
- `p`
  - `| Edit`
  - `code | src/App.tsx`
  - `| and save to test HMR`

## Where to work

- `src/convert/collie/print.ts`
- potentially how `IrProp` / `IrExpression` are rendered by `formatProps()` and `formatExpressionPayload()`

## Constraints

- Do NOT refactor the whole converter pipeline.
- Do NOT change the IR structure unless absolutely necessary.
- Smallest change that makes output valid.

## Acceptance Criteria

Given JSX like the Vite template, the generated Collie:
- uses parentheses for attributes
- does not produce parser errors for “attributes after tag name”
- preserves `{{ expr }}` / `{expr}` style consistently with existing rules

## Do NOT write tests

Just implement and briefly explain the formatting change.

---

## Stage 2 — Teach the VS Code Collie parser to accept the same syntax the compiler accepts

**Repo:** `collie-vscode`

## Context & Problem

The VS Code extension uses `src/format/parser/parse.ts` for parsing/diagnostics, but its `parseElement()` currently rejects any tokens after the tag name other than `.class` or `|` inline text.

The Collie compiler supports element attributes in parentheses:
`a(href="..." target="_blank")`

So the extension’s parser must support:
- `.class` shorthands
- optional `( ... )` attribute groups after classes
- optional `? guard` (if we support it here; match compiler behavior where practical)
- optional inline text starting with `|`

## Goal

Update `src/format/parser/parse.ts` so element lines can include:
- `tag.class1.class2(attr="value" other={expr})`
- and still allow `|` inline text after the element header

You do NOT need to implement the entire compiler parser; just align element header parsing to accept parentheses attribute groups so editor diagnostics match real usage.

## Where to work

- `src/format/parser/parse.ts` — specifically `parseElement()`

## Constraints

- Keep it incremental and low-risk.
- Do not rewrite the whole parser; only extend `parseElement()` parsing rules.
- If attribute parsing is needed, implement a minimal parentheses scanner that:
  - finds the matching `)`
  - captures the attribute payload string
  - stores it in the AST (if AST supports it), OR (if AST doesn’t) at least allows it syntactically and does not error.

## Acceptance Criteria

These should NOT error at the element-header level:
- `a(href="https://vite.dev" target="_blank")`
- `img.logo(src={viteLogo} alt="Vite logo")`

And existing valid syntax remains valid:
- `div`
- `div.foo`
- `p | hello`

## Do NOT write tests

---

## Stage 3 — Fragment-aware replacement in TSX: inject `<Collie />` inside `<>...</>`

**Repo:** `collie-vscode`

## Context & Problem

The convert command always replaces the selected range with `<Collie id="X" />`:

`applyTsxEdits()` -> `edit.replace(selection.selection, '<Collie ... />')`

This breaks natural workflows when the selection includes fragments:
- If user selects `<> ... </>`, we should preserve the fragment wrapper
- The fragment(s) should NOT be included in the Collie conversion output
- The TSX should become:
  <>
    <Collie id="AppComponent" />
  </>

We also want partial-fragment resilience:
- If selection accidentally includes only the opening `<>` OR only the closing `</>`,
  do not break TSX; trim the stray fragment token out of the replace range and proceed.

## Goal

Make replacement fragment-aware:
1) Detect whether the selection begins with a fragment open token `<>` (ignoring whitespace/comments)
2) Detect whether the selection ends with fragment close token `</>` (ignoring whitespace/comments)
3) Convert only the *interior JSX nodes* to Collie
4) Replace only the interior range with `<Collie id="X" />`
   - If both fragment tokens are present: keep them and inject inside
   - If only one is present: keep it in TSX and only replace what’s safe

## Where to work

- `src/features/conversion/convertSelectionCommand.ts` (applyTsxEdits / selection logic)
- `src/convert/tsx/parseSelection.ts` (may need to return offsets that indicate what substring was parsed)

## Constraints

- No large refactors.
- Keep behavior unchanged for non-fragment selections.
- Prefer robust token checks over regex-only hacks (use TypeScript AST where possible).

## Acceptance Criteria

Given:
return (
  <>
    <div>...</div>
  </>
)

If user selects from `<>\n ... \n</>` the result in TSX is:
return (
  <>
    <Collie id="X" />
  </>
)

If user selects ending with only `</>`, TSX remains syntactically valid and still inserts `<Collie id="X" />` appropriately.

## Do NOT write tests

---

## Stage 4 — “Second conversion appends to the SAME #id block” (not a new template)

**Repo:** `collie-vscode`

## Context & Problem

Right now, converting a selection creates a new template block via `writeTemplateBlock()`, which always appends a new `#id <newId>` section to the .collie file.

But a common workflow is:
- Convert part A -> creates `#id AppComponent` in `App.collie`
- Convert part B later -> should append to the EXISTING `#id AppComponent` block (same file, same id)
  rather than creating `#id AppComponent2` etc.

## Goal

Add an "append to existing template id" path:
- When the target .collie file exists and contains template ids, offer a QuickPick:
  - Create new template
  - Append to existing template: <id>  (for ids in that file)
- If user chooses append:
  - Insert the new Collie output at the end of the chosen template block (before the next #id or EOF)
  - Add a blank line between existing content and appended content (unless already separated)
  - Do NOT replace or delete existing content

## Where to work

- `src/features/conversion/convertSelectionCommand.ts` (QuickPick options)
- `src/features/conversion/collieFileWriter.ts` (implement `appendToTemplateBlock(uri, templateId, collieText)`)

## Constraints

- Keep existing "matching template by content" reuse behavior.
- This new behavior is for "same id, append new content", not content matching.
- Minimal file edits; preserve EOL style.

## Acceptance Criteria

- After first conversion: `App.collie` has `#id AppComponent` + content
- After second conversion selecting another TSX block and choosing "Append to AppComponent":
  - the new Collie lines appear under the same `#id AppComponent` section
  - existing content is preserved
  - file is not overwritten
