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

After each successful squash commit, close the corresponding issue with `gh issue close <id> --comment "Squashed onto integration branch \`{{INTEGRATION_BRANCH}}\` — will auto-merge to main when the PR lands."`. This is required: sandcastle's outer loop re-plans on the open-issue list, so any issue you leave open will be re-picked-up next iteration and re-implemented from scratch.

(The `Closes #<id>` trailer is still useful as a fallback — if the issue is somehow still open when the PR merges to main, GitHub closes it then. But the trailer alone is not enough; close in-loop too.)

# CLOSE THE PARENT PRD WHEN ITS LAST CHILD CLOSES

The parent PRD for this batch is `#{{PRD_ID}}`. After closing all child issues above, check whether `#{{PRD_ID}}` has any *other* open child issues remaining:

```
gh issue list --state open --search "Parent: #{{PRD_ID}} in:body" --json number,title
```

If that command returns an empty array, the PRD is fully delivered — close it with:

```
gh issue close {{PRD_ID}} --comment "All child issues squashed onto \`{{INTEGRATION_BRANCH}}\`. PRD complete."
```

If it returns one or more open children, leave `#{{PRD_ID}}` open and **skip the PR step below** — it's not time yet.

# OPEN A PR (only when the PRD just closed)

Only if you closed `#{{PRD_ID}}` in the step above:

1. Push the integration branch: `git push -u origin {{INTEGRATION_BRANCH}}`.
2. Check whether a PR already exists for this branch:
   ```
   gh pr list --head {{INTEGRATION_BRANCH}} --json number --jq '.[0].number'
   ```
   If it returns a number, skip step 3 — the PR is already there.
3. Otherwise, open a PR against `main` with a body you write yourself. The body should be a real summary of what changed, not boilerplate. Suggested shape:

   - Opening line: one-sentence description of what the PRD delivered (paraphrase from PRD `#{{PRD_ID}}`'s problem statement — read it with `gh issue view {{PRD_ID}}`).
   - `## Squashed commits` section: one bullet per merged issue (id, title, one-line summary of the change). You already squashed them — use the commit subjects you wrote.
   - `## Closes` trailers: `Closes #<id>` for each child issue and `Closes #{{PRD_ID}}` for the PRD itself. These are belt-and-braces — the issues are already closed in-loop, but the trailers make the relationship obvious in the PR UI.

   Use a HEREDOC for the body so multi-line formatting survives:
   ```
   gh pr create --base main --head {{INTEGRATION_BRANCH}} \
     --title "<concise title — paraphrase the PRD, e.g. 'Introduce ProcessRun and Skills registry'>" \
     --body "$(cat <<'EOF'
   <your body here>
   EOF
   )"
   ```

Once you've done all the above, output <promise>COMPLETE</promise>.
