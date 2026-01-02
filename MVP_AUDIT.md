# Demo Readiness Report — Collie VS Code Extension

**Overall MVP completeness (rough): 45%**

**Section readiness (rough):**
- Extension Map: 85%
- Traceability vs DEMO_FLOW_MVP: 35%
- Convert to Collie Deep Dive: 25%
- Diagnostics + Code Actions Deep Dive: 45%
- Formatting Deep Dive: 80%
- Tooling/Config Missing UX Deep Dive: 10%
- Demo-Ready Minimal Plan: 0% (plan only)

**Summary:** Core language plumbing is present (language ID, parser-backed diagnostics, formatter, and copy-as-TSX/JSX commands), but the demo-critical “Convert to Collie” flow does not create/import/replace in TSX and generated Collie output lacks an enforced `#id` + PascalCase validation. Missing tooling/config UX and context menu wiring for the demo commands are also absent, so the end-to-end demo would fail without manual workarounds. Evidence: language + activation + commands in `package.json`, diagnostics + parser in `src/features/diagnostics/provider.ts` and `src/format/parser/parse.ts`, formatter in `src/features/formatting/formatProvider.ts` and `src/format/formatter.ts`, copy-as-TSX in `src/features/conversion/commands.ts` and `src/features/conversion/collieExportCommandsImpl.ts`, and current convert-selection behavior in `src/features/conversion/convertSelectionCommand.ts`.

---

## 1. Extension Map (Entrypoints & Contributions)

- **Activation events**: `onLanguage:collie`, `onCommand:collie.convertTsxSelectionToCollie`, `onCommand:collie.copyAsJsx`, `onCommand:collie.copyAsTsx`. Evidence: `package.json`.
- **Language configuration for `.collie`**: language ID + file association and config wired in `package.json`, with editor rules in `language-configuration.json`, and TextMate grammar in `syntaxes/collie.tmLanguage.json`.
- **Registered commands (IDs + implementation):**
  - `collie.customizeTokenColor`, `collie.customizeTagColor`, `collie.customizeDirectiveColor`, `collie.customizePropsFieldColor`, `collie.customizeClassShorthandColor`, `collie.resetTokenCustomization`, `collie.copyTokenCustomizationSnippet`: `src/features/customization/commands.ts`.
  - `collie.convertTsxSelectionToCollie`, `collie.copyAsJsx`, `collie.copyAsTsx`: registered in `src/features/conversion/commands.ts`, implemented in `src/features/conversion/convertSelectionCommand.ts` and `src/features/conversion/collieExportCommandsImpl.ts`.
  - `collie.openCompiledHtmlPartial`: `src/features/navigation/commands.ts`.
  - `collie.rebuildCssIndex`, `collie.showCurrentConfig`, `collie.toggleUnknownClassDiagnostics`: `src/features/css/commands.ts`.
  - Internal (not contributed in `package.json`): `collie.renameTemplateId`, `collie.openConflictingTemplates`, `collie.openWorkspaceHtmlFiles`: `src/features/diagnostics/codeActions.ts`.
- **Context menu contributions**: Only customization commands are wired to `editor/context` for `collie` documents. Evidence: `package.json`.
- **LSP usage (client/server split)**: No LSP client/server wiring; features register VS Code providers directly (diagnostics, hover, formatting). Evidence: `src/features/diagnostics/provider.ts`, `src/features/hover/provider.ts`, `src/features/formatting/formatProvider.ts`.

---

## 2. Requirement-by-Requirement Traceability (from `DEMO_FLOW_MVP.md`)

### E1 — “Convert to Collie” (TSX selection → `.collie` + TSX placeholder injection)
- **Status:** 🟡 Partial
- **Where in code:** `src/features/conversion/convertSelectionCommand.ts`, `src/convert/tsx/parseSelection.ts`, `src/convert/tsx/jsxToIr.ts`, `src/convert/collie/print.ts`.
- **How it works today:** Command reads selection in TSX/JSX, parses and converts JSX → IR → Collie text, then prompts to create a Collie file or copy to clipboard. Evidence: `src/features/conversion/convertSelectionCommand.ts`, `src/convert/tsx/parseSelection.ts`, `src/convert/tsx/jsxToIr.ts`, `src/convert/collie/print.ts`.
- **Gaps / mismatches:** No TSX replacement, no import insertion, no placeholder usage insertion, no deterministic conflict-safe auto naming (only save dialog + overwrite prompt), no auto `#id` directive in generated Collie output, no context menu wiring for the command. Evidence: behavior and prompts in `src/features/conversion/convertSelectionCommand.ts`, Collie printer in `src/convert/collie/print.ts`, context menus in `package.json`.
- **Demo risk level:** High

### E2 — Diagnostics in `.collie` files (squiggles + hover + quick fixes)
- **Status:** 🟡 Partial
- **Where in code:** `src/features/diagnostics/provider.ts`, `src/format/parser/parse.ts`, `src/features/diagnostics/codeActions.ts`, `src/features/hover/provider.ts`, `src/features/diagnostics/compilerDiagnostics.ts`.
- **How it works today:** Parser diagnostics and custom diagnostics are surfaced via VS Code’s diagnostics collection, updated on change/save with debounce. Hover provider supplies directive/props/expression hovers, but not diagnostic-specific content. Some quick fixes exist (dialect token normalization, prop add/remove, ID collision actions). Evidence: `src/features/diagnostics/provider.ts`, `src/format/parser/parse.ts`, `src/features/hover/provider.ts`, `src/features/diagnostics/codeActions.ts`, `src/features/diagnostics/compilerDiagnostics.ts`.
- **Gaps / mismatches:** No diagnostic for invalid `#id` PascalCase, no quick fix for that case, and no fix-all action. Diagnostic hover for invalid `#id` can’t exist without that diagnostic. Evidence: diagnostics + code actions files above, and absence of PascalCase checks in `src/format/parser/parse.ts`.
- **Demo risk level:** High

### E3 — Format Document for Collie
- **Status:** ✅ Implemented (formatter provider exists)
- **Where in code:** `src/features/formatting/formatProvider.ts`, `src/format/formatter.ts`, `src/format/printer/print.ts`, `src/format/fallback.ts`.
- **How it works today:** DocumentFormattingEditProvider is registered for `collie`, formatting uses parser + printer with a fallback indentation normalizer. Evidence: `src/features/formatting/formatProvider.ts`, `src/format/formatter.ts`, `src/format/printer/print.ts`, `src/format/fallback.ts`.
- **Gaps / mismatches:** Formatting does not apply “fix-all” changes like PascalCase `#id` normalization. Evidence: `src/format/formatter.ts`, `src/format/printer/print.ts`.
- **Demo risk level:** Medium

### E4 — “Convert to TSX (Copy to Clipboard)”
- **Status:** 🟡 Partial
- **Where in code:** `src/features/conversion/commands.ts`, `src/features/conversion/collieExportCommandsImpl.ts`, `src/convert/export/collieExport.ts`.
- **How it works today:** Command converts active `.collie` document to TSX and copies to clipboard, also opening a preview editor. Evidence: `src/features/conversion/collieExportCommandsImpl.ts`, `src/convert/export/collieExport.ts`.
- **Gaps / mismatches:** No editor context menu entry for right-click invocation inside `.collie`. Evidence: `package.json`.
- **Demo risk level:** Medium

### E5 — Tooling/config missing UX
- **Status:** ❌ Missing
- **Where in code:** Config discovery exists but does not show missing tooling/config messages. Evidence: `src/features/config/discovery.ts`, `src/config/collieConfig.ts`.
- **How it works today:** Config is resolved/cached silently; missing config/packages are not surfaced. Evidence: `src/config/collieConfig.ts`, `src/features/config/discovery.ts`.
- **Gaps / mismatches:** No actionable messaging or debounce for missing config/tooling. Evidence: `src/config/collieConfig.ts`, `src/features/config/discovery.ts`.
- **Demo risk level:** High

---

## 3. Convert to Collie Command (Deep Dive)

- **Selection read + validation:** Requires an active editor, TSX/JSX language ID, and non-empty selection; otherwise shows error messages. Evidence: `src/features/conversion/convertSelectionCommand.ts`.
- **Parsing and conversion:** Wraps selection in a virtual TSX file, parses with TypeScript, converts JSX → IR, and prints Collie text. Evidence: `src/convert/tsx/parseSelection.ts`, `src/convert/tsx/jsxToIr.ts`, `src/convert/collie/print.ts`.
- **`.collie` filename generation + conflicts:** Suggests a default name based on the TSX filename, then uses a save dialog and an overwrite prompt if the file exists. Evidence: `src/features/conversion/convertSelectionCommand.ts`.
- **Import insertion + TSX replacement:** Not implemented; no WorkspaceEdit to modify the TSX file or insert imports. Evidence: `src/features/conversion/convertSelectionCommand.ts`.
- **Placeholder usage insertion:** Not implemented; no placeholder component usage or props extraction is written back to TSX. Evidence: `src/features/conversion/convertSelectionCommand.ts`.
- **`#id` handling:** The Collie output does not include a generated `#id` directive. Evidence: `src/convert/collie/print.ts`.

**Biggest demo break risks + minimal hardening:**
- The command currently never edits the TSX file or inserts an import, so the demo flow stops after file creation. Mitigation: add a single WorkspaceEdit that (1) replaces selection with `<ComponentName />`, (2) inserts an import at the bottom of the import block, and (3) saves/opens the new `.collie` file. Implementation should live near `runConvertTsxSelectionToCollie` in `src/features/conversion/convertSelectionCommand.ts`.
- Generated Collie lacks `#id` (and PascalCase). Mitigation: prepend `#id <PascalCaseName>` when creating the new `.collie` file, using the same component name chosen for the TSX import. Implementation can occur before `workspace.fs.writeFile` in `src/features/conversion/convertSelectionCommand.ts`.
- Naming conflicts are not auto-resolved. Mitigation: if the suggested name exists, append `-1`, `-2`, etc. before showing the dialog, or auto-pick the next available name when running the demo. Implementation can extend `suggestCollieFileUri` in `src/features/conversion/convertSelectionCommand.ts`.
- Complex JSX expressions are replaced with placeholders in Collie output; this could surprise in a demo. Mitigation: detect warnings and show a single actionable toast before writing output. Evidence for current placeholders: `src/convert/tsx/jsxToIr.ts`.

---

## 4. Diagnostics + Code Actions (Deep Dive)

- **Diagnostic source:** In-process parser (`parse`) with AST caching; additional diagnostics are built in the extension (unknown directives, duplicate props, ID collisions, missing HTML placeholders, unknown classes, dialect tokens, props usage). Evidence: `src/format/parser/parse.ts`, `src/lang/cache.ts`, `src/features/diagnostics/provider.ts`, `src/features/diagnostics/compilerDiagnostics.ts`.
- **Range computation:** Parser spans are converted to VS Code ranges via `spanToRange`/`spanPositionToVs`. Evidence: `src/features/diagnostics/provider.ts`.
- **Hover implementation:** Dedicated hover provider uses AST to show directive/props/expression/class alias hints, not diagnostic-specific hover content. Evidence: `src/features/hover/provider.ts`.
- **Quick fixes:** CodeActionProvider applies fixes embedded in diagnostics, plus special actions for ID collisions and HTML placeholder issues. Evidence: `src/features/diagnostics/codeActions.ts`, `src/features/diagnostics/compilerDiagnostics.ts`.

**Missing for demo requirements:**
- No diagnostic for non-PascalCase `#id`, therefore no hover or quick fix for that scenario. Evidence: `src/format/parser/parse.ts`, `src/features/diagnostics/provider.ts`, `src/features/diagnostics/codeActions.ts`.
- No fix-all action (neither `SourceFixAll` nor a custom “Fix all Collie issues”). Evidence: `src/features/diagnostics/codeActions.ts`.

**Smallest viable plumbing to meet demo:**
- Add a PascalCase check when an explicit `#id` is parsed; emit a diagnostic with a code like `COLLIE410` and embed a `data.fix` replacement for the ID span. Suggested implementation points: `src/format/parser/parse.ts` (add diagnostic) or `src/features/diagnostics/provider.ts` (post-parse check using `parsed.ast.id` + `idSpan`).
- Extend `CollieIdCodeActionProvider` to recognize the PascalCase diagnostic code and provide a “Convert to PascalCase” quick fix. Implementation: `src/features/diagnostics/codeActions.ts`.
- Add a fix-all code action that aggregates PascalCase fixes (and optionally existing `data.fix` items) in top-to-bottom order to avoid overlapping edits. Implementation: `src/features/diagnostics/codeActions.ts`.

---

## 5. Formatting (Deep Dive)

- **Formatter registration:** DocumentFormattingEditProvider for `collie` is registered. Evidence: `src/features/formatting/formatProvider.ts`.
- **Implementation:** Formatter parses to AST, prints stable output, and falls back to indentation normalization on failure. Evidence: `src/format/formatter.ts`, `src/format/printer/print.ts`, `src/format/fallback.ts`.
- **Stability:** Printer always reprints full document and appends a trailing newline, which should be stable across repeated formatting. Evidence: `src/format/printer/print.ts`.

**Fix-all strategy:**
- Current formatter does not normalize `#id` casing or other semantic fixes. If you want “Format Document” to act as fix-all, that behavior must be explicitly added (e.g., normalize `#id` casing before print). Evidence: `src/format/formatter.ts`, `src/format/printer/print.ts`.

---

## 6. Tooling/Config Missing UX (Deep Dive)

- **Detection today:** Config discovery resolves `collie.config.*` but does not notify users if it is missing or if packages are absent. Evidence: `src/config/collieConfig.ts`, `src/features/config/discovery.ts`.
- **Messaging:** No actionable prompts or throttling/debouncing logic exists for missing config/tooling. Evidence: `src/features/config/discovery.ts`, `src/config/collieConfig.ts`.

**Minimum improvements for demo resilience:**
- Add a one-time (per workspace/session) warning when `resolveCollieConfigForDocument` cannot find a config, with a call-to-action (e.g., `collie init`). Suggested hook: `src/features/config/discovery.ts` after `resolveCollieConfigForDocument` returns no `configPath`.
- Add lightweight checks for required packages (e.g., `collie` runtime/CLI) using `workspace.findFiles('**/node_modules/<pkg>/package.json', ...)` and show a debounced warning if missing. Suggested hook: command invocations in `src/features/conversion/convertSelectionCommand.ts` and `src/features/conversion/collieExportCommandsImpl.ts`.
- Store a throttle key in `ExtensionContext.globalState` so the warning shows at most once per workspace (or once per day). Suggested location: new helper under `src/features/config/` or `src/features/featureFlags.ts`.

---

## 7. Demo-Ready Minimal Plan (No Over-Engineering)

**Prioritized checklist (smallest scope):**
1) **Convert to Collie end-to-end (E1)**
   - Auto-create `.collie` in same directory with conflict-safe naming (suffix `-1`, `-2`, etc.).
   - Prepend `#id <PascalCaseName>` to the new file.
   - Replace selection in TSX with `<ComponentName />` and insert import at bottom of the import block (dedupe by import source + named import).
   - Add context menu entry for `collie.convertTsxSelectionToCollie` when `editorLangId` is `typescriptreact`/`javascriptreact` and selection is non-empty.
   - Implementation anchors: `src/features/conversion/convertSelectionCommand.ts`, `package.json`.

2) **Diagnostics + quick fixes for PascalCase (E2)**
   - Add diagnostic when `#id` is not PascalCase.
   - Provide quick fix “Convert to PascalCase”.
   - Provide “Fix all Collie issues” code action that batches all PascalCase fixes (and optionally existing `data.fix` edits) in a stable order.
   - Implementation anchors: `src/features/diagnostics/provider.ts`, `src/features/diagnostics/codeActions.ts`, `src/format/parser/parse.ts` (if you place the check in parser).

3) **Format Document reliability (E3)**
   - Keep existing formatter; do not overbuild.
   - Optional: if you prefer “format = fix all,” normalize `#id` casing in the formatter before print.
   - Implementation anchors: `src/format/formatter.ts`.

4) **Convert to TSX (Copy to Clipboard) UX (E4)**
   - Add `editor/context` menu entry for `collie.copyAsTsx` (and optionally `collie.copyAsJsx`).
   - Implementation anchor: `package.json`.

5) **Missing tooling/config UX (E5)**
   - Add one-time warning for missing config + missing packages with actionable guidance, throttled per workspace.
   - Implementation anchors: `src/features/config/discovery.ts`, `src/features/conversion/convertSelectionCommand.ts`.

**Breaking changes to avoid:**
- Do not change existing command IDs in `package.json` or `src/features/conversion/commands.ts`.
- Avoid introducing new activation events beyond existing commands to keep extension cold-start behavior stable.

**Top 5 demo killers + mitigations:**
1) No TSX replacement/import injection after conversion → implement WorkspaceEdit in `src/features/conversion/convertSelectionCommand.ts`.
2) No `#id` PascalCase diagnostic or fix → add diagnostic + quick fix in diagnostics pipeline.
3) Missing context menu entries for conversion/copy → add `editor/context` contributions in `package.json`.
4) Missing config/tooling → add one-time actionable warning when config/packages aren’t found.
5) Conversion produces placeholder expressions for complex JSX and no props extraction → show a single warning toast and keep demo snippets simple (self‑contained selection).

**New command IDs:**
- None required for the minimal plan (reuse existing commands and add context-menu contributions).

