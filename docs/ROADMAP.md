# Roadmap

## Direction

AVR Assembly IntelliSense aims to make GNU AVR assembly as well understood by the
editor as a mainstream language, from source navigation through device-correct
diagnostics and toolchain verification. Static language features must remain useful
without an installed compiler and in untrusted workspaces.

This roadmap is ordered by dependency, not by date. A milestone ships only when its
release gates are met; incomplete work moves forward rather than weakening a gate.

## Coverage scorecard

Progress is measured across independent coverage dimensions. Supporting a mnemonic
does not imply support for every device, operand constraint, or editor feature.

| Dimension | Coverage target |
| --- | --- |
| GNU AVR language | Labels, expressions, directives, macros, includes, conditionals, sections, and incomplete source |
| Instructions | Every documented form, operand constraint, alias, status effect, timing model, and target capability |
| Devices | AVR families, registers, SFRs, bitfields, vectors, memory regions, and instruction capabilities |
| Editor features | Completion, hover, signatures, symbols, navigation, references, rename, tokens, and diagnostics |
| Project models | Manual settings, compilation databases, PlatformIO, preprocessing, and multi-root workspaces |
| Validation | Unit, integration, Extension Host, corpus, fuzz, and real-toolchain differential tests |
| Reliability | Cancellation, timeouts, workspace trust, bounded analysis, stale-result rejection, and cross-platform behavior |

The repository should publish a supported syntax and device matrix before 1.0 so
coverage claims remain specific and testable.

## Milestones

### 0.3.1 — Reliability foundation

- Add CI for type checking, tests and coverage, audit, packaging, and VSIX smoke
  installation.
- Add a real VS Code Extension Host smoke suite.
- Route AVR GCC and PlatformIO execution through one bounded, cancellation-aware
  process runner; terminate children on cancellation and extension shutdown.
- Separate project-context discovery and caching from the VS Code adapter.
- Establish parser and workspace-index latency fixtures.

Exit: cancellation races are tested, a packaged extension installs and activates,
overall line coverage remains at least 80%, and new process/security-critical code
has at least 90% line coverage.

### 0.4.0 — Full-document language model

- Build a tolerant, source-preserving GNU AVR lexer, parser, expression model, and
  immutable document snapshot.
- Recognize named, local, and repeatable numeric labels (`1f`/`1b`), instructions,
  macro invocations, assignments, sections, visibility, and GNU AVR expressions.
- Model `.equ`, `.equiv`, `.set`, `.macro`, `.rept`, `.irp`, `.irpc`, comments,
  strings, CPP lines, continuations, and incomplete or malformed editor input.
- Deliver local-symbol completion, document symbols, symbol hover, and
  go-to-definition as the first user-facing slice.

Exit: arbitrary input cannot crash or hang the parser, fuzz/property fixtures pass,
parser critical paths have at least 90% line coverage, and the agreed large-file
latency budget is met.

### 0.4.1 — Includes and workspace index

- Resolve GNU `.include` and CPP `#include` using compilation-context path order.
- Add bounded traversal, cycle detection, unsaved-document overlays, reverse
  dependency invalidation, and multi-root/MCU isolation.
- Add cross-file definitions, references, workspace symbols, and safe rename.
- Represent conditional regions as active, inactive, or unknown.

Exit: include graphs remain deterministic under cycles and edits, results from stale
document versions are rejected, and cross-file features pass integration tests.

### 0.5.0 — Semantic editing and diagnostics

- Add context-aware target, register, register-pair, constant, macro, include-path,
  and directive completion.
- Add semantic tokens and conservative diagnostics for unknown syntax, operand
  counts/forms, register constraints, immediate/bit/I/O ranges, and symbol errors.
- Add quick fixes only where the correction is unambiguous.

Exit: diagnostics have positive and negative corpus tests, unsupported constructs do
not produce speculative errors, and critical editor flows pass Extension Host tests.

### 0.6.0 — Device intelligence

- Replace prose-only availability with typed architecture and instruction
  capabilities, register restrictions, memory ranges, SFRs, bitfields, vectors,
  aliases, and cycle models.
- Generate reproducible profiles from supported toolchains or installed Microchip
  device packs, recording provenance and respecting redistribution licences.
- Test representative classic ATmega/ATtiny, reduced-core, XMEGA, modern
  tiny/mega, AVR Dx/EA-class, and ATtiny1626/QUTy-shaped targets.

Exit: the published device matrix is generated and validated, target contexts never
mix, and device diagnostics agree with supported reference toolchains.

### 0.7.0 — Toolchain-truth diagnostics

- Add optional, debounced assembly checks for trusted workspaces using isolated
  temporary output and cancellation-aware processes.
- Parse GCC/binutils diagnostics and preserve source mapping through preprocessor
  line markers while rejecting stale results.
- Add commands to check the active file, show preprocessed source, and show the
  effective assembler invocation.

Exit: toolchain absence and untrusted workspaces degrade safely to static analysis;
timeouts, cancellation, source maps, and diagnostic parsing have integration tests.

### 0.8.0 — Advanced productivity

- Add an idempotent formatter, folding and selection ranges, inlay hints, resolvable
  call hierarchy, reference CodeLens, and device-aware snippets.
- Add optional navigation over ELF, map, listing, and disassembly artifacts.

Exit: formatting is stable across repeated runs and advanced features remain bounded
and explicitly mark uncertain results.

### 0.9.0 — LSP and ecosystem beta

- Extract an editor-neutral language service and add an LSP transport.
- Run the same conformance suite against the core, LSP, and VS Code adapter.
- Build a licence-compatible public AVR corpus and report unsupported constructs,
  latency, memory, crashes, and diagnostic precision.
- Design explicit AVRASM2 and AVRA dialect profiles without silently mixing syntax.

Exit: transport conformance passes and corpus runs have no crashes, hangs, or
unbounded resource growth.

### 1.0 — Stable GNU AVR tooling

- Verify Linux, Windows, and macOS behavior across unit, integration, Extension Host,
  real-toolchain, package-install, and security checks.
- Publish supported language/device matrices, provenance, workspace-trust behavior,
  troubleshooting, and release automation.
- Replace placeholder Marketplace metadata and complete the stable release path.

Exit: all CI gates pass, overall line coverage is at least 85%, parser/index/security
critical modules remain at least 90%, the supported corpus has no crashes or hangs,
and no known critical or high-severity security issue remains.

## Immediate vertical slice

Work begins with the smallest end-to-end foundation for later milestones:

1. Add cancellation-aware process infrastructure and the 0.3.1 CI gates.
2. Write failing fixtures for named and numeric labels, `.equ`, `.set`, comments,
   malformed lines, and incomplete input.
3. Implement immutable document snapshots and local symbol analysis.
4. Add local-symbol completion, document symbols, hover, and go-to-definition.
5. Prove those features in an Extension Host without requiring a toolchain.
6. Run coverage, fuzz, packaging, security, and code-quality review gates.

## Release gates

Every milestone must:

- Follow test-driven development and keep overall line coverage at or above 80%
  until the 1.0 threshold rises to 85%.
- Keep new parser, index, process, trust, and other security-critical paths at or
  above 90% line coverage.
- Pass type checking, unit/integration tests, audit, packaging, and relevant
  Extension Host or real-toolchain suites.
- Validate external inputs, avoid shell execution, preserve workspace-trust
  boundaries, and never mix analysis from different MCU contexts.
- Use immutable, versioned analysis snapshots; reject stale asynchronous results and
  bound filesystem traversal, macro expansion, process duration, memory, and output.
- Document user-visible behavior and update the support matrix when coverage changes.

## Non-goals

- General x86, Arm, RISC-V, or non-AVR language support. Those require separate
  language products rather than conditionals in the AVR parser.
- Silently combining GNU AVR, AVRASM2, and AVRA syntax. Additional dialects require
  explicit profiles and conformance fixtures.
- Replacing the assembler, compiler, linker, debugger, simulator, or build system.
- Claiming exact control flow, address layout, or cycle counts when macros, indirect
  branches, linker placement, or device data make the answer uncertain.
- Requiring PlatformIO, a compiler, network access, or a trusted workspace for core
  editing features.
- Executing commands found in compilation databases or forwarding arbitrary build
  flags into toolchain processes.
