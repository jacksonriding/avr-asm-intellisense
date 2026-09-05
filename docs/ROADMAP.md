# Roadmap

**Project:** AVR Assembly IntelliSense  
**Status:** Production-hardening stage, pre-1.0  
**Last updated:** 2026-09-05

## Purpose

AVR Assembly IntelliSense aims to provide GNU AVR editor support with the reliability and
clarity expected in commercial language tooling: strong language analysis, predictable
performance, robust offline behavior, and explicit trust boundaries.

## Scope

The product roadmap covers:

- GNU AVR parsing depth (labels, directives, expressions, conditionals, includes, macros)
- Instruction semantics and device intelligence
- Editor features (navigation, refactoring, diagnostics, productivity tools)
- Project model support (compile databases, PlatformIO, manual overrides)
- Validation and release quality (coverage, tests, CI, package quality)

The roadmap does **not** target non-AVR architectures or replace assembler, linker,
debugger, or simulator workflows.

## Progress scorecard

| Area | Coverage objective |
| --- | --- |
| GNU AVR language | Labels, expressions, directives, macros, includes, conditionals, sections, incomplete input |
| Instructions | Form coverage, aliases, operand constraints, status effects, timing confidence, target availability |
| Devices | Register/SFR maps, bitfield-aware tool support, vectors, memory regions |
| Editor features | Completion, hover, signature help, symbols, navigation, references, rename, diagnostics |
| Project context | Compile-command parsing, PlatformIO, manual settings, multi-root and trust-safe behavior |
| Validation | Unit, integration, Extension Host, package smoke, real-toolchain checks where possible |
| Reliability | Cancellation, bounded work, timeouts, stale-result rejection, security-conscious execution |

## Milestone map

Each milestone moves only when its exit criteria are met.

### 0.3.1 — Reliability Foundation ✅

- Bounded process runner for compiler and PlatformIO calls
- CI coverage for type-check, test, audit, and packaging gates
- Source-neutral project context service with bounded caching and stale-result rejection
- Extension Host smoke coverage for activation and baseline features
- Installed VSIX smoke testing and Restricted Mode coverage
- Deterministic parser and index latency fixtures

### 0.4.0 — Full-document language model ✅

- Immutable, source-preserving parsing architecture for instructions, directives, labels, macros, and local symbols
- Tolerant document snapshots with numeric/local/named label handling and malformed-line recovery
- Local completion, document symbols, hover, and same-file definition navigation
- Structural GNU expression tree integration into definition operands
- Cursor-safe statement and operand range modeling

### 0.4.1 — Includes and workspace index 🚧

- GNU `#include` and `.include` support via bounded include graph traversal
- Safe cross-file analysis with cycle detection and invalidation
- Cross-file symbol features and workspace indexing
- Conditional regions modeled as active / inactive / unknown

### 0.5.0 — Semantic editing and diagnostics 🚧

- Context-aware completions for registers/constants/directives
- Conservative diagnostics for syntax and operand constraints
- Practical quick-fix support where correction confidence is high

### 0.6.0 — Device intelligence 🚧

- Typed device capability model with provenance and coverage confidence
- Reproducible profile generation and target-specific filtering
- Published capability matrix for representative AVRs

### 0.7.0 — Toolchain-truth diagnostics 🚧

- Trusted-workspace diagnostics pipeline using isolated preprocessor/artifact runs
- Source-correlated GCC/assembler warning mapping
- Cancellation-aware execution, stale-result filtering, and command provenance

### 0.8.0 — Advanced productivity 🚧

- Formatter, folding, inlay hints, and deeper navigation helpers
- Stable and bounded artifact-aware workflows

### 0.9.0 — LSP and ecosystem beta 🚧

- Editor-service extraction behind VS Code adapter
- LSP transport with conformance parity
- Public corpus and coverage publishing process

### 1.0 — Stable GNU AVR tooling 🎯

- Cross-platform release and reliability hardening
- Device matrix and support policy published
- Full marketplace-style supportability and release automation

## Release gates

- 80%+ line coverage in active development (85%+ at 1.0)
- 90%+ coverage for parser/process/trust and security-relevant paths
- Type checks, unit/integration tests, audit, packaging, and host validation executed per release
- No shell execution for command execution (bounded process model only)
- Workspace trust respected in every externally executed tool path
- Immutable, versioned snapshots and cancellation-safe async behavior

## Immediate next slice

1. Complete include graph traversal with stale-safe invalidation
2. Expand local-symbol and symbol-search features across documents
3. Introduce conservative diagnostics for high-confidence grammar/operand errors
4. Prove new functionality with host validation and focused release gates
5. Update support matrix and publish reliability evidence with the release

## Non-goals

- General non-AVR architecture support
- Implicit mixing of GNU AVR, AVRASM2, and AVRA behavior
- Executing build flags or arbitrary commands from external sources
- Deterministic claims about control-flow and cycle accuracy under indirect branch/linker effects

