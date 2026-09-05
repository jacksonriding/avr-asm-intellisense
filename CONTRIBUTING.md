# Contributing

Thanks for helping improve AVR Assembly IntelliSense. This project is maintained as a
production-quality open-source extension with a strong emphasis on language correctness,
test quality, and trust boundaries.

## Getting started

1. Fork the repository and create a branch from the current main branch.
2. Install dependencies:

```sh
npm install
```

3. Make focused changes.
4. Update tests and documentation where behavior is user-visible.

## Development environment

- Node.js 22+ (CI uses Node.js 24).
- Run locally with:

```sh
npm run check
npm run test
npm run compile
```

- Validate extension surfaces with:

```sh
npm run test:extension
npm run test:extension:restricted
npm run test:extension:packaged
```

On headless Linux, prefix host tests with:

```sh
xvfb-run -a npm run test:extension
```

## Contribution scope

- Prefer targeted fixes that match the active roadmap slice.
- Update docs when you change user-visible behavior.
- Include regression tests for parser/analysis changes.
- Keep changes small and reviewable.

## Commit and pull request expectations

- Use clear, single-purpose commits.
- Keep PRs focused; separate refactors from behavior changes.
- Include summary, validation steps, and any known trade-offs.
- Link to related issues and tests in the PR description.

## Coding expectations

- Keep behavior deterministic and bounded for large files.
- Respect workspace trust boundaries.
- Validate parsed inputs defensively at boundaries.
- Avoid mutating state in shared parser or analysis paths.
- Do not execute build commands from untrusted input.

## Review and release gates

Before marking work complete, ensure:

- Unit and integration tests for the changed behavior.
- Coverage requirements for critical paths.
- Host validation and security checks for relevant new behavior.
- Documentation and changelog updates for user-visible changes.

## Good first contribution topics

- Documentation quality improvements (especially docs clarity and examples).
- Test coverage in parser and completion paths.
- Small reliability and edge-case fixes in diagnostics, navigation, and command handling.
- Small UX polish where behavior is documented and test-backed.

