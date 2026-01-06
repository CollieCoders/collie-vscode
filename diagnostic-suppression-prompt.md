## Context & Problem

You are working in the `collie-vscode` repo (VS Code extension). The extension produces warnings/errors (diagnostics) for `.collie` files via the diagnostics feature (see `src/features/diagnostics/*`). We want users to be able to **suppress specific diagnostics** either:

1) **For the next line only** (line-level ignore)
2) **For the entire file** (file-level ignore)

This must be available as a **Quick Fix** (Code Action) when the user hovers or opens the lightbulb on the warning/error.

### Why
Some warnings/errors are acceptable in certain contexts, and users should be able to suppress them without changing code structure. This also prevents “noise” from known non-actionable warnings.

---

## Desired UX

When the user has a diagnostic (warning/error) in a Collie file, Quick Fix options should include:

- **Ignore this `<DIAGNOSTIC_CODE>` on this line**
- **Ignore this `<DIAGNOSTIC_CODE>` in this file**

Selecting:
- “line” ignore inserts an ignore directive that suppresses that diagnostic for the target line only.
- “file” ignore inserts an ignore directive that suppresses that diagnostic anywhere in the file.

---

## Directive Syntax (must implement)

Use Collie comment-style directives (not TS types, not JSON) that are easy to read and robust.

### Line-level ignore (ignore next line)
Insert **directly above** the target line:

```collie
#collie-ignore-next-line <CODE>
```

### File-level ignore (ignore entire file)

Insert at the top of the file (after `#id` if present; otherwise at very top):

```collie
#collie-ignore-file <CODE>
```

### Multiple codes

Support multiple codes on one directive line (space-separated):

```collie
#collie-ignore-next-line COLLIE123 COLLIE456
#collie-ignore-file COLLIE123 COLLIE456
```

### Code definition

The `<CODE>` must come from the diagnostic’s `Diagnostic.code` value. If a diagnostic does not have a code, do NOT offer ignore quick fixes for it.

---

## Requirements

### A) Diagnostics must respect ignores

Update the diagnostics pipeline so that when emitting diagnostics for a `.collie` file:

* If the file contains `#collie-ignore-file <CODE>`, suppress all diagnostics with that code in the file.
* If the diagnostic’s line is immediately preceded by `#collie-ignore-next-line <CODE>`, suppress that diagnostic on that line.

Important: Line-level ignore should apply to the **next non-directive line only** (i.e., the line immediately below the directive). Do not “skip blanks” unless you explicitly choose to (see Acceptance Criteria notes).

#### Where to implement suppression

Implement suppression in the central place where diagnostics are created/collected (likely in `src/features/diagnostics/provider.ts` or whatever composes diagnostics). Avoid duplicating suppression logic across each diagnostic source if possible.

You will probably need to:

* parse directives from the document text (or reuse existing directive parsing infrastructure if present)
* build a suppression lookup structure for the file
* filter diagnostics before returning/publishing them

### B) Add Quick Fixes via Code Actions

Update the CodeActionProvider (likely `src/features/diagnostics/codeActions.ts`) so that for any diagnostic with a string code:

* Offer a CodeAction “Ignore this `<CODE>` on this line”
* Offer a CodeAction “Ignore this `<CODE>` in this file”

Each CodeAction should:

* Use `vscode.WorkspaceEdit` to insert the directive text.
* Be `CodeActionKind.QuickFix`.
* Be associated with the diagnostic (so it shows in the lightbulb for that diagnostic).

#### Insertion behavior (important)

**Line ignore**:

* Insert a new line above the diagnostic’s start line.
* Match the indentation of the target line (if the target line is indented with spaces, prefix the directive with the same indentation).
* Ensure you don’t insert duplicate directives if it already exists for that code on that line.

**File ignore**:

* Insert near the top of the file.
* If there is a `#id ...` directive at the top, insert after it (and after any immediately-following blank line if needed).
* If an existing `#collie-ignore-file` directive exists, append the code if it’s not already present, rather than adding another directive line (prefer keeping one directive line if possible).
* Avoid duplicates.

### C) Parsing directives robustly

Add (or extend) parsing utilities to detect ignore directives. Don’t over-engineer:

* Use line-based scanning: split document into lines, parse directives with regex.
* Recognize directives only when they appear at the start of a line (allow leading whitespace).
* Ignore trailing comments/extra whitespace.

Regex shape examples:

* `^\s*#collie-ignore-file\s+(.+?)\s*$`
* `^\s*#collie-ignore-next-line\s+(.+?)\s*$`

Then split the captured codes on whitespace.

### D) No behavior changes outside suppression

Only suppress diagnostics that match the ignore directives. Everything else should behave exactly the same.

---

## Acceptance Criteria

### 1) File-level suppression

Given a `.collie` file containing:

```collie
#collie-ignore-file COLLIE123
```

Any diagnostic with `code = "COLLIE123"` must not be shown anywhere in that file.

Diagnostics with other codes must still appear.

### 2) Line-level suppression

Given:

```collie
#collie-ignore-next-line COLLIE123
div.bad
```

Any diagnostic with `code = "COLLIE123"` whose range starts on the `div.bad` line must be suppressed.

Diagnostics with other codes must still appear on that line.

### 3) Multiple codes per directive

Given:

```collie
#collie-ignore-file COLLIE123 COLLIE456
```

Both codes are suppressed across the file.

Given:

```collie
#collie-ignore-next-line COLLIE123 COLLIE456
```

Both codes are suppressed on the next line.

### 4) Quick Fix availability

If a diagnostic has `Diagnostic.code` as a string:

* both ignore quick fixes must be available

If diagnostic has no code (undefined/null/non-string):

* ignore quick fixes must NOT be offered

### 5) No duplicates

If the ignore directive already exists for that code:

* The quick fix should not add another identical directive line
* Prefer either doing nothing, or expanding existing directive codes (file-level), or detecting the exact line-level directive already present

### 6) Build hygiene

* `pnpm lint` and `pnpm build` must pass.
* No circular imports introduced.

---

## Do NOT write tests

No unit tests, no integration tests, no snapshots.

---

## Implementation Guidance (where to look)

* Code actions:

  * `src/features/diagnostics/codeActions.ts`

* Diagnostic creation/publishing (suppression should happen before publishing):

  * `src/features/diagnostics/provider.ts`
  * plus any diagnostic sources like `compilerDiagnostics.ts`, `tsPropsDiagnostics.ts` (but prefer central filtering)

* Document parsing / directive scanning:

  * If there is existing directive parsing in `src/lang/parseDocument.ts` or `src/features/diagnostics/helpers/directives.ts`, extend it there.
  * Otherwise add a small helper like `src/features/diagnostics/helpers/ignoreDirectives.ts` or extend existing `directives.ts`.

---

## Output Request

After implementing, provide a short summary:

* exact directive syntax implemented
* key files changed
* how suppression lookup is computed (1–2 sentences)
* confirmation that the two quick fixes appear only when `Diagnostic.code` is a string
