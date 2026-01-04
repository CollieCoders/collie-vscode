# Collie VS Code v5 — Risk Register

This document defines **hard constraints and anti-goals** specific to v5.
It must be read and followed before implementing any v5 stage.

> Purpose:
> Identify **high-risk areas** in the TSX → Collie conversion pipeline and related editor features that are intentionally heuristic, partial, or selection-sensitive — and therefore **must not be aggressively refactored or generalized** during v5 work.

---

## Risk 1 — TSX Selection Shape Is Ambiguous by Nature

### Area

```
src/convert/tsx/parseSelection.ts
src/convert/tsx/jsxToIr.ts
```

### Description

TSX selections are **not AST-complete** in many real-world cases:

* Selection may start or end mid-node
* Selection may include:

  * one branch of a ternary
  * both branches
  * only the JSX children inside a wrapper
* Selection may exclude the surrounding conditional expression

This ambiguity is **fundamental** — it cannot be fully eliminated.

---

### Why this is risky

Codex (or future maintainers) may attempt to:

* “Normalize” selections by walking upward to a parent AST node
* Automatically include condition expressions not explicitly selected
* Infer user intent beyond the literal selection range

All of these would **break the core mental model**:

> *What you select is what you convert.*

---

### Guardrails (DO NOT VIOLATE)

* ❌ Do NOT expand a selection beyond its textual range
* ❌ Do NOT infer control flow (`@if loggedIn`) unless the conditional expression itself is included in the selection
* ❌ Do NOT auto-wrap partial selections to “make them valid”

---

### Acceptable behavior

* Partial selection → partial conversion
* Branch-only selection → branch-only template
* Full conditional selection → `@if / @else`

Even if this produces “less optimal” Collie output, it is **correct**.

---

## Risk 2 — Conditional Conversion Must Be Shape-Driven, Not Heuristic-Driven

### Area

```
src/convert/tsx/parseSelection.ts
src/convert/tsx/print.ts
```

### Description

There are two distinct, valid conversion modes for conditionals:

1. **Branch-only conversion**
2. **Full conditional conversion**

The difference is **structural**, not semantic.

---

### Why this is risky

It is tempting to:

* Detect a reference to `loggedIn`
* “Helpfully” lift it into an `@if`
* Or collapse multiple branch conversions into one template

This would:

* Violate user intent
* Break incremental extraction workflows
* Cause surprising TSX rewrites

---

### Guardrails

* Conditional conversion MUST be based on:

  * Presence of the conditional expression (`?:`, `&&`) in the selection AST
* NOT based on:

  * Variable names
  * Prop names
  * Repeated patterns

---

### Explicit anti-goal

> “Smartly inferring intent” from surrounding code

Collie conversion is **mechanical**, not psychic.

---

## Risk 3 — Prop Inference Can Easily Overreach

### Area

```
src/convert/tsx/jsxToIr.ts
src/features/conversion/convertSelectionCommand.ts
```

### Description

Prop inference walks the converted IR and determines:

* Which identifiers must be passed to `<Collie />`
* Which belong in `#props`

This logic is intentionally **conservative**.

---

### Why this is risky

Over-eager inference can:

* Pull in identifiers from outside the selection
* Include state setters or locals not actually referenced
* Add props that only exist in the *other* branch of a conditional

---

### Guardrails

* Only identifiers **directly referenced in the converted IR** may become props
* Do NOT:

  * Look at sibling JSX outside the selection
  * Look at parent scopes “for completeness”
* When in doubt:

  * Prefer *missing prop errors* over *phantom props*

---

### Acceptable limitation

If a user selects only half of a structure and gets a template that needs manual cleanup — **that is acceptable**.

---

## Risk 4 — Template ID Generation Must Remain Dumb and Predictable

### Area

```
src/features/conversion/templateId.ts
```

### Description

Template id generation must be:

* Deterministic
* Collision-proof
* Boring

---

### Why this is risky

It’s tempting to:

* Derive ids from JSX structure
* Use component names, prop names, or branch labels
* Rename ids when structure changes

All of this introduces instability.

---

### Guardrails

* IDs must be generated from:

  * File/component context
  * Numeric suffixing (`~2`, `~3`, etc.)
* IDs must NOT:

  * Change based on content
  * Change when templates are reordered
  * Be auto-renamed during subsequent conversions

---

### Explicit anti-goal

> “Smart naming”

Stability > cleverness.

---

## Risk 5 — Formatting During Conversion Is Not General Formatting

### Area

```
src/features/conversion/collieFileWriter.ts
src/convert/collie/print.ts
```

### Description

Conversion output formatting is **purpose-built**, not a general formatter.

It exists to guarantee:

* Section separation
* Human readability
* Non-sandwiched blocks

---

### Why this is risky

A future refactor might:

* Replace conversion formatting with the general formatter
* Normalize whitespace aggressively
* Remove “extra” blank lines

This would break the visual guarantees of converted output.

---

### Guardrails

* Conversion formatting rules are **authoritative**
* Do NOT:

  * Re-route conversion output through `src/format/**`
  * “Clean up” blank lines that are explicitly inserted

---

### Acceptable redundancy

Yes, this duplicates some formatting logic — **that’s intentional**.

---

## Risk 6 — Diagnostics Must Follow Compiler Semantics, Not Re-invent Them

### Area

```
src/features/diagnostics/**
src/lang/templateIndex.ts
```

### Description

Extension diagnostics around props, ids, and usage must reflect:

* The compiler’s actual rules
* Not legacy assumptions
* Not editor-side re-interpretations

---

### Why this is risky

As the language evolves:

* Old diagnostics become wrong
* Editor warnings can contradict compiler behavior
* Users lose trust quickly

---

### Guardrails

* Extension diagnostics must:

  * Treat `#props` as authoritative
  * Respect multi-template files
  * Avoid ordering assumptions

* When unsure:

  * Prefer *no diagnostic* over a false one

---

## Risk 7 — “Convert Selection” Must Remain Non-Destructive

### Area

```
src/features/conversion/convertSelectionCommand.ts
```

### Description

Conversion is an **editor transform**, not a refactor.

---

### Why this is risky

“Helpful” changes might:

* Rewrite more TSX than the selected range
* Collapse multiple Collie usages
* Merge templates automatically

This breaks user trust.

---

### Guardrails

* Conversion must:

  * Replace **only** the selected range
  * Insert **only** the new Collie usage
* It must NOT:

  * Touch unrelated JSX
  * Reorder props
  * Remove or merge existing Collie components

---

## Final Principle (Read This Twice)

> **Collie conversion is allowed to be conservative, mechanical, and slightly verbose —
> but it must never be surprising.**
