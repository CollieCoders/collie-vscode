# Collie VS Code Extension — Priority 2 Plan
File: `priority-2-plan.md`

## Context & Problem
Collie’s language extension currently provides basic TextMate highlighting for `.collie` files, but it does **not** provide reliable formatting. Because Collie is indentation-based, formatting is a “trust” feature: it makes `.collie` feel like a real language, prevents accidental indentation drift, and enables fast editing loops (especially when paired with format-on-save).

Priority 2 is to add **deterministic, safe, and configurable** formatting for `.collie` files via VS Code’s formatting APIs.

This plan is written so you can tell an agent:
> “Proceed with Stage X of `priority-2-plan.md`”
…and it can implement that stage end-to-end.

---

## ✅ Priority 2 Goals
### What we will deliver
1. **Document formatting** for `.collie` via `DocumentFormattingEditProvider`
2. A **Collie formatter engine** that:
   - Produces consistent indentation (default **2 spaces**)
   - Normalizes obvious whitespace (trailing whitespace, extra spaces)
   - Formats common Collie constructs:
     - Element lines with tag + class shorthands (`div.welcome`, `div .welcome`)
     - Inline text (`| ...`) on element lines and stand-alone text lines
     - `props` block + `name?: Type` lines
     - Conditionals (`@if (...)`, `@elseIf (...)`, `@else`) including inline bodies
3. Optional (but recommended) **formatter configuration** exposed as VS Code settings
4. “Safe by default”: the formatter should **not change meaning** (nesting, inline text content, expressions).

### Non-goals for Priority 2
- No Angular-specific formatting (that’s later)
- No “format selection/range” (nice-to-have; not required for MVP)
- No Prettier plugin in this priority (formatting stays inside the extension)

---

## 🚩 Guardrails (important)
### Do NOT write tests
For this priority, **do not add automated tests** unless the user explicitly asks later.

### Formatting safety rules
The formatter must:
- Preserve line ordering
- Preserve semantics of indentation-based hierarchy
- Preserve text payloads exactly (especially after `|` and inside `{{ ... }}`)
- Avoid “smart rewrites” that might surprise users

---

## Approach Recommendation
**AST-driven formatting** is the most reliable option for an indentation-based language.

Because the language extension is currently standalone and doesn’t depend on the core compiler package, the safest MVP is to **vendor** (copy) the minimal parser + AST types needed from the `@collie-lang/compiler` package into the extension.

Why this approach:
- It ensures we can reconstruct the correct hierarchy even if a file has messy indentation
- It avoids trying to “infer structure” from raw whitespace heuristics
- It keeps formatting consistent with the language’s real parser rules

We will vendor:
- `ast.ts` (or equivalent node/type definitions)
- The parser logic needed to build a simple AST (plus minimal diagnostics support if required)
- A new **printer** that converts AST → formatted text

---

## Stage 0 — Readiness & Baseline
### Objective
Establish the current state, identify the exact parser files to vendor, and decide on the minimal node set needed for formatting.

### Implementation Steps
1. In the Collie core repo zip (`collie-core-code.zip`), locate:
   - `packages/compiler/src/parser.ts`
   - `packages/compiler/src/ast.ts` (or the AST type file(s))
   - any dependencies required to run the parser (diagnostics helpers, spans)
2. In the VS Code extension repo zip (`collie-vscode-extension.zip`), confirm:
   - language id is `collie`
   - `.collie` is registered under `contributes.languages`
3. Create a new folder in the extension:
   - `src/format/`
   - `src/format/parser/` (vendored parser)
   - `src/format/printer/` (new printer)

### User Pre-Flight Checklist
- Ensure the working tree is clean.
- Make sure you can build the extension (`pnpm install`, `pnpm build` or the existing scripts).

### User Acceptance Checklist
- None (this stage is setup only).

---

## Stage 1 — Vendor a Minimal Parser Subset into the Extension
### Objective
Bring in a minimal, dependency-light parser that can parse a `.collie` document into an AST suitable for printing.

### Design Constraints
- Keep the vendored code small and self-contained.
- If core parser pulls in diagnostics/spans, either:
  - vendor those small helpers too, or
  - simplify diagnostics to a lightweight structure (formatter can ignore diagnostics).

### Implementation Steps
1. Add `src/format/parser/ast.ts`
   - Copy the node types used by the parser: `RootNode`, `ElementNode`, `TextNode`, conditional nodes, props nodes.
2. Add `src/format/parser/parse.ts`
   - Copy `parse()` logic from core parser with minimal edits:
     - adjust imports to local files
     - remove anything not needed for formatting output
3. Ensure the parser returns:
   - `root: RootNode`
   - optional `diagnostics` (ignored by formatter for now, but useful for future)

### Notes
- Formatting should still work even if diagnostics exist. If parsing fails hard, we’ll fallback (Stage 4).

### User Pre-Flight Checklist
- Verify TypeScript builds locally before starting.
- If the extension uses bundling (esbuild), confirm it includes new files under `src/`.

### User Acceptance Checklist
- Running `pnpm build` succeeds.
- You can import the vendored parser from another file with no runtime errors.

---

## Stage 2 — Implement a Deterministic Printer (AST → Text)
### Objective
Create a printer that converts the parsed AST into formatted `.collie` text.

### Formatting Rules (MVP defaults)
#### Indentation
- Default indent = **2 spaces**
- Indent level is derived from AST nesting (not original whitespace)

#### Element lines
- Prefer compact selector chaining:
  - `div.welcome.big` (no spaces)
- If the input was `div .welcome`, printer should output `div.welcome`
- Inline text:
  - `h3 | Hello` (exactly one space before and after `|`)
- If element has no inline text, it prints just the selector line.

#### Standalone text lines
- Always start with `|`:
  - `| Some text`
- Preserve text exactly after the first `|` + one space.

#### Props block
- Header:
  - `props`
- Fields:
  - `name: Type`
  - `name?: Type`
- Normalize spacing:
  - no space before `?`
  - exactly one space after `:`

#### Conditionals
- `@if (cond)` / `@elseIf (cond)` / `@else`
- Normalize spacing:
  - exactly one space after directive keyword
  - parentheses required for `@if` and `@elseIf`
- Inline body:
  - If inline node exists, print it on the same line after a single space.
    - Example: `@if (x) div.thing`
    - Example: `@else | fallback`

### Implementation Steps
1. Add `src/format/printer/print.ts` exporting:
   - `print(root: RootNode, options: PrintOptions): string`
2. Implement helper functions:
   - `printNode(node, indentLevel)`
   - `printElement(node, indentLevel)`
   - `printText(node, indentLevel)`
   - `printProps(root.props, indentLevel)`
   - `printConditional(chain, indentLevel)`
3. Ensure output ends with a single trailing newline.

### User Pre-Flight Checklist
- None beyond Stage 1.

### User Acceptance Checklist
- Create a scratch `.collie` file with messy whitespace and confirm `print(parse(file))` outputs stable, consistent formatting (can be done via a temporary command or node script during development).

---

## Stage 3 — Wire Formatting into VS Code
### Objective
Register a formatter for `.collie` using VS Code APIs.

### Implementation Steps
1. Update `src/extension.ts`:
   - Register a `DocumentFormattingEditProvider` for language `collie`
   - In `provideDocumentFormattingEdits`:
     - Read full document text
     - Parse → print
     - Return a single `TextEdit.replace(fullRange, formatted)`
2. Handle errors:
   - If parsing throws, return `[]` edits (do nothing) and optionally `console.warn(...)`

### User Pre-Flight Checklist
- Run the extension in the Extension Development Host.

### User Acceptance Checklist
- In a `.collie` file, run “Format Document” and see:
  - indentation normalized
  - trailing whitespace removed
  - selector lines normalized
  - `props` + conditionals formatted as specified

---

## Stage 4 — Add Safe Fallback Formatter (When Parsing Fails)
### Objective
Avoid “Format Document does nothing” on partially-typed or invalid files by providing a conservative fallback.

### Fallback behavior (very conservative)
If the AST parser fails:
- Trim trailing whitespace
- Normalize tabs to spaces (or refuse and do nothing)
- Normalize leading indentation to **the nearest lower multiple** of indent size **without changing relative indentation**
  - (Do not attempt to re-nest lines)

### Implementation Steps
1. Add `src/format/fallback.ts`:
   - `fallbackFormat(text, options): string`
2. In the provider:
   - try AST path
   - catch → fallback path

### User Acceptance Checklist
- Even when a file is mid-edit and invalid, “Format Document” still cleans up whitespace without wrecking nesting.

---

## Stage 5 — Add User-Facing Settings (Optional but Recommended)
### Objective
Expose a small set of formatter options that users can tweak.

### Suggested settings
Under `collie.format`:
- `indentSize` (number, default 2)
- `preferCompactSelectors` (boolean, default true)
- `spaceAroundPipe` (boolean, default true)
- `normalizePropsSpacing` (boolean, default true)

### Implementation Steps
1. Update `package.json` contributes:
   - `contributes.configuration` with the above settings
2. Read config in formatter provider:
   - `workspace.getConfiguration('collie')...`
3. Pass options into printer.

### User Acceptance Checklist
- Settings appear in VS Code UI
- Changing indent size to 4 changes formatted output accordingly

---

## Stage 6 — Docs & “Format on Save” Guidance
### Objective
Make it easy for users to enable formatting behavior.

### Implementation Steps
1. Update `README.md` in the extension repo:
   - How to run “Format Document”
   - Recommended settings snippet for `settings.json`:
     - `editor.defaultFormatter`
     - `editor.formatOnSave`
2. Mention current limitations (no range formatting yet).

### User Acceptance Checklist
- README includes clear setup steps.
- Format-on-save works when enabled.

---

## Recommended Agent Workflow
When you ask an agent to implement a stage, prefer this exact phrasing:

**Prompt Template**
- “Proceed with Stage X of `priority-2-plan.md`.”
- “Do NOT write tests.”
- “After changes, build the extension and confirm formatting works on the sample `.collie` file(s).”
