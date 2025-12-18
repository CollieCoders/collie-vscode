# Collie VS Code Extension — Priority 4B Plan
File: `priority-4B-plan.md`

## Context & Problem
Priority 4A allows developers to *enter* Collie safely by converting existing JSX/TSX into `.collie`.
Priority 4B completes the trust loop by providing an **escape hatch**.

This feature answers the unspoken question:
“If something goes wrong, can I get back to JSX?”

Priority 4B delivers a **non-destructive, best-effort export**:
**`.collie` file → JSX/TSX snippet**

This is not a compiler replacement. It is a confidence tool.

---

## ✅ Priority 4B Goals
### What we will deliver (MVP)
1. VS Code commands:
   - **“Collie: Copy as JSX”**
   - **“Collie: Copy as TSX”**
2. Conversion from `.collie` AST → JSX/TSX string
3. Output modes:
   - Copy to clipboard (primary)
   - Open preview in an untitled editor (secondary)
4. Readable, idiomatic JSX output
5. Explicit handling of Collie-only constructs

### Non-goals
- No semantic equivalence guarantees
- No file overwrites
- No automatic refactors
- No full TypeScript typing

---

## 🚩 Guardrails
### Do NOT write tests
Do not add automated tests unless explicitly requested later.

### Safety principles
- Never mutate `.collie` files
- Always produce output
- Prefer explicit JSX comments over silent drops

---

## Architecture Overview
This feature reuses prior work:

Pipeline:
```
.collie file
  → Collie AST
    → Shared IR
      → JSX/TSX Printer
```

Suggested structure:
```
src/convert/
  collie/astToIr.ts
  ir/nodes.ts
  tsx/print.ts
```

---

## Stage 0 — Command Scaffolding
### Objective
Expose user-facing commands and verify wiring.

### Implementation Steps
1. Register commands:
   - `collie.copyAsJsx`
   - `collie.copyAsTsx`
2. Ensure active editor language is `collie`
3. Read full document text and log it (temporary)

### User Acceptance Checklist
- Commands appear in Command Palette
- Friendly error if no `.collie` file is active

---

## Stage 1 — Parse `.collie` into AST
### Objective
Reuse the existing Collie parser.

### Implementation Steps
1. Import vendored parser (Priority 2)
2. Parse document into AST
3. If parsing fails:
   - Output JSX comment explaining failure

### User Acceptance Checklist
- Valid `.collie` parses cleanly
- Invalid files still export safely

---

## Stage 2 — Convert Collie AST → IR
### Objective
Translate Collie constructs into the shared IR.

### Conversion Rules
- Elements → `IrElement`
- Classes → `className`
- `|` text → JSX text
- `{{ expr }}` → `{expr}`

#### Conditionals
- `@if (cond)` → `{cond && ( ... )}`
- `@else` chains → nested ternary or explicit blocks

### Implementation Steps
1. Walk Collie AST
2. Preserve original expression text
3. Emit IR nodes only

### User Acceptance Checklist
- IR accurately represents structure
- No JSX logic leaks into this stage

---

## Stage 3 — Print IR → JSX
### Objective
Generate valid, readable JSX.

### Printing Rules
- Use fragments when needed
- Emit `className`
- Keep indentation consistent (2 spaces)
- Prefer readability over minimal output

### Implementation Steps
1. Implement JSX printer
2. Validate output parses in a React project

### User Acceptance Checklist
- JSX pastes cleanly into editor
- Output is stable and readable

---

## Stage 4 — TSX Variant
### Objective
Support TSX output explicitly.

### Differences
- Conservative typing
- Optional `Props` stub (future)
- Avoid aggressive `any`

### Implementation Steps
1. Branch behavior by command
2. Keep TSX simple and safe

### User Acceptance Checklist
- TSX compiles in strict projects

---

## Stage 5 — Clipboard & Preview
### Objective
Deliver output safely.

### Implementation Steps
1. Copy output to clipboard
2. Optionally open preview editor
3. Show confirmation toast

### User Acceptance Checklist
- Clipboard contains JSX/TSX
- Preview opens correctly

---

## Stage 6 — Graceful Degradation
### Objective
Never fail silently.

### Examples
- Unsupported directive → JSX comment
- Unknown syntax → JSX comment

### User Acceptance Checklist
- Users can see what was skipped

---

## Stage 7 — Docs
### Objective
Document escape hatch clearly.

### Implementation Steps
1. README section
2. Command descriptions emphasize safety

### User Acceptance Checklist
- Docs set correct expectations

---

## Recommended Agent Prompt
“Proceed with Stage X of `priority-4B-plan.md`.
Do NOT write tests.
Verify by exporting a real `.collie` file to JSX and TSX.”
