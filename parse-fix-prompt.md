## Context & Problem

You are working in the `collie-vscode` repo (VS Code extension). The TSX → Collie conversion feature generates `.collie` output from TSX selections/components. Recent work introduced better `#props` output (callable props are emitted as `name()`).

We are now hitting two conversion correctness issues that cause Collie parse errors:

### Issue 1 — `@if` directive syntax is wrong
The converter currently emits:

```collie
@if isLoggedIn
```

But the Collie formatter/parser expects:

```collie
@if (isLoggedIn)
```

It also needs to reliably handle complex conditions, e.g.:

```collie
@if (loggedIn && user.role === 'admin')
```

### Issue 2 — Multi-line attribute groups break parsing

The converter can output multi-line attribute groups like:

```collie
button(onClick={() =>
              setCount((count) => count + 1)}) | Increment (inline)
```

This causes errors like: **"Attribute group must be closed with )."**

The issue appears to be that the Collie attribute group parsing expects the attribute list to be fully closed, but the current output formatting (line breaks inside the `(...)`) isn’t handled correctly by the parser/formatter, or the converter is inserting newlines in a way that violates the grammar.

When the line is rewritten to a single line:

```collie
button(onClick={() => setCount((count) => count + 1)}) | Increment (inline)
```

…it parses fine.

### Goal

Update conversion + parsing rules so:

1. `@if` conversion always wraps conditions in parentheses.
2. Multi-line attribute groups are either:

   * supported by the parser (preferred if feasible and safe), OR
   * normalized by the converter so generated Collie is valid (fallback).

We want Collie to be robust to common formatting styles and not force everything into single-line output, but correctness comes first.

---

## Requirements

### A) Fix `@if` conversion output to always include parentheses

Wherever TSX conditional rendering (`condition ? A : B`) is converted into:

* `@if ...`
* `@else`

Update conversion so it ALWAYS emits:

```collie
@if (<condition>)
```

#### Notes

* Parentheses are required for reliability and to support complex conditions.
* Ensure the condition expression is printed exactly as the TS expression would be (no extra escaping beyond what Collie needs).
* The converter must produce valid Collie for conditions like:

  * `isLoggedIn`
  * `count > 0`
  * `loggedIn && user.role === 'admin'`
  * `user && user.profile?.name`
  * `(a && b) || c` (nested)
* No double-parens unless necessary; but if your printer already returns something with leading/trailing parens, it’s okay to still wrap once if it doesn’t break (ideally avoid `((...))`).

### B) Support multi-line attribute groups OR normalize output safely

We need to handle TSX attributes whose expressions include arrows/functions that the converter currently prints across multiple lines.

Example of currently invalid output:

```collie
button(onClick={() =>
              setCount((count) => count + 1)}) | Increment
```

We need a solution that results in valid Collie.

#### Preferred solution (if feasible)

Update the Collie parser/formatter rules (in the formatting subsystem under `src/format/*`, especially `src/format/parser/parse.ts`) so that attribute groups `(...)` can contain newlines and arbitrary whitespace, as long as:

* parentheses are balanced
* strings/comments are respected
* `)` closes the group eventually

In other words, treat the attribute group like a “balanced parentheses region” that can include line breaks.

#### Fallback solution (acceptable)

If updating the parser is too risky or broad, then update conversion so it never emits multi-line attribute groups in generated code:

* When printing an attribute group expression, collapse internal whitespace/newlines to a single space where safe (preserve spaces inside string literals).
* Emit attributes in a single line at least up to the closing `)`.

This fallback ensures generated output is always valid even if the language doesn’t support multi-line attribute groups.

### C) Keep user-authored Collie flexible (don’t regress)

If you implement parser support for multi-line attribute groups, ensure it does not break existing parsing behavior for:

* nested parentheses in expressions
* braces in interpolations
* comments inside attribute expressions
* multiple attributes in the group

If you use the fallback converter normalization, it’s fine that generated output is single-line, but do not remove the ability for users to later reformat their Collie (future-proof where possible).

---

## Acceptance Criteria

### 1) `@if` syntax correctness

Given TSX:

```tsx
{isLoggedIn ? <A /> : <B />}
```

Expected Collie:

```collie
@if (isLoggedIn)
  A
@else
  B
```

Given TSX:

```tsx
{loggedIn && user.role === 'admin' ? <A /> : <B />}
```

Expected:

```collie
@if (loggedIn && user.role === 'admin')
  A
@else
  B
```

No `@if condition` output should exist.

### 2) Multi-line attribute groups should not error

Given a TSX attribute expression with an arrow function split across lines in the printed output, the generated Collie must parse without:

* “Attribute group must be closed with ).”

Example: this should parse after conversion (either because parser supports it or because converter normalized it):

```collie
button(onClick={() => setCount((count) => count + 1)}) | Increment
```

or, if parser support is implemented, this multi-line form should also parse:

```collie
button(
  onClick={() =>
    setCount((count) => count + 1)
  }
) | Increment
```

Choose one of those approaches, but ensure generated output never breaks.

### 3) No regressions

* `pnpm lint` and `pnpm build` pass.
* Converting the test component `HomepageTestPanel` yields valid Collie that opens without diagnostics related to these issues.

---

## Do NOT write tests

No unit tests, no integration tests, no snapshots.

---

## Implementation Guidance (where to look)

* Conversion path (likely):

  * `src/features/conversion/convertSelectionCommand.ts`
  * `src/convert/tsx/print.ts` and/or TSX printer code
  * any TSX → IR → Collie printing code

* Collie formatting/parser path (if you choose parser support):

  * `src/format/parser/parse.ts`
  * `src/format/parser/*` helpers

Be cautious: parser changes can have wide impact. Prefer tight changes that only affect parsing inside attribute groups `(...)`.

---

## Output Request

After implementing, provide a short summary:

* whether you chose parser support or converter normalization for multi-line attributes (and why)
* the key files changed
* confirmation that `@if` now always prints as `@if (condition)`
