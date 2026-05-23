# TASK

You are merging completed issue branches into the current integration branch (`{{INTEGRATION_BRANCH}}`). Each issue becomes a **single squashed commit** on the integration branch — the intermediate per-iteration commits on each issue branch are intentionally collapsed away.

Branches to merge (each line is `<id>\t<title>\t<branch>`):

{{BRANCH_ROWS}}

For each branch, in order:

1. Run `git merge --squash <branch>`.
2. If there are conflicts, resolve them by reading both sides and choosing the correct resolution. Do not just take one side blindly.
3. Verify the build still works. This repo has no root `package.json` — run whichever of these match the touched code:
   - Backend: `cd backend && npm run build`
   - Frontend: `cd frontend && npm run build`
   If a build fails, fix the issue before committing.
4. Commit with `git commit -m "<subject>" -m "<body>"` where:
   - `<subject>` is a concise, imperative sentence describing what the issue accomplished. Do NOT use prefixes like `RALPH:` or `feat:`. Example: `Persist run output past 60s TTL (#42)`.
   - `<body>` ends with `Closes #<id>` so the PR auto-closes the issue when merged.

Do **not** create a separate merge-summary commit. One squash commit per issue is the entire output.

# CLOSE ISSUES

Do not close issues here — the `Closes #<id>` trailer in each commit will close them automatically once the integration branch's PR is merged into main.

Once you've merged everything you can, output <promise>COMPLETE</promise>.
