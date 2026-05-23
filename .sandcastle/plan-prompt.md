# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --label ready-for-agent --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

The list above has already been filtered to issues ready for work.

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{id}-{slug}`.

# PRD

The issues above should all belong to the same parent PRD. Identify it (from issue bodies, labels, or comments — look for a `PRD #N` reference or a `prd` label). Use that PRD's number, title, and a short kebab-case slug derived from the title.

If issues belong to different PRDs, pick the PRD with the most unblocked issues and only include issues from that PRD in the output.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"prd": {"id": "1", "title": "Codex skill runner", "slug": "codex-skill-runner"}, "issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
