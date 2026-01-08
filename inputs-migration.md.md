## Phase 1 — Rename the Collie AST concept: `props` → `inputs` (core type/system refactor)

This is the structural backbone. Everything else becomes easier if the AST is clean.

### 1.1 Rename AST interfaces and fields

**Files:**

* `src/format/parser/ast.ts`

**Changes:**

* `PropsDecl` → `InputsDecl`
* `PropsField` → `InputsField`
* `RootNode.props?: PropsDecl` → `RootNode.inputs?: InputsDecl`

**Notes:**

* Do this early: it forces TypeScript to show you every callsite that still assumes props exist.

### 1.2 Update imports/exports and any re-export barrels

**Files likely involved:**

* `src/format/parser/index.ts`
* `src/format/parser/types.ts` (if it references props concepts)
* Any file importing `PropsDecl`, `PropsField`, `root.props`

**Acceptance**

* TypeScript errors guide you to all remaining callsites, and you fix them as you go.
* After Phase 1, there is **no `PropsDecl`, `PropsField`, or `root.props`** anywhere.

---

## Phase 2 — Parser: make `#inputs` first-class, and make `props/#props` a hard error

Right now, the repo supports “props” in two ways:

* the parser recognizes `props` (no hash) header, but doesn’t parse field lines (that code is commented out)
* `src/lang/parseDocument.ts` separately scans for `#props` and injects it into the root AST

We want:

* parser recognizes **only** `#inputs`
* parser parses fields (using the same rules you already implemented for `#props` parsing)
* `props`, `#props`, and `inputs` (without hash) are hard errors

### 2.1 Update the main parser to support `#inputs`

**File:**

* `src/format/parser/parse.ts`

**Changes:**

1. Replace:

   * `let propsBlockLevel: number | null = null;`
     with:
   * `let inputsBlockLevel: number | null = null;`

2. Replace the `trimmed === 'props'` block with `trimmed === '#inputs'`

   * same placement rules:

     * must be at top level (`level === 0`)
     * must appear before template nodes
     * should appear after `#id` if present (keep existing ID ordering rules)
   * set `root.inputs = { fields: [], span: … }`
   * set `inputsBlockLevel = level`

3. Implement the field parsing under the `#inputs` block:

   * Use the exact same rules you have today in `parseHashPropsDeclaration`:

     * new syntax: `name` or `name()`
     * legacy syntax: `name?: type` or `name: type`
   * Store results in `root.inputs.fields`.

4. Hard error behavior:

   * Detect **any** of:

     * `props`
     * `#props`
     * `inputs` (without hash)
   * Emit a diagnostic with:

     * **message that never says “props”**

       * e.g. `"Invalid directive. Use #inputs."`
     * span highlighting the offending word
     * pick a code like `COLLIE105` (new) or reuse an existing “unknown/invalid directive” code pattern if you already have one.

### 2.2 Remove the `#props` injection hack

**File:**

* `src/lang/parseDocument.ts`

**Current behavior:**

* finds `#props` blocks
* filters certain parser diagnostics inside those blocks
* parses the `#props` header/fields and assigns `root.props`

**Replace with:**

* optionally: **remove the whole hash-block scan entirely**
* do *not* filter diagnostics inside legacy blocks — because legacy blocks should now be *errors*, not special-cased safe areas
* do not parse or inject anything related to legacy keywords

**If you still need a “hash block” scan for other directives** (I don’t see one other than `#props`):

* delete `findHashPropsBlocks`, `parseHashPropsDeclaration`, and their callsites.

**Acceptance for Phase 2**

* `#inputs` parses and is present in `ast.inputs`
* `props`, `#props`, or `inputs` (no hash) produces a hard error diagnostic
* There is **no more post-parse injection of block content** for inputs

---

## Phase 3 — Printer/formatter: output `#inputs` and rename “props spacing” options/settings

### 3.1 Printer outputs `#inputs`

**File:**

* `src/format/printer/print.ts`

**Changes:**

* Replace `printProps` with `printInputs`
* Header line should be exactly: `'#inputs'` (hash required)
* Keep field rendering behavior identical to current props behavior
* Replace option `normalizePropsSpacing` → `normalizeInputsSpacing`

### 3.2 Update formatting provider wiring

**File:**

* `src/features/formatting/formatProvider.ts`

**Change:**

* `config.get('format.normalizePropsSpacing')` → `config.get('format.normalizeInputsSpacing')`

### 3.3 Update `package.json` settings contribution

**File:**

* `package.json`

**Changes:**

* Rename setting key:

  * `collie.format.normalizePropsSpacing` → `collie.format.normalizeInputsSpacing`
* Update descriptions so they never mention props.

**Acceptance**

* Formatting a file outputs `#inputs` when inputs exist
* Settings contain no “props” keys or descriptions

---

## Phase 4 — Semantic tokens & customization commands: rename token types and patterns to Inputs

### 4.1 Patterns: `propsKeywordPattern` → `inputsKeywordPattern` (hash required)

**File:**

* `src/features/semanticTokens/helpers/patterns.ts`

**Changes:**

* `propsKeywordPattern = /^(\s*)(#?props)\b/;` → `inputsKeywordPattern = /^(\s*)(#inputs)\b/;`
* `propsFieldPattern` → `inputsFieldPattern` (same regex is fine)

### 4.2 Token legend: rename token type strings

**File:**

* `src/features/semanticTokens/legend.ts`

**Changes:**

* `colliePropsKeyword` → `collieInputsKeyword`
* `colliePropsField` → `collieInputsField`
* `colliePropsFieldFn` → `collieInputsFieldFn`

This is important because users can configure these in VS Code token customization.

### 4.3 Tokenizer: update state names + block detection

**File:**

* `src/features/semanticTokens/tokenize.ts`

**Changes:**

* `state.propsIndent` → `state.inputsIndent`
* recognize `#inputs` header line and set `inputsIndent`
* treat legacy keywords as neither block headers nor tokenized “special” blocks

### 4.4 Customization command rename

**Files:**

* `src/features/customization/commands.ts`
* `package.json` (commands contributions)

**Changes:**

* Command id:

  * `collie.customizePropsFieldColor` → `collie.customizeInputsFieldColor`
* Title:

  * “Customize Props Field Color” → “Customize Inputs Field Color”
* Token type references: use `collieInputsField`

**Acceptance**

* Semantic highlighting works for `#inputs` header and fields
* There are **no props token types or command ids** left

---

## Phase 5 — Hover + Navigation UI: rename labels and hook to `ast.inputs`

### 5.1 Hover provider

**File:**

* `src/features/hover/provider.ts`

**Changes:**

* Rename the “props hover” helpers:

  * `createPropsHover` → `createInputsHover`
  * `getPropsHover` → `getInputsHover`
* Update any UI text:

  * “Defined in the props block.” → “Defined in the inputs block.”
* Read from `parsed.ast.inputs`

### 5.2 Document symbols (outline)

**File:**

* `src/features/navigation/documentSymbols.ts`

**Changes:**

* `buildPropsSymbol` → `buildInputsSymbol`
* Symbol name should be `inputs`
* Description should be “Inputs block” (or similar)
* Read `parsed.ast.inputs`

**Acceptance**

* Hover and outline show `inputs` terminology only
* No “props” strings exist in these features

---

## Phase 6 — Diagnostics: rename everything and update logic to use Inputs

This repo has diagnostics that:

* compare “declared props” vs “used props” (compiler-style or parse-based)
* optionally do TS/React integration against a component’s JSX usage
* include code actions for “insert props block” and “add missing prop”

All of these must become inputs equivalents, and must never mention props.

### 6.1 Rename diagnostics modules and APIs

**Files:**

* `src/features/diagnostics/tsPropsDiagnostics.ts` → `tsInputsDiagnostics.ts`
* Update import in `src/features/index.ts`

Also rename exported function:

* `registerTsPropsDiagnostics` → `registerTsInputsDiagnostics`

### 6.2 Update the diagnostics logic

**Files:**

* `src/features/diagnostics/compilerDiagnostics.ts`
* `src/features/diagnostics/provider.ts`
* `src/features/diagnostics/codeActions.ts`

**Key changes:**

* Any `declaredProps` set becomes `declaredInputs`
* Anything that checks “in props block” becomes “in inputs block”

  * In `provider.ts` it literally checks `trimmed === '#props'` today — must become `'#inputs'`.
* Diagnostic messages must never say “props”

  * Use “inputs”, “declared inputs”, “missing input declaration”, etc.
* Code actions:

  * If you currently have code actions that insert `#props` or add `propName` to the block:

    * update to `#inputs`
    * rename helper functions:

      * `findPropsBlock` → `findInputsBlock`
      * `findInsertLineForNewPropsBlock` → `findInsertLineForNewInputsBlock`
    * the code action titles also must say “Inputs”

### 6.3 Update the config-driven “React integration” feature key

Right now you have:

* `collie.props.reactIntegration.enabled` (VS Code setting)
* config parsing: `config.props.reactIntegration.enabled`
* parsed field: `propsReactIntegrationEnabled`

All must become inputs equivalents.

**Files:**

* `package.json`
* `src/config/helpers.ts`
* `src/config/types.ts`
* any feature that reads `propsReactIntegrationEnabled`

**Changes:**

* setting key:

  * `collie.inputs.reactIntegration.enabled`
* config shape (from collie.config.*):

  * `config.inputs.reactIntegration.enabled`
* parsed type:

  * `inputsReactIntegrationEnabled`

**Acceptance**

* Diagnostics feature produces “inputs” language everywhere
* No module/file/function names include `Props`
* No config/settings keys include `.props.` anywhere

---

## Phase 7 — Conversion: TSX selection → Collie output uses `#inputs`

There are two conversion directions in the repo:

* TSX/JSX → IR → Collie printing (this uses “props” to mean JSX attributes)
* TSX selection conversion command and `collieFileWriter.ts` that creates template blocks and currently inserts `#props`

You want the result:

* when conversion decides a block is needed, it emits `#inputs`
* no `#props` ever appears

### 7.1 Convert the Collie file writer helpers

**File:**

* `src/features/conversion/collieFileWriter.ts`

**Current props-specific functions:**

* `buildPropsBlock` emits `#props`
* `updateTemplateBlockProps`
* `findPropsBlockStart`, `findPropsBlockEnd`, `collectPropsFromBlock`
* logic that checks `line.trim() !== '#props'` etc.

**Change:**

* rename everything to Inputs
* emit `#inputs`
* detect `#inputs` block when updating
* if it previously did “insert props block if needed,” now do “insert inputs block if needed”

**Important:** since you want hard errors for legacy blocks, I would also:

* ensure the writer never tries to preserve/merge with `#props`
* if it encounters `#props` during update, treat it as:

  * either delete/replace automatically (aggressive), or
  * refuse with an error (but that introduces friction)
    Given your “pretend it never existed” stance, **auto-replace** inside conversion/write flows is reasonable.

### 7.2 Reduce “props” naming inside JSX conversion IR

You have a lot of `node.props` in the conversion IR types (`src/convert/**`). That’s “JSX props” terminology, but it will violate your “no trace of props” goal.

**Files:**

* `src/convert/ir/nodes.ts`
* `src/convert/tsx/jsxToIr.ts`
* `src/convert/tsx/print.ts`
* `src/convert/collie/print.ts`
* `src/convert/collie/astToIr.ts` (has comments that mention “Collie props block present…”)

**Recommendation:**

* Rename IR fields:

  * `props` → `attributes` (or `attrs`)
* Rename helper names:

  * `normalizeProps` → `normalizeAttributes`
  * etc.

Also update `astToIr.ts` comment text to “Collie inputs …” or remove if unnecessary.

**Acceptance**

* Converting a selection that needs inputs emits `#inputs` and fields under it
* The conversion subsystem contains no “props” wording anywhere

---

## Phase 8 — TextMate grammar: `props` scopes → `inputs` scopes (and header becomes `#inputs`)

**File:**

* `syntaxes/collie.tmLanguage.json`

**Current:**

* It matches `props` without hash: `begin: "^\\s*(props)\\b"`
* Scope names include `.props.`

**Change:**

* Update begin regex to match `#inputs` exactly:

  * `^\\s*(#inputs)\\b`
* Update scopes:

  * `storage.type.props.collie` → `storage.type.inputs.collie`
  * `meta.props.field.collie` → `meta.inputs.field.collie`
  * `variable.parameter.props.collie` → `variable.parameter.inputs.collie`
  * any remaining `.props.` segments become `.inputs.`

**Acceptance**

* Syntax highlighting recognizes the new block
* There are no scope strings containing `props`

---

## Phase 9 — Docs + package.json descriptions: rewrite as if props never existed

### 9.1 README

**File:**

* `README.md`

**Change:**

* Every mention of:

  * `#props` → `#inputs`
  * “props fields” → “inputs fields”
  * “props” anywhere in descriptive text → “inputs”

Also update examples (there are explicit `#props` sample blocks in the README).

### 9.2 package.json

**File:**

* `package.json`

**Change:**

* Setting descriptions:

  * hover description currently says “directives, props, expressions” → “directives, inputs, expressions”
  * normalizePropsSpacing → normalizeInputsSpacing
  * react integration setting descriptions
* Command titles, categories, etc.

**Acceptance**

* Repo docs read like inputs was always the name

---

## Phase 10 — Final “no props anywhere” cleanup & verification

This is where you make the promise true.

1. Run your Phase 0 ban check and ensure it passes.
2. Run:

   * `pnpm lint` (or your repo’s lint script)
   * `pnpm typecheck` / `tsc --noEmit`
   * build + package if you have it: `pnpm package` / `vsce package` flow
3. Manual smoke checks in VS Code:

   * Open a `.collie` file with `#inputs`

     * verify semantic tokens on header/fields
     * verify hover shows “inputs”
     * verify outline shows “inputs”
     * verify formatter prints `#inputs`
   * Open a `.collie` file with `#props`

     * verify you get **hard error** diagnostic
     * verify message does **not** say “props”
   * Run TSX selection → Collie conversion

     * verify it generates `#inputs` block when needed

**Acceptance**

* Grep for `props` yields zero results in:

  * code
  * strings
  * docs
  * scopes
  * settings/commands/token types
* The extension behaves correctly with `#inputs` and rejects legacy keywords cleanly.
