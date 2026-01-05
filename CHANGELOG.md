# Changelog

## [Unreleased]
- Initial repository scaffolding and MVP stage 1 setup.
- Added semantic token customization UX, cursor-aware inference, and documentation for Collie-specific token categories.
- Introduced commands for customizing, resetting, and copying Collie semantic token color snippets so users can share their highlight schemes.

### Added
- Context menu entries for the demo flow, including "Convert to Collie" and "Convert to TSX (Copy to Clipboard)".
- Menu-specific command IDs for demo narration (`collie.convertToCollie`, `collie.convertToTsxClipboard`) wired to existing conversion handlers.
- Auto-create Collie files from TSX selection with deterministic naming, PascalCase `#id` insertion, and auto-open.
- TSX selection replacement with placeholder component usage plus import injection and dedupe.
- PascalCase `#id` diagnostics with a quick fix action.
- "Fix all Collie issues" source action aggregating fixable diagnostics.
- One-time warnings for missing `collie.config.*` and missing Collie tooling packages.

### Changed
- Conversion flow now attempts to update the originating TSX document after creating the `.collie` file.
