# Agents style and structure guide

## Indentation

- Always use tabs for indentation
- Tab size is 4 spaces

## Annotations

- Dont use emojies in comments
- Functions and class methods should always have a comment above them prefixed with "MARK:" and then the function name, to make them visible in the outliner
- Exposed/exported functions/public methods should always have docstrings, which should appear above the function, after the MARK statement

## Alignment and whitespace

- Use vertical alignment where appropriate, eg in object properties
- Files should always have a trailing newline
- Consecutive rows of variable delcarations should use vertical alignment
- Functions with multiple input parameters should have each parameter appears on a new line and use vertical spacing for alignments
- Functions should have 2 line-breaks above their MARK comment to clearly separate them from the function before them

## File structure

- Always follow the existing project structure

## Import statements

- When adding imports, use absolute paths such as "src/client/foo.ts" instead of relative ones like "./foo.ts"
- Import order should be grouped into three sections:
  - External dependencies (e.g. npm packages)
  - Shared/internal modules (e.g. modules from common directories such as shared/ or replicated/)
  - Domain-specific modules (e.g. client/, server/, or other feature/domain folders)
- Within each import section, imports must be sorted alphabetically by module specifier (file path), not by the names of the imported bindings.

## Logging

- Logging statements should always be prefixed with the namespace/class/module name, and the current function, eg "SoundManager: PlaySound: an error occured..."

## Code strcture

### Keep Reusable Code Generic

- Do not mix project-specific data or behavior into generic utilities. Reusable utilities should remain portable and typically live under:
  - src/shared/utils/
- Project-specific event definitions, components, classes, data, metrics, types, and configuration should live in appropriate files under src/client, src/server, or src/shared.
- Generic utilities must not depend on project-specific modules.
- Do not place source files directly under src/. Every file must belong under src/client, src/server, or src/shared, based on where it is used. The root src/ directory should contain only the project's entry point (for example, index.ts) and no other implementation files.

## Do Not Fail Silently

- Avoid excessive defensive null checks and silent early returns.
- When an expected operation fails:
  - Always log a clear console message with enough context to diagnose the failure.
  - Recover and continue when recovery is safe.
  - Do not throw errors for recoverable runtime failures, because an uncaught error may stop the game.
  - Throw only when continuing would leave the application in an invalid or unsafe state.
