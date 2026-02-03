# Project Instructions

This file contains project-specific workflow and rules. Role-specific agent instructions live in the ai-code agent files; do not duplicate them here.

## References
- Project docs directory: `docs/*`
- Development workflow: `docs/development.md`
- Task management workflow: `docs/task-management.md`

## Persistence Policy
- Any system/developer instructions or other critical workflow rules must be recorded in persistent files (project docs or role skill files), not only in-session context.
- When such instructions are discovered during a session, update the relevant files so a new session can resume without loss.

## Git Workflow (Project)
Follow the repository Git rules in `docs/development.md` (branch naming, commit rules, merge policy).

## Agent Console Logs
- When switching skill modes during task work, emit a console message that states the current agent and who invoked it (e.g., "Console: feature-developer invoked by user.") so the terminal log captures the handoff.

## Pre-flight Branch Check (Hard Stop)
- Before any code or configuration changes, confirm you are on a task branch (not main) and that it follows <type>/<task-id>-<short-kebab-desc>.
- Documentation files, AGENTS.md, and task files under tasks/** are exempt; they may be edited on main without a task branch.
- Still run git branch --show-current and git status before edits; if non-exempt changes are needed and you are on main, create a task branch that follows the naming rule (default type to feat if unclear) and continue without asking for the branch name.
