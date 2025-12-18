# Collie VS Code Extension — Priority 3 Plan
File: `priority-3-plan.md`

## Context & Problem
With Priority 1 (semantic tokens) and Priority 2 (formatting) implemented, `.collie` files now *look* and *behave* like a real language. The next step is to make them **feel intelligent while editing**.

Priority 3 focuses on **language ergonomics**:
- Catching obvious mistakes early
- Helping users navigate and refactor
- Providing lightweight IntelliSense without overpromising

This priority intentionally avoids “hard” semantic guarantees. Everything here should be **best‑effort, non-blocking, and fast**.

---

## ✅ Priority 3 Goals
### What we will deliver
1. **Diagnostics (Problems panel)**
   - Indentation errors
   - Invalid or unknown directives
   - Duplicate props
   - Obvious malformed selectors
2. **Go to Definition**
   - From component usage → component declaration (local project only)
3. **Hover information**
   - For directives (`@if`, `@else`, `props`)
   - For inline expressions (`{{ ... }}`)
4. **Basic completion**
   - Directives
   - Common tags
   - Known local components
5. **Document symbols**
   - Outline view support for `.collie` files

### Non-goals for Priority 3
- No type-checking of expressions
- No Angular-specific semantics
- No cross-framework inference
- No “smart refactors” yet

---

## 🚩 Guardrails
### Do NOT write tests
Do not add automated tests unless explicitly requested later.

### Performance constraints
- All features must run under **~10–15ms** per keystroke on medium files.
- Prefer cached results and incremental updates.
- Avoid re-parsing the entire project unnecessarily.

---

## Architecture Overview
All Priority 3 features should be driven by the **same AST** introduced in Priority 2.

High-level structure:
- Parser → AST
- AST reused by:
  - diagnostics
  - hover
  - symbols
  - completion
  - navigation

This avoids duplicate logic and keeps behavior consistent.

---

## Stage 0 — Baseline & Feature Flags
### Objective
Prepare the extension to safely add language features behind toggles.

### Implementation Steps
1. Add a new folder:
   - `src/lang/`
2. Define a shared interface:
   - `ParsedDocument { ast, diagnostics?, version }`
3. Add a simple feature flag system:
   - `collie.features.diagnostics`
   - `collie.features.completions`
   - `collie.features.navigation`

### User Pre-Flight Checklist
- Ensure Priority 1 & 2 branches are merged.
- Extension builds cleanly.

### User Acceptance Checklist
- Settings appear but features are not active yet.

---

## Stage 1 — Diagnostics Provider
### Objective
Surface obvious errors in the Problems panel without blocking editing.

### Diagnostics to implement (MVP)
1. **Indentation errors**
   - Mixed tabs/spaces
   - Indent jumps > 1 level
2. **Unknown directives**
   - Anything starting with `@` not in:
     - `@if`
     - `@elseIf`
     - `@else`
3. **Duplicate props**
   - Same prop name defined twice in a `props` block
4. **Malformed selectors**
   - Empty class segments (`div..foo`)
   - Invalid characters in class names

### Implementation Steps
1. Register `languages.createDiagnosticCollection('collie')`
2. On document change:
   - Parse AST
   - Walk nodes and collect diagnostics
3. Map diagnostics to VS Code `Range`
4. Clear diagnostics on document close

### User Acceptance Checklist
- Errors appear in Problems panel
- Squiggles update as file changes
- No crashes on invalid syntax

---

## Stage 2 — Document Symbols (Outline View)
### Objective
Enable quick navigation within `.collie` files.

### Symbols to expose
- Top-level elements
- Component root element
- `props` block
- Conditional blocks

### Implementation Steps
1. Register `DocumentSymbolProvider`
2. Walk AST and emit:
   - `SymbolKind.Module` for root
   - `SymbolKind.Field` for props
   - `SymbolKind.Class` or `SymbolKind.Function` for major blocks
3. Preserve nesting hierarchy

### User Acceptance Checklist
- Outline view shows meaningful structure
- Clicking symbols jumps to correct lines

---

## Stage 3 — Hover Provider
### Objective
Provide lightweight context without overwhelming users.

### Hover targets
1. **Directives**
   - `@if` → description + syntax example
   - `@elseIf`, `@else`
2. **Props**
   - Show prop name + type
3. **Inline expressions**
   - Show “Collie expression (evaluated in component scope)”

### Implementation Steps
1. Register `HoverProvider`
2. On hover:
   - Identify node at position using AST spans
   - Return markdown hover content
3. Cache AST per document version

### User Acceptance Checklist
- Hover tooltips appear instantly
- Content is concise and readable

---

## Stage 4 — Completion Provider
### Objective
Reduce typing friction while avoiding “noisy” IntelliSense.

### Completion types
1. **Directives**
   - `@if`
   - `@elseIf`
   - `@else`
2. **Common tags**
   - `div`, `span`, `section`, `header`, etc.
3. **Local components**
   - Based on imports or nearby files (simple heuristic)

### Implementation Steps
1. Register `CompletionItemProvider`
2. Trigger on:
   - `@`
   - start of line
   - `.`
3. Use AST + simple filesystem scan (same folder only for MVP)

### User Acceptance Checklist
- Suggestions feel helpful, not spammy
- No noticeable typing lag

---

## Stage 5 — Go to Definition (Local Components)
### Objective
Enable navigation from component usage to its definition.

### Scope (MVP)
- Same workspace only
- Same folder or sibling folders
- `.collie` → `.collie` or `.tsx` component files

### Implementation Steps
1. Register `DefinitionProvider`
2. When cursor is on a component tag:
   - Resolve file path heuristically
   - Open target document
3. Cache lookup results per workspace

### User Acceptance Checklist
- Cmd/Ctrl+Click navigates correctly
- Graceful failure when definition not found

---

## Stage 6 — Performance & Caching Pass
### Objective
Ensure all language features feel instantaneous.

### Implementation Steps
1. Introduce per-document cache keyed by:
   - URI
   - version
2. Avoid re-parsing unchanged documents
3. Throttle expensive operations on rapid typing

### User Acceptance Checklist
- No UI jank
- CPU usage remains low on large files

---

## Stage 7 — Docs & Discoverability
### Objective
Make features visible and understandable.

### Implementation Steps
1. Update README:
   - List supported language features
   - Explain limitations
2. Add screenshots or GIFs (optional)
3. Mention feature flags

### User Acceptance Checklist
- README accurately reflects behavior
- Users know what Collie *does* and *does not* do yet

---

## Recommended Agent Prompt
Use this exact structure when delegating:

“Proceed with Stage X of `priority-3-plan.md`.
Do NOT write tests.
Confirm behavior manually in the Extension Development Host.”
