# Priority 1 Plan — Semantic Tokens + Customization UI

Repo: **collie-vscode-extension**
Date: **2025-12-17**
Owner: You (with Codex/Roo Code implementing stages)

---

## Context & Problem

The Collie VS Code language extension currently relies on a TextMate grammar (`syntaxes/collie.tmLanguage.json`) for syntax highlighting, and the runtime extension code is essentially a stub (`src/extension.ts`). TextMate highlighting is pattern-based and can’t reliably encode “meaning” (e.g., *this identifier is a tag name vs a prop field vs a directive keyword*), and it’s not a good foundation for user-friendly customization.

**Priority 1 goal:** ship *semantic tokens* for `.collie` files **plus** a simple, intuitive UX for users to customize Collie token colors/styles via VS Code settings (`editor.semanticTokenColorCustomizations`).

This priority intentionally avoids formatting and diagnostics. Those can be layered on later and will benefit from the semantic token foundation.

---

## Deliverables

### A) Semantic token provider (Collie)
A registered `DocumentSemanticTokensProvider` (and optionally range provider) for language id `collie`, emitting **custom semantic token types** like:

- `collieTag`
- `collieClassShorthand`
- `collieDirective`
- `colliePropsKeyword`
- `colliePropsField`
- `collieInterpolation`
- `colliePipeText`
- `collieComment`

### B) Customization UX (“Customize color for X”)
Commands (available in Command Palette + editor context menu when editing `.collie` files) that:

- Ask the user which token category to customize (or infer from cursor when possible)
- Let the user choose a color/style (QuickPick palette + optional hex input)
- Writes rules into **User** or **Workspace** settings:
  - `editor.semanticTokenColorCustomizations`
  - Specifically: `editor.semanticTokenColorCustomizations.rules`

Example rule shape VS Code supports:

```json
"editor.semanticTokenColorCustomizations": {
  "enabled": true,
  "rules": {
    "collieTag": { "foreground": "#C586C0", "bold": true },
    "collieDirective": { "foreground": "#DCDCAA", "italic": true }
  }
}
```

---

## Non-Goals

- Do **not** implement a formatter here.
- Do **not** implement diagnostics here.
- Do **not** implement a full AST parser integration unless it’s clearly the fastest path.
- Do **not** add tests in this priority (see below).

---

## Do NOT write tests

- Do NOT add unit tests, integration tests, snapshot tests, or harnesses for this priority.
- Focus on shipping working extension behavior with manual verification steps.

---

## Stage 0 — Pre-flight + baseline wiring

### Objective
Confirm the extension builds, runs, and activates reliably, and establish a predictable place to register features.

### Work
1. Add a small internal feature registry pattern so later stages can register providers/commands cleanly.
2. Ensure activation event is correct (`onLanguage:collie` already exists).
3. Add minimal logging helper that can be toggled via setting.

### Files
- `src/extension.ts` (expand)
- `package.json` (add configuration setting for logging; optional)
- `src/features/` (new `index.ts` optional)

### User Pre-Flight Checklist
- `pnpm install`
- `pnpm run build`
- Run the extension via VS Code “Run Extension” launch config (or `F5`).

### Acceptance Checklist
- Opening a `.collie` file triggers activation (verify via Output / console logs).
- No runtime errors in the Extension Host.

---

## Stage 1 — Add semantic tokens scaffolding (legend + registration)

### Objective
Introduce semantic token types/modifiers and register a provider that returns an empty token set (initially), proving the wiring works.

### Work
1. Create `src/features/semanticTokens/legend.ts` defining:
   - `tokenTypes`: the custom Collie token type strings
   - `tokenModifiers`: keep minimal at first (e.g., `declaration`, `readonly`) or empty array
   - Export a `SemanticTokensLegend`
2. Create `src/features/semanticTokens/provider.ts`:
   - Export `registerCollieSemanticTokens(context)`
   - Register `languages.registerDocumentSemanticTokensProvider({ language: 'collie' }, provider, legend)`
   - Provider returns a `SemanticTokens` built from an empty `SemanticTokensBuilder`
3. Update `src/extension.ts` to call `registerCollieSemanticTokens(context)`.

### Files
- `src/features/semanticTokens/legend.ts` (new)
- `src/features/semanticTokens/provider.ts` (new)
- `src/extension.ts` (update)

### Acceptance Checklist
- The provider is registered (confirm via logging/breakpoints).
- No tokenization yet, but VS Code doesn’t error.

---

## Stage 2 — Implement tokenization v1 (line-based scanner)

### Objective
Emit meaningful semantic tokens **without** requiring a full compiler AST w/ spans.

This stage should produce good results quickly and be maintainable:
- A deterministic, line-oriented tokenizer that mirrors the grammar rules already in `syntaxes/collie.tmLanguage.json`
- Tokens are emitted with correct **(line, char, length, tokenType)**

### Token categories and matching rules (v1)

#### 1) Comments → `collieComment`
- `// ...` from `//` to end of line
- `/* ... */` block comments (multi-line)
  - Tokenize the entire comment region as `collieComment` (fine for v1)

#### 2) Props block keyword → `colliePropsKeyword`
- A line that begins a props block keyword (whatever Collie uses; likely `props` based on your grammar’s `propsKeyword`)
- Tokenize just the keyword range

#### 3) Props field names → `colliePropsField`
Inside a props block:
- Tokenize the field identifier on lines like:
  - `title: string`
  - `title?: string`
- Tokenize only the field name (not the `?`, not the type)

#### 4) Directives → `collieDirective`
- Match `@if`, `@elseIf`, `@else` (per grammar)
- Tokenize the directive keyword including `@` prefix

#### 5) Tag names → `collieTag`
For element lines:
- Match the leading tag identifier: `^\s*([A-Za-z][\w-]*)`
- Tokenize the tag name only

#### 6) Class shorthand → `collieClassShorthand`
On element head segments:
- Tokenize `.className` occurrences
- Only the class identifier portion is fine (v1 can include the dot or exclude it, but be consistent)

#### 7) Interpolation → `collieInterpolation`
- Match `#Ellipsis` or `Ellipsis` depending on Collie’s interpolation syntax (your grammar has an `interpolation` repository; mirror it)
- Tokenize the braces (optional) + the inner expression as one token (v1)

#### 8) Pipe text → `colliePipeText`
- Lines starting with `|` are “pipe text” per grammar
- Tokenize from `|` to end of line as `colliePipeText` (or exclude the `|` if desired)

### Implementation approach
1. Create `src/features/semanticTokens/tokenize.ts`
   - Expose `tokenizeCollieSemanticTokens(text: string): Token[]`
   - `Token` should be a simple structure: `{ line, char, length, type }`
2. Implement a small state machine:
   - Track whether inside block comment
   - Track whether inside props block (based on indentation level / props header)
3. Build tokens using `vscode.SemanticTokensBuilder`
   - Sort tokens by position (line, char) before pushing
4. Update provider to:
   - Read document text
   - Tokenize
   - Build and return tokens

### Files
- `src/features/semanticTokens/tokenize.ts` (new)
- `src/features/semanticTokens/provider.ts` (update)

### User Pre-Flight Checklist
- Keep `syntaxes/collie.tmLanguage.json` open while implementing regex rules.

### Acceptance Checklist
- Open a `.collie` file and visually verify:
  - Tag names are consistently colored (semantic tokens overriding/augmenting TextMate)
  - Directives are colored distinctly
  - Props field names are colored distinctly
  - Comments are colored as a block/line comment
  - Pipe text is colored consistently
- Performance: typing in a `.collie` file does not feel laggy.

🚩 If semantic tokens appear “not applying,” confirm:
- The active theme supports semantic highlighting
- `editor.semanticHighlighting.enabled` isn’t disabling them globally

---

## Stage 3 — Improve correctness + performance (incremental polish)

### Objective
Avoid flicker, reduce recomputation, and handle large files gracefully.

### Work
1. Cache tokens per document version
   - Key: `document.uri.toString()` + `document.version`
2. Implement `DocumentRangeSemanticTokensProvider` (optional but recommended)
   - For large docs, VS Code may request ranges; range provider can reuse full tokens and filter by line range in v1
3. Tighten ambiguous regex rules
   - Ensure tag matching ignores lines that are clearly not element heads (e.g., props lines)
   - Ensure directive matching doesn’t trigger inside comments / pipe text
4. Add a setting:
   - `collie.semanticTokens.enabled` (default `true`)
   - When false, provider returns empty tokens

### Files
- `src/features/semanticTokens/provider.ts` (update)
- `package.json` (add `contributes.configuration`)
- `README.md` (document setting)

### Acceptance Checklist
- Semantic tokens can be toggled on/off via setting.
- Large `.collie` files still feel responsive.
- No obvious “wrong category” coloring for common constructs.

---

## Stage 4 — Customization UI v1 (write semanticTokenColorCustomizations)

### Objective
Let a user choose a Collie token category and apply a color/style rule into settings.

### Commands to add
- `collie.customizeTokenColor` — generic entry point
- Convenience commands (optional but matches v2 plan):
  - `collie.customizeTagColor`
  - `collie.customizeDirectiveColor`
  - `collie.customizePropsFieldColor`
  - `collie.customizeClassShorthandColor`
  - `collie.resetTokenCustomization` (remove rule)

### UX requirements (v1)
1. Ask target scope:
   - Workspace (`ConfigurationTarget.Workspace`)
   - User (`ConfigurationTarget.Global`)
2. Ask which token category (unless command is specific)
3. Ask for style:
   - QuickPick palette of common colors (name + hex)
   - Option “Custom hex…” → input box (validate `#RRGGBB` / `#RGB`)
   - Optional toggles: bold / italic / underline (QuickPick multi-select)
4. Write into:
   - `editor.semanticTokenColorCustomizations.rules[<tokenType>] = { foreground, bold, italic, underline }`
5. Support “Reset”:
   - Remove the rule for that token type; if rules becomes empty, keep object minimal

### Implementation details
- Create `src/features/customization/settingsWriter.ts`
  - Read existing `editor.semanticTokenColorCustomizations`
  - Normalize it to an object with `rules`
  - Patch updates immutably
  - `workspace.getConfiguration('editor').update('semanticTokenColorCustomizations', next, target)`
- Create `src/features/customization/ui.ts`
  - All UI prompts in one place (QuickPick + InputBox)
- Register commands in `src/extension.ts` and contribute in `package.json`

### Context menu
Add to `package.json`:

- `contributes.menus.editor/context` entries
- `when`: `editorLangId == collie`

### Files
- `src/features/customization/settingsWriter.ts` (new)
- `src/features/customization/ui.ts` (new)
- `src/features/customization/commands.ts` (new)
- `src/extension.ts` (register commands)
- `package.json` (contributes.commands + contributes.menus + contributes.configuration)
- `README.md` (how to use)

### User Pre-Flight Checklist
- Open a Collie file in VS Code.
- Ensure you have write access to workspace `.vscode/settings.json` if choosing workspace scope.

### Acceptance Checklist
- “Collie: Customize…” appears in:
  - Command palette
  - Right-click context menu in `.collie` editor
- Selecting a token category + color updates:
  - User settings or workspace settings as chosen
- Changes apply immediately (no reload required).

---

## Stage 5 — Cursor-aware customization (nice UX, still Priority 1)

### Objective
Make customization feel “magical”:
- If cursor is on a tag name, default to `collieTag`, etc.

### Approach (pragmatic v1)
1. In the customization command, inspect:
   - Current editor selection active position
   - Current line text
2. Use simple heuristics to infer category:
   - If line matches directive regex near cursor → directive
   - If cursor is within leading tag identifier range → tag
   - If cursor is within `.class` shorthand segment → class shorthand
   - If inside props block and within field identifier → props field
3. If inferred, preselect that category in the QuickPick (or skip the category picker)

### Files
- `src/features/customization/commands.ts` (update)

### Acceptance Checklist
- Right-click on a tag name → customization defaults to Tag.
- Right-click on `@if` → defaults to Directive.
- Still possible to override and choose a different category.

---

## Stage 6 — Documentation + shareability polish

### Objective
Make it easy for users to understand + share highlight schemes.

### Work
1. `README.md` additions:
   - What semantic tokens are (brief)
   - List of Collie token types and what they map to
   - Example settings snippet
   - How to reset/remove
2. Add a command (optional, but very useful):
   - `collie.copyTokenCustomizationSnippet`
   - Copies current Collie-related `rules` subset to clipboard
3. Update `CHANGELOG.md`

### Files
- `README.md`
- `CHANGELOG.md`
- `src/features/customization/commands.ts` (optional)

### Acceptance Checklist
- README includes copy-pastable snippets.
- Users can share `.vscode/settings.json` in a repo and get consistent highlighting.

---

## Implementation Notes (opinionated)

- Start with a **regex + state-machine tokenizer**. Don’t block Priority 1 on adding spans into the core compiler AST.
- Keep token types **Collie-specific** (e.g., `collieTag`) so customization is intuitive and doesn’t conflict with other languages.
- Keep extension code small and boring:
  - `features/semanticTokens/*` does tokenization + provider
  - `features/customization/*` does UI + settings writes
  - `extension.ts` only wires registrations
