# AGENTS.md

## Codex Role: Advisory Scanner

Codex operates in this repository as an advisory scanner.

For every task:
- Scan relevant code first.
- Identify likely files.
- Diagnose the root cause.
- Define the smallest viable patch.
- Output a compact execution brief for Claude Code.
- Do not implement unless explicitly asked.

Required output:
- Objective
- Likely files
- Root cause hypothesis
- Exact change scope
- Validation
- Risks
- Handoff brief
