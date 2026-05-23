// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.mts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import { execSync } from "node:child_process";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Run a git command on the host repo and return stdout, trimmed.
function git(args: string): string {
  return execSync(`git ${args}`, { encoding: "utf8" }).trim();
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

// Mount the host's Codex auth file into every sandbox so `codex exec` uses
// the same ChatGPT subscription credentials. Codex refreshes the token at
// runtime, so this must be writable — the refreshed token persists back to
// the host for the next run.
const dockerOptions = {
  mounts: [
    { hostPath: "~/.codex/auth.json", sandboxPath: "~/.codex/auth.json" },
  ],
};

// Hooks run inside the sandbox before the agent starts each iteration.
// Ralph-dash has no root package.json — install in each sub-package.
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "cd backend && npm install" },
      { command: "cd frontend && npm install" },
    ],
  },
};

// Copy node_modules from the host into the worktree before each sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["backend/node_modules", "frontend/node_modules"];

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent (opus, for deeper reasoning) reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — we parse that to drive Phase 2.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    hooks,
    sandbox: docker(dockerOptions),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code.
    maxIterations: 1,
    // Opus for planning: dependency analysis benefits from deeper reasoning.
    agent: sandcastle.claudeCode("claude-opus-4-7"),
    promptFile: "./.sandcastle/plan-prompt.md",
  });

  // Extract the <plan>…</plan> block from the agent's stdout.
  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error(
      "Planning agent did not produce a <plan> tag.\n\n" + plan.stdout,
    );
  }

  // The plan JSON contains the parent PRD and an array of unblocked issues.
  const { prd, issues } = JSON.parse(planMatch[1]!) as {
    prd: { id: string; title: string; slug: string };
    issues: { id: string; title: string; branch: string }[];
  };

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  // Integration branch for this PRD — one PR's worth of work lives here, and
  // every issue branch this iteration is created from its current tip.
  // Reused across iterations so newly unblocked work stacks onto prior merges.
  const integrationBranch = `sandcastle/prd-${prd.id}-${prd.slug}`;
  const branchExists =
    execSync(`git rev-parse --verify --quiet ${integrationBranch} || true`, {
      encoding: "utf8",
    }).trim() !== "";
  if (branchExists) {
    git(`checkout ${integrationBranch}`);
  } else {
    git("fetch origin main");
    git(`checkout -B ${integrationBranch} origin/main`);
  }
  console.log(`Integration branch: ${integrationBranch}`);

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: docker(dockerOptions),
        hooks,
        copyToWorktree,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: sandcastle.codex("gpt-5.5"),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-4-7"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Only pass branches that actually produced commits to the merge phase.
  // An agent that ran successfully but made no commits has nothing to merge.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent squash-merges all completed issue branches into the integration
  // branch, resolving any conflicts and verifying builds. Each issue lands as
  // a single commit with a `Closes #<id>` trailer.
  // -------------------------------------------------------------------------
  // The merger needs a sandbox already on the integration branch so its
  // `git merge --squash` commits land there. sandcastle.run() doesn't accept
  // a branch directly, so we create a sandbox first and close it afterwards.
  //
  // Git refuses to check the same branch out in two worktrees, so we have to
  // detach the main repo from the integration branch before createSandbox()
  // can claim it, then re-attach after the sandbox closes so the next
  // iteration's branchExists/checkout dance (and the post-loop push) finds
  // the main repo where they expect it.
  git("checkout main");
  const mergeSandbox = await sandcastle.createSandbox({
    branch: integrationBranch,
    sandbox: docker(dockerOptions),
    hooks,
    copyToWorktree,
  });
  try {
    await mergeSandbox.run({
      name: "merger",
      maxIterations: 1,
      agent: sandcastle.codex("gpt-5.5"),
      promptFile: "./.sandcastle/merge-prompt.md",
      promptArgs: {
        INTEGRATION_BRANCH: integrationBranch,
        // Tab-separated rows so the merger has id, title, and branch together
        // without having to cross-reference two lists.
        BRANCH_ROWS: completedIssues
          .map((i) => `- ${i.id}\t${i.title}\t${i.branch}`)
          .join("\n"),
      },
    });
  } finally {
    await mergeSandbox.close();
  }
  // Re-attach so the next iteration and the post-loop push find us here.
  git(`checkout ${integrationBranch}`);

  console.log("\nBranches merged.");
}

// -------------------------------------------------------------------------
// Open a PR for the integration branch.
//
// All squashed issue commits live on `sandcastle/prd-<id>-<slug>`. We push it
// to origin and open a PR against main. The `Closes #<id>` trailers in the
// squash commits will close the underlying issues when the PR is merged.
// -------------------------------------------------------------------------
const currentBranch = git("rev-parse --abbrev-ref HEAD");
if (currentBranch.startsWith("sandcastle/prd-")) {
  console.log(`\nPushing ${currentBranch} and opening PR…`);
  git(`push -u origin ${currentBranch}`);
  const existingPr = execSync(
    `gh pr list --head ${currentBranch} --json number --jq '.[0].number' || true`,
    { encoding: "utf8" },
  ).trim();
  if (existingPr) {
    console.log(`PR #${existingPr} already exists for ${currentBranch}.`);
  } else {
    execSync(
      `gh pr create --base main --head ${currentBranch} ` +
        `--title ${JSON.stringify(`Sandcastle: ${currentBranch}`)} ` +
        `--body ${JSON.stringify(
          `Automated PR from sandcastle for branch \`${currentBranch}\`. Each commit is a squash of one issue branch; merging this PR will close the referenced issues.`,
        )}`,
      { stdio: "inherit" },
    );
  }
}

console.log("\nAll done.");
