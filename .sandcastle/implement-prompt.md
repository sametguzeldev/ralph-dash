# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view <ID>`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

This repo has no root `package.json` — frontend and backend are separate packages and there is no test runner configured. Before committing, run whichever of these touch the code you changed:

- Backend changes: `cd backend && npm run build`
- Frontend changes: `cd frontend && npm run build`

Both run `tsc` and must succeed before you commit.

# COMMIT

Make a git commit. These commits will be squashed when the branch is merged into the PRD integration branch, so the message only needs to be useful to a reviewer reading the issue branch. Keep it short — one subject line, optional body if there's a non-obvious decision worth recording. Do not add prefixes like `RALPH:` or `feat:` — the merger writes the final squash-commit subject.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was done.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
