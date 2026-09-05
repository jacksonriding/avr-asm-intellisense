# Security policy

This project takes security seriously, especially around command execution and workspace trust boundaries.

## Reporting vulnerabilities

If you believe you found a security issue, **do not** open a public issue.

Use one of these private channels:

- GitHub Security Advisory:
  https://github.com/jacksonriding/avr-asm-intellisense/security/advisories/new
- If Security Advisories are unavailable, use the repository maintainer contact method in issue trackers with “Security” in the title.

Provide:

- A clear description of the issue.
- Steps to reproduce.
- Extension version and environment details.
- Any relevant logs or stack traces.

## Scope

The project is a local editor extension with limited command execution surface. We focus on:

- Workspace trust enforcement and safe execution defaults.
- Bounded process execution without shell interpolation.
- Avoiding execution of arbitrary external commands from untrusted context.
- Input validation around project settings and discovery paths.

## Safe disclosure

- We follow a reasonable disclosure timeline and will respond as soon as we can reproduce and validate.
- Public updates are posted once mitigations are available.
- We ask reporters to keep details private until the issue is fixed.

## Security contact handling

Security reports are triaged promptly. When appropriate, fixes are prioritized, and sensitive
context is handled with minimal required disclosure.
