# Development Guide

## Coding Style & Conventions
No formatter is configured yet. When adding code:
- Decompose logic into small, clear modules and functions; avoid large files and monolithic utilities.
- Refactoring guidance: avoid micro-abstractions that remove only a few lines or just wrap a slot/prop pass-through; prefer extraction only when it meaningfully reduces duplication or clarifies responsibilities.
- Keep file names aligned with their roles.
- When editing config files (e.g., `.gitignore`, scripts, build configs), preserve existing entries unless explicitly instructed to remove them.
- When adding or updating packages, always use the latest stable versions of dependencies.
- Check security advisories and do not use package versions with high or critical severity issues.

## Encoding & JSON Formatting
- All repository text files must be UTF-8.
- For task files (`tasks/*.json`), keep human-readable UTF-8 strings (no `\uXXXX` escapes).
- When reformatting JSON, preserve semantics and use stable, readable formatting (2-space indent, trailing newline).

## Git Workflow
Use Conventional Commits (e.g., `feat: add an google lib`, `fix: correct tag parsing`, `docs: update spec`).
Commit messages must be written in English.
Feature-Developer must create a dedicated task branch before making any code or config changes, and merge into `main` only after all task steps are completed successfully.
Each task stage must be captured by at least one separate commit. If a stage touches different responsibility areas, split changes into separate commits per area. For changes that differ by type/purpose (e.g., code vs documentation), use separate commits. Keep each commit minimal for quick code review.
By default, create commits for code/config changes without waiting for an explicit user request; if no message is provided, pick a clear Conventional Commit message.
Any code change must be committed as its own commit; do not bundle unrelated changes.
Only the Project-Manager determines task acceptance. After a task is merged into `main`, verify and update documentation; only then close the task.
Merges into `main` must use a merge commit (no rebase or squash). Require review approval and explicit user approval before merging; once approved, perform the merge.
Feature branch naming must follow: `<type>/<task-id>-<short-kebab-desc>`, where `<type>` is one of `feat|fix|chore|docs|test|refactor`. Example: `feat/33-post-date-formatting`.
Do not start a new task while on another task branch; first propose completing the current task. If a new task blocks the current one, set the blocker and switch to the new task on its own branch. After creating new tasks, do not immediately start their implementation.
Pre-flight checklist (before changing code/config for a task):
- Confirm you are on a task branch named per the rule above (not `main`).
- Ensure `git status` is clean or only contains intended changes for the current task.
- Verify the task ID is correct and referenced in the branch name.
Hard stop: run `git branch --show-current` and `git status` before any edits; if you are on `main` and non-exempt changes are needed, create a task branch following the naming rule (default type to `feat` if unclear) and continue without asking for a branch name; if the working tree is dirty with unrelated changes, stop and ask how to proceed.

## Pipeline Workflow
Tasks must proceed through the required stages in strict order; stage definitions live in `docs/task-management.md`. After completing any stage, return the task to the Project-Manager subagent; only PM decides and initiates the next stage. Do not pause or stop after finishing a stage unless blocked. Do not skip or reorder stages. Do not ask the user for permission to hand off between stages; proceed automatically.
Stage transitions must be immediate and atomic: once you decide to move to the next stage, begin it in the same run with no intermediate stop.
If code or config changes were made, do not advance to the next stage or complete a task without at least one commit capturing those changes.
FD must create a commit at the end of its work stage before handing off to FR/QA, even if the task is not yet ready to merge.
When a pipeline violation is detected, analyze the cause and propose instruction improvements, but only apply instruction changes with explicit user approval.
Documentation updates are allowed at any time, including before merge.

## SubAgent Skill Usage
When a task matches a listed skill or the user names one, use it for that turn and announce the selection. Read only the required parts of the skill file. If a required skill file is missing, note it and continue with the closest fallback.

## Instruction Persistence
Any new system/developer workflow rules discovered during a session must be recorded in project documentation or role skill files so a new session can resume without loss.
