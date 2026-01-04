# Collie VS Code v5 Plan — Conversion, Writing, and Diagnostics

⚠️ This plan must be implemented in conjunction with `./risk-register.md`.
If there is a conflict, the risk register takes precedence.

> Scope: **`collie-vscode` repo only**
> Focus: **TSX → Collie conversion**, template block writing, and diagnostics alignment
> Explicitly excludes: Collie compiler changes, runtime changes, publishing, release automation

---

## Stage 1 — Remove “Append to Existing Template” from Conversion UX and Code Paths

### Context

Current conversion behavior offers an option that appends converted nodes into an existing `#id` block (or reuses an existing id), which easily produces duplicate rendering and confusing output. We want the default and only behavior to be:

> Every conversion creates a **new template block** (`#id ...`) and rewrites the selected TSX to reference that new id.

No “append” option should remain in the command flow.

---

### Allowed to touch

- `src/features/conversion/convertSelectionCommand.ts`
- `src/features/conversion/collieFileWriter.ts`
- `src/features/conversion/templateId.ts`
- `src/features/conversion/commands.ts`
- `src/features/conversion/imports.ts`

### Must NOT touch (do not open, do not scan)

- `src/features/css/**`
- `src/features/semanticTokens/**`
- `src/features/navigation/**`
- `src/features/symbols/**`
- `src/format/**`
- `src/lang/**`
- `syntaxes/**`
- `assets/**`
- `dist/**`

---

### Required changes

1. Remove any QuickPick options that:

* “Append to existing template”
* “Add to existing id”
* “Reuse existing template id based on matching content” (if it causes implicit reuse without explicit intent)

2. Conversion must always:

* Generate a **new template id** (see Stage 2 details)
* Write a **new template block** to the target `.collie` file
* Replace selection with a `<Collie id="NEW_ID" ... />`

3. Ensure no code path is left that mutates an existing template block’s contents (append/merge).

---

### Acceptance criteria

✅ When converting a second selection in the same TSX file:

* A new `#id` block is added to the `.collie` file
* The TSX selection is replaced with `<Collie id="...new..." />`
* Existing `#id` blocks are **not modified**

❌ The extension must **NO LONGER**:

* Offer an option to append to an existing template block
* Modify existing template node content during conversion
* Produce a TSX file that references the same `id` for two unrelated selections by default

---

## Stage 2 — Deterministic, Collision-Proof Template ID Strategy for Repeated Conversions

### Context

Once “append” is removed, repeated conversions will generate repeated ids. We need a stable, predictable strategy for generating new ids that:

* Is deterministic
* Avoids collisions with existing ids in the `.collie` file
* Works even when converting multiple selections from the same component

---

### Allowed to touch

- `src/features/conversion/templateId.ts`
- `src/lang/templateIndex.ts`
- `src/lang/parseDocument.ts`
- `src/lang/templateIndex.ts`
- `src/features/conversion/convertSelectionCommand.ts`

### Must NOT touch

- `src/convert/**`     (do not open unless Stage 4 requires it)
- `src/features/diagnostics/**`  (later stages)
- `src/features/completions/**`  (later stages)

---

### Required behavior

Given base id derived from file/component scope (e.g. `UserPanel`):

* First conversion: `UserPanel`
* Second conversion: `UserPanel~2`
* Third conversion: `UserPanel~3`

If your existing scheme uses `App.App` style scoping, keep it. The key is:

* **Always generate a new id**
* **Suffix if collision exists**

---

### Acceptance criteria

✅ Converting N selections in a file results in N unique `#id` blocks with unique ids.

❌ The extension must **NO LONGER**:

* Reuse an existing id when the user did not explicitly ask for reuse
* Generate an id that collides with an existing `#id` in the same `.collie` file

---

## Stage 3 — Switch Conversion Output from `props` to `#props` and Enforce Formatting Rules

### Context

The compiler will now treat `props` (without `#`) as invalid / non-directive. The VS Code extension must generate the new syntax and enforce the formatting invariants:

* `#id <name>` then blank line
* optional `#props` then blank line
* optional `#classes` then blank line (if applicable)
* template nodes then trailing newline

Additionally:

* `#props` must be unindented
* prop declarations must be indented exactly one level

---

### Allowed to touch

- `src/features/conversion/collieFileWriter.ts`
- `src/convert/tsx/print.ts`
- `src/convert/collie/print.ts`
- `src/features/conversion/convertSelectionCommand.ts`

### Must NOT touch

- `src/format/**`
- `src/features/formatting/**`
- `src/features/lang/**`

---

### Required behavior (Collie output)

**Valid output must look like:**

```collie
#id UserPanel

#props
  username: string
  loggedIn: boolean

div
  span | {username}
```

**Invalid output that must never be generated:**

```collie
#id UserPanel
props
  username: string
```

or

```collie
#id UserPanel

#props
username: string
```

---

### Acceptance criteria

✅ Any conversion that includes props must generate a `#props` block (not `props`).

✅ `#props` must be placed under the correct `#id` block.

✅ The extension must insert an empty line:

* after `#id`
* after `#props`
* after `#classes` (if present)

❌ The extension must **NO LONGER**:

* emit `props` (non-directive)
* emit `#props` with indentation
* emit prop declarations at the wrong indentation level

---

## Stage 4 — TSX → Collie Conversion for Conditionals Using `@if / @elseIf / @else`

### Context

We want two conversion modes depending on selection granularity:

1. If the user converts **each branch separately**, React retains conditional logic, and each Collie template is branch-only.
2. If the user converts **the entire conditional block**, Collie owns the branching and uses semantic directives (`@if`, `@elseIf`, `@else`).

This stage updates conversion printing to emit Collie conditionals rather than JSX expression wrappers.

---

### Allowed to touch

- `src/convert/tsx/jsxToIr.ts`
- `src/convert/tsx/parseSelection.ts`
- `src/convert/tsx/print.ts`
- `src/convert/ir/nodes.ts`
- `src/features/conversion/convertSelectionCommand.ts`

### Must NOT touch

- `src/features/diagnostics/**`
- `src/features/completions/**`
- `src/features/navigation/**`
- `src/format/**`

---

### Required behavior

#### Case A — Convert each branch separately (React keeps ternary)

**Input TSX (selection is logged-in branch only):**

```tsx
<section className="user-info">
  <h2>Welcome back, {username}</h2>
</section>
```

**Output TSX should look like (simplified):**

```tsx
{loggedIn ? (
  <Collie id="UserPanel.LoggedIn" username={username} />
) : (
  <Collie id="UserPanel.LoggedOut" onLogin={onLogin} />
)}
```

**Collie template for LoggedIn should NOT include `@if loggedIn`.**
It should only contain the selected structure.

---

#### Case B — Convert full conditional block (Collie owns branching)

**Input TSX selection includes the conditional expression:**

```tsx
{loggedIn ? (
  <section className="user-info">...</section>
) : (
  <section className="logged-out">...</section>
)}
```

**Output Collie should be:**

```collie
div.user-panel
  @if loggedIn
    section.user-info
      ...
  @else
    section.logged-out
      ...
```

**Output TSX replaces the entire selection with a single Collie usage:**

```tsx
<Collie id="UserPanel" loggedIn={loggedIn} ... />
```

---

### Acceptance criteria

✅ When selection includes a JSX ternary / conditional expression:

* Collie output uses `@if / @elseIf / @else`

✅ When selection does **not** include the conditional expression itself (branch-only selection):

* Collie output does **not** invent `@if loggedIn`
* React conditional remains in TSX

❌ The extension must **NO LONGER**:

* Emit JSX-style conditional wrappers inside Collie (e.g. `{cond && (...)}`)
* Emit a template id that implies branch-only while including both branches

---

## Stage 5 — Update Prop Inference + TSX Rewrite to Match New Conditional Conversion

### Context

Conditional conversion changes what props must be passed to `<Collie />`.

* Branch-only conversion: the Collie template should only require props used in that branch.
* Full-block conversion: the Collie template should require props used in any branch + the condition variables (e.g. `loggedIn`).

Also: event handler expressions must remain safe and readable:

* Inline handler functions can be generated if needed
* Prefer reusing existing identifiers where possible (`onLogin={onLogin}`)

---

### Allowed to touch

- `src/features/conversion/convertSelectionCommand.ts`
- `src/features/conversion/imports.ts`
- `src/convert/tsx/jsxToIr.ts`
- `src/convert/tsx/print.ts`

### Must NOT touch

- `src/features/diagnostics/**`
- `src/format/**`
- `src/lang/**`

---

### Acceptance criteria

✅ Full-block conditional conversion emits a single `<Collie id="UserPanel" ... />` with:

* `loggedIn={loggedIn}`
* any other referenced identifiers passed through
* any needed closures (e.g. toggle handlers) preserved

✅ Branch-only conversion emits `<Collie id="UserPanel.LoggedOut" ... />` without unrelated props

❌ The extension must **NO LONGER**:

* Add props to TSX that are not needed by that template
* Omit condition variables (e.g. `loggedIn`) when they appear in `@if` conditions inside the template

---

## Stage 6 — Align Extension Diagnostics with New `#props` Semantics (Stop False Positives)

### Context

After switching to `#props`, existing diagnostics that look for `props` blocks or enforce “props must come before nodes” will produce false errors/warnings.

We need to update extension-side diagnostics so they align with the new compiler rules:

* `#props` is the only valid directive
* It can appear anywhere within a template block
* Prop usage checks must respect `#props` parsing

---

### Allowed to touch

- `src/features/diagnostics/tsPropsDiagnostics.ts`
- `src/features/diagnostics/compilerDiagnostics.ts`
- `src/features/diagnostics/provider.ts`
- `src/lang/parseDocument.ts`
- `src/lang/templateIndex.ts`

### Must NOT touch

- `src/features/css/**`
- `src/features/navigation/**`
- `src/format/**`
- `src/convert/**`

---

### Acceptance criteria

✅ No false error:

* “Props block must appear before any template nodes.”

✅ No false error:

* “Indentation jumped more than one level.” (for valid `#props` + indented props)

✅ No false warning:

* “Prop X is used but not declared” when X is declared in `#props`

❌ The extension must **NO LONGER**:

* Look for a `props` keyword block
* Enforce legacy props ordering rules

---

## Stage 7 — Conversion Formatting Guarantees (Spacing + No Sandwiching)

### Context

We want the conversion pipeline to always produce readable Collie output:

* consistent blank lines between sections and templates
* no accidental “sandwiching”
* stable end-of-file newlines

This stage is about strict output formatting *from conversion/writer*, not the general formatter.

---

### Allowed to touch

- `src/features/conversion/collieFileWriter.ts`
- `src/convert/collie/print.ts`
- `src/convert/tsx/print.ts`

### Must NOT touch

- `src/format/**`
- `src/features/formatting/**`

---

### Acceptance criteria

✅ When appending a new template block to an existing `.collie` file:

* There is exactly one blank line between template blocks
* The file ends with a newline
* Each block follows:

```
#id ...
(blank line)
#props ... (optional)
(blank line)
#classes ... (optional)
(blank line)
(template)
(blank line)
```

❌ The extension must **NO LONGER**:

* Place `#props` directly adjacent to `#id` without a blank line
* Place template nodes directly adjacent to `#props` without a blank line
* Create `#id` blocks without a terminating blank line

---

## Stage 8 — End-to-End Local “Golden” Example Validation (Manual Fixture Files)

### Context

This repo doesn’t appear to have a tight automated harness for conversion behavior, so we’ll add lightweight, human-readable fixtures you can manually run against during development and keep as reference.

This stage adds:

* an example TSX file demonstrating both conversion approaches
* expected Collie output in a companion `.collie` file

(These are not tests; they’re golden reference fixtures.)

---

### Allowed to touch

- `example.tsx`
- `example.collie`
- `docs/**`        (if you prefer to store golden examples here)

### Must NOT touch

- `dist/**`
- `node_modules/**`

---

### Acceptance criteria

✅ Repository includes a documented “golden example” for:

**A) branch-only conversion** — results in:

```tsx
{loggedIn ? <Collie id="UserPanel.LoggedIn" ... /> : <Collie id="UserPanel.LoggedOut" ... />}
```

with `.collie` containing:

* `#id UserPanel.LoggedIn`
* `#id UserPanel.LoggedOut`

**B) full-block conversion** — results in:

```tsx
<Collie id="UserPanel" ... />
```

with `.collie` containing a single `#id UserPanel` template using `@if/@else`

---

# Final Guarantees After v5 (collie-vscode)

After completing all stages:

* ✅ Converting selections **always creates new template blocks**
* ✅ No append-to-existing footgun exists
* ✅ Collie output uses `#props` and formatting rules consistently
* ✅ Conditionals convert to `@if / @elseIf / @else` when selected as a whole
* ✅ Branch-only selections do not invent control flow
* ✅ Diagnostics align with new semantics and stop false positives
