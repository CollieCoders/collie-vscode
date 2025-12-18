# Collie VS Code Extension — Priority 4A Plan
File: `priority-4A-plan.md`

## Context & Problem
Collie already lowers cognitive load when *writing* components, but adoption friction remains high in existing React codebases. The biggest blocker is the “cold start” problem:

> Developers already have JSX/TSX components. Rewriting them into Collie by hand is risky, slow, and intimidating.

Priority 4A solves this by enabling:
**JSX/TSX selection → `.collie` file generation**

This feature lets developers:
- Convert *existing* React components incrementally
- Experiment with Collie without committing to a rewrite
- Trust that Collie can represent real-world JSX, even if imperfectly

This plan is explicitly **best-effort and lossy by design**. The goal is acceleration and confidence — not perfect semantic equivalence.

---

## ✅ Priority 4A Goals
### What we will deliver (MVP)
1. A VS Code command:
   - **“Collie: Convert JSX/TSX Selection to Collie”**
2. Selection-based conversion:
   - User selects JSX/TSX code
   - Command generates valid `.collie` output
3. Output options:
   - Insert into a new `.collie` file
   - Or copy to clipboard (fallback)
4. Predictable, readable Collie output
5. Graceful degradation for unsupported JSX patterns

### Non-goals
- No full React semantic parity
- No runtime correctness guarantees
- No automatic replacement of TSX files
- No attempt to infer hooks, state, or effects

---

## 🚩 Guardrails
### Do NOT write tests
Do not add automated tests unless explicitly requested later.

### Safety principles
- Never mutate the original TSX file automatically
- Never throw on unsupported syntax — always emit *something*
- Prefer explicit placeholders over silent omission

---

## Architectural Overview
This feature introduces a **TSX → Intermediate Representation (IR) → Collie** pipeline.

### Key principle
**Do not generate Collie directly from raw TSX strings.**

Instead:
1. Parse TSX with the TypeScript compiler API
2. Convert JSX nodes into a simplified, Collie-oriented IR
3. Print Collie from that IR using a dedicated printer

This IR will later be reused for Priority 4B (Collie → TSX).

Suggested folder:
```
src/convert/
  tsx/
    parse.ts
    jsxToIr.ts
  ir/
    nodes.ts
  collie/
    print.ts
```

---

## Stage 0 — Baseline & Command Scaffolding
### Objective
Create the VS Code command and verify selection plumbing.

### Implementation Steps
1. Register a new command:
   - `collie.convertTsxSelectionToCollie`
2. Command behavior:
   - Ensure active editor language is `typescriptreact` or `javascriptreact`
   - Ensure a non-empty selection exists
   - Read selected text
3. Temporary behavior:
   - Log selected text to OutputChannel (no conversion yet)

### User Acceptance Checklist
- Command appears in Command Palette
- Running command with a JSX selection logs the selection
- Friendly error messages for invalid context

---

## Stage 1 — Parse TSX Selection into a TypeScript AST
### Objective
Safely parse JSX/TSX code fragments.

### Implementation Steps
1. Add `typescript` as a dependency (if not already)
2. Create a wrapper source file:
   - Wrap selection in a dummy component if needed:
     ```ts
     const __CollieTemp = () => (
       /* selection */
     )
     ```
3. Use:
   - `ts.createSourceFile(..., ScriptKind.TSX)`
4. Extract JSX root nodes:
   - `JsxElement`
   - `JsxSelfClosingElement`
   - `JsxFragment`
   - `JsxText`
   - `JsxExpression`

### User Acceptance Checklist
- Valid JSX selections parse without crashing
- Invalid JSX produces a friendly error

---

## Stage 2 — Define the Intermediate Representation (IR)
### Objective
Create a simplified, Collie-friendly tree structure.

### IR Node Types (MVP)
- `IrElement`
  - `tagName`
  - `classes: string[]`
  - `props: IrProp[]`
  - `children: IrNode[]`
- `IrText`
  - `value`
- `IrExpression`
  - `expressionText`
- `IrFragment`
  - `children`

### Implementation Steps
1. Add `src/convert/ir/nodes.ts`
2. Keep IR deliberately small and lossy
3. Normalize:
   - `className` → `classes[]`
   - boolean props → presence-only

### User Acceptance Checklist
- IR types compile cleanly
- No JSX-specific types leak into Collie printer

---

## Stage 3 — Convert JSX AST → IR
### Objective
Translate JSX syntax into IR nodes.

### Conversion Rules (MVP)
#### Elements
- `<div className="a b">` → `IrElement(tagName='div', classes=['a','b'])`
- Self-closing tags produce empty children arrays

#### Props
- `foo="x"` → `IrProp(name='foo', value='"x"')`
- `foo={bar}` → `IrProp(name='foo', value='{bar}')`
- `{...props}` → `IrExpression('{...props}')` placeholder

#### Children
- JSX text → `IrText`
- `{expr}` → `IrExpression`
- Nested elements recurse

#### Fragments
- `<></>` → `IrFragment`

### Implementation Steps
1. Implement `jsxNodeToIr(node)`
2. Preserve source text for expressions using `node.getText()`
3. Strip insignificant whitespace from JSX text nodes

### User Acceptance Checklist
- Console-log IR for a sample JSX selection looks structurally correct

---

## Stage 4 — Print IR → Collie
### Objective
Generate readable `.collie` syntax from IR.

### Printing Rules (MVP)
- Elements:
  - `div.class1.class2`
- Props:
  - emitted as `prop={expr}` inline if present
- Text:
  - inline if single text child
  - otherwise standalone `|` lines
- Expressions:
  - emitted as `{{ expression }}` or `| {{ expression }}` depending on position
- Fragments:
  - either unwrap children
  - or emit a synthetic `fragment` root

### Implementation Steps
1. Add `src/convert/collie/print.ts`
2. Reuse indentation rules from formatter (Priority 2)
3. Ensure output is always valid Collie

### User Acceptance Checklist
- Generated Collie is readable and stable
- Output respects indentation and structure

---

## Stage 5 — Command Output & File Creation
### Objective
Deliver generated Collie to the user.

### Output Strategy
1. If selection originates in a file with a clear component name:
   - Suggest `ComponentName.collie`
2. Otherwise:
   - Copy to clipboard
   - Show preview in untitled editor

### Implementation Steps
1. Prompt user:
   - “Create new .collie file?” (Yes / Copy to Clipboard)
2. Create file and open editor if confirmed
3. Never overwrite existing files silently

### User Acceptance Checklist
- Users control where output goes
- No accidental overwrites

---

## Stage 6 — Graceful Degradation & Placeholders
### Objective
Handle unsupported patterns explicitly.

### Examples
- `.map()` → `{{ items.map(...) }}`
- ternary → `{{ condition ? ... : ... }}`
- logical AND → `{{ condition && ... }}`

### Implementation Steps
1. Detect unsupported JSX patterns
2. Emit expression placeholders instead of failing
3. Optionally annotate with a Collie comment (if supported)

### User Acceptance Checklist
- Complex JSX still converts
- No silent data loss

---

## Stage 7 — Docs & UX Polish
### Objective
Make the feature discoverable and trustworthy.

### Implementation Steps
1. README section:
   - “Convert JSX to Collie”
   - What’s supported vs best-effort
2. Command Palette description text
3. Optional walkthrough GIF

### User Acceptance Checklist
- Users understand expectations
- Feature feels powerful but honest

---

## Recommended Agent Prompt
Use exactly this structure:

“Proceed with Stage X of `priority-4A-plan.md`.
Do NOT write tests.
After implementation, manually verify by converting a real TSX component into Collie.”
