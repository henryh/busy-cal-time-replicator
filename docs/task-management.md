# Task Management

## Pipeline Workflow Stages
1. PM: select next unblocked task, confirm scope/acceptance criteria.
2. FD: implement changes (including installs/builds required by the task).
3. FR: review for correctness and alignment with docs.
4. QA: define/run tests when applicable (if skipped, note why).
5. PM: verify acceptance, request user approval to merge; only after approval, merge feature branch to `main`.
6. TW: verify documentation relevance and update docs after merge.
7. PM: close the task once docs are updated and the merge is complete.

## Pipeline Rules
- Strict order: do not reorder, skip, or retroactively apply stages; tasks move to Done only after merge + docs update.
- Move through the pipeline continuously without stopping unless blocked or when user approval is required to merge to `main`.
- Stage transitions must be immediate and atomic: once you decide to move to the next stage, begin it in the same run with no intermediate stop.
- Do not announce a stage transition unless you are actually starting that stage in the same run (e.g., user asked to stop).
- Handoff: after finishing any stage, return the task to the PM subagent; only PM may choose and trigger the next stage. Stage-to-stage progression must go through PM even when unblocked; do not pause or stop after finishing a stage unless blocked. Do not ask the user for permission to hand off between stages; proceed automatically.
- Handoff wording: when transferring to PM, say "handing off to PM now" (or equivalent) rather than "switching", to avoid implying the stage is already complete.
- If FR and QA are OK (including when QA is performed by the user), proceed directly to PM for acceptance without asking for additional confirmation.
- Review failures: if FR/QA finds blocking issues, return the task to PM immediately with actionable fixes; PM routes it back to the appropriate stage without asking the user and without stopping for questions.
- Auto-fix after review: PM may immediately re-enter FD on the same task to address blocking review feedback without waiting for user confirmation.
- Completion behavior: regardless of how many handoffs occur, if FR/QA pass and acceptance criteria are met, proceed to PM merge-approval request and do not stop early unless blocked by a skill-specific hard stop.
- Task boundary: do not select or start a new task unless the user explicitly asks for the next task (e.g., "next task", "pick the next task").

## Task Selection and Priority
- If a task has no `priority` value (missing or empty), treat it as `medium`.

## Task Tracking
- Status: `Active` tasks are current; `Done` tasks are completed.
- To mark a task `Done`, set `completed_at` (YYYY-MM-DDTHH:MM:SS) and ensure it is only in the `Done` status.
- Optional field: `priority` with values `low`, `medium`, `high`.

## Definition of Done
- Acceptance criteria are met and verified by PM.
- FR and QA stages have passed (or QA explicitly skipped with justification).
- PM has requested user approval to merge and received it.
- Merge to `main` completed with a merge commit.
- Documentation updated by TW after merge.
- Task closed by PM with `completed_at` set in `tasks/done.json` (local, gitignored).

## Task Storage and Structure
### Source and Integration
- Task source: local JSON files under `tasks/` (paths: `tasks/active.json`, `tasks/done.json`, `tasks/archive.json`), kept out of the public repo via `.gitignore`.
- Integration: tasks are maintained directly in these local files; they are the single source of truth for status and contents.
- `tasks/active.json` contains active tasks (Active), `tasks/done.json` contains completed tasks (Done), `tasks/archive.json` contains archived completed tasks (Archive).
- The task validator runs via a pre-commit hook; delegate file: `.githooks/pre-commit`, main validator script: `.githooks/pre-commit.tasks-validator`.

### Task Record Structure
Each task is a JSON object with the following fields:
- `id` (number): unique task identifier.
- `title` (string): short title.
- `scope` (string): scope description.
- `acceptance` (string): acceptance criteria.
- `blockers` (number[]): list of blocking task IDs.
- `priority` (string, optional): `low` | `medium` | `high`.
- `techdesign` (string, optional): tech design/plan text.
- `stages` (string[], optional): execution stage list.
- `completed_at` (string, required for Done): ISO completion time.

### Source Rules
- New active tasks (Active) are added to local `tasks/active.json`.
- When completed, a task is moved to local `tasks/done.json` (Done) with `completed_at` filled in and removed from `active`.
- For long-term retention, a task may be moved from local `tasks/done.json` to `tasks/archive.json` (Archive).
