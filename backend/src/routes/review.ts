import { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { startReview, stopReview, getStatus, getOutput, getFullOutputText } from '../services/reviewRunner.js';
import type { StartReviewFailReason } from '../services/reviewRunner.js';
import { loadProviderConfig, buildRunEnv, getProvider } from '../providers/registry.js';
import type { ProjectRow } from '../db/types.js';

interface Finding {
  id: string;
  title: string;
  description: string;
  severity: 'required' | 'nice-to-have';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ChatHistory {
  messages: ChatMessage[];
}

function getChatHistoryPath(projectPath: string): string {
  return path.join(projectPath, 'scripts', 'ralph', 'review-chat.json');
}

function readChatHistory(projectPath: string): ChatHistory {
  const filePath = getChatHistoryPath(projectPath);
  if (!fs.existsSync(filePath)) return { messages: [] };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChatHistory;
  } catch {
    return { messages: [] };
  }
}

function writeChatHistory(projectPath: string, history: ChatHistory): void {
  const filePath = getChatHistoryPath(projectPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
}

function extractTextFromStreamLine(raw: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const type = parsed.type as string | undefined;

  if (type === 'assistant' && parsed.message) {
    const content = (parsed.message as Record<string, unknown>).content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    return parts.length > 0 ? parts.join('') : null;
  }

  if (type === 'result') {
    return (parsed.result as string) || null;
  }

  return null;
}

export const reviewRouter = Router();

const reasonToStatus: Record<StartReviewFailReason, number> = {
  'not-found': 404,
  'no-provider': 400,
  'unknown-provider': 400,
  'already-running': 409,
};

reviewRouter.post('/:id/review/start', (req, res) => {
  const projectId = parseInt(req.params.id, 10);

  const { baseBranch } = req.body as { baseBranch?: string };
  if (!baseBranch || typeof baseBranch !== 'string') {
    return res.status(400).json({ error: 'baseBranch is required' });
  }

  const result = startReview(projectId, baseBranch);
  if (!result.ok) {
    return res.status(reasonToStatus[result.reason]).json({ error: result.error });
  }

  res.json({ success: true, ...getStatus(projectId) });
});

reviewRouter.post('/:id/review/stop', (req, res) => {
  const projectId = parseInt(req.params.id, 10);

  const stopped = stopReview(projectId);
  if (!stopped) {
    return res.status(404).json({ error: 'No running review found' });
  }

  res.json({ success: true });
});

reviewRouter.get('/:id/review/status', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  res.json(getStatus(projectId));
});

reviewRouter.get('/:id/review/output', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const since = parseInt(req.query.since as string, 10) || 0;
  res.json(getOutput(projectId, since));
});

reviewRouter.get('/:id/review/saved', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const filePath = path.join(project.path, 'scripts', 'ralph', 'review-output.md');
  if (!fs.existsSync(filePath)) {
    return res.json({ content: null });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ content });
});

reviewRouter.post('/:id/review/save-feedback', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  let outputText = getFullOutputText(projectId);

  if (outputText === null) {
    const fallbackPath = path.join(project.path, 'scripts', 'ralph', 'review-output.md');
    if (fs.existsSync(fallbackPath)) {
      outputText = fs.readFileSync(fallbackPath, 'utf-8');
    }
  }

  if (!outputText) {
    return res.status(400).json({ error: 'No review output exists' });
  }

  const feedbackDir = path.join(project.path, 'scripts', 'ralph');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(path.join(feedbackDir, 'review-feedback.md'), outputText, 'utf-8');

  res.json({ success: true });
});

reviewRouter.post('/:id/review/generate-fix-prd', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { findings, branchName } = req.body as { findings: Finding[]; branchName?: string };

  if (!findings || !Array.isArray(findings) || findings.length === 0) {
    return res.status(400).json({ error: 'At least one finding is required' });
  }

  const ralphPath = path.join(project.path, 'scripts', 'ralph');
  const prdPath = path.join(ralphPath, 'prd.json');

  let existingPrd: { project?: string; qualityChecks?: Record<string, string> } | null = null;
  if (fs.existsSync(prdPath)) {
    try {
      existingPrd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
    } catch {
      // ignore parse errors
    }
  }

  const qualityChecks = existingPrd?.qualityChecks || {};

  // Archive current run
  if (fs.existsSync(prdPath)) {
    const featureName = (existingPrd?.project || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const today = new Date().toISOString().slice(0, 10);
    const archiveBase = path.join(ralphPath, 'archive');
    fs.mkdirSync(archiveBase, { recursive: true });

    let folderName = `${today}-${featureName}`;
    if (fs.existsSync(path.join(archiveBase, folderName))) {
      let suffix = 2;
      while (fs.existsSync(path.join(archiveBase, `${folderName}-${suffix}`))) {
        suffix++;
      }
      folderName = `${folderName}-${suffix}`;
    }

    const archiveDir = path.join(archiveBase, folderName);
    fs.mkdirSync(archiveDir, { recursive: true });

    fs.renameSync(prdPath, path.join(archiveDir, 'prd.json'));

    const progressPath = path.join(ralphPath, 'progress.txt');
    if (fs.existsSync(progressPath)) {
      fs.renameSync(progressPath, path.join(archiveDir, 'progress.txt'));
    }

    const lastBranchPath = path.join(ralphPath, '.last-branch');
    if (fs.existsSync(lastBranchPath)) {
      fs.renameSync(lastBranchPath, path.join(archiveDir, '.last-branch'));
    }

    const feedbackPath = path.join(ralphPath, 'review-feedback.md');
    if (fs.existsSync(feedbackPath)) {
      fs.unlinkSync(feedbackPath);
    }

    const reviewOutputPath = path.join(ralphPath, 'review-output.md');
    if (fs.existsSync(reviewOutputPath)) {
      fs.unlinkSync(reviewOutputPath);
    }

    const chatHistoryPath = path.join(ralphPath, 'review-chat.json');
    if (fs.existsSync(chatHistoryPath)) {
      fs.unlinkSync(chatHistoryPath);
    }
  }

  const prdJson = {
    project: existingPrd?.project || project.name,
    branchName: branchName || 'ralph/fix-review-findings',
    description: `Fix ${findings.length} review finding(s) from code review triage.`,
    qualityChecks,
    userStories: findings.map((f, i) => ({
      id: `US-${String(i + 1).padStart(3, '0')}`,
      title: f.title,
      description: f.description,
      acceptanceCriteria: [
        f.description,
        'Typecheck passes',
      ],
      priority: f.severity === 'required' ? 1 : 2,
      passes: false,
      inProgress: false,
      notes: `From review finding ${f.id} (${f.severity})`,
    })),
  };

  fs.mkdirSync(ralphPath, { recursive: true });
  fs.writeFileSync(prdPath, JSON.stringify(prdJson, null, 2), 'utf-8');

  res.json({ prdJson });
});

reviewRouter.post('/:id/review/analyze', async (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const filePath = path.join(project.path, 'scripts', 'ralph', 'review-output.md');
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'No review-output.md exists' });
  }

  const reviewContent = fs.readFileSync(filePath, 'utf-8');

  const providerName = project.review_provider || 'claude';
  const providerConfig = loadProviderConfig(providerName);
  const runEnv = buildRunEnv(providerName, project.review_model_variant ?? undefined, providerConfig);

  const prompt = `You are a code review analyzer. Extract all findings from the following code review output and return them as a JSON array. Return ONLY valid JSON with no markdown formatting, no explanation, no other text.

Each finding must have these fields:
- "id": sequential identifier like "F-001", "F-002", etc.
- "title": short title summarizing the finding (under 80 chars)
- "description": detailed description of the issue and what should be done
- "severity": "required" if it must be fixed before merging, "nice-to-have" if it's an optional improvement

Review output:
${reviewContent}`;

  try {
    const findings = await new Promise<Finding[]>((resolve, reject) => {
      const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: runEnv,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Claude exited with code ${code}`));
          return;
        }
        try {
          const cleaned = stdout.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          resolve(JSON.parse(cleaned) as Finding[]);
        } catch {
          reject(new Error('Failed to parse findings from Claude output'));
        }
      });

      child.on('error', reject);
    });

    res.json({ findings });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to analyze review output';
    res.status(500).json({ error: message });
  }
});

// ---- Review Chat ----

reviewRouter.get('/:id/review/chat/history', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const history = readChatHistory(project.path);
  res.json({ messages: history.messages });
});

reviewRouter.delete('/:id/review/chat/history', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const chatPath = getChatHistoryPath(project.path);
  if (fs.existsSync(chatPath)) {
    fs.unlinkSync(chatPath);
  }

  res.json({ success: true });
});

reviewRouter.post('/:id/review/chat', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { message } = req.body as { message?: string };
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const providerName = project.review_provider || project.provider || 'claude';
  const modelVariant = (project.review_model_variant || project.model_variant) ?? undefined;

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return res.status(400).json({ error: `Unknown provider: ${providerName}` });
  }

  const providerConfig = loadProviderConfig(providerName);
  const runEnv = buildRunEnv(providerName, modelVariant, providerConfig);

  const ralphDir = path.join(project.path, 'scripts', 'ralph');

  let reviewContent = '';
  const reviewPath = path.join(ralphDir, 'review-output.md');
  if (fs.existsSync(reviewPath)) {
    reviewContent = fs.readFileSync(reviewPath, 'utf-8');
  }

  let prdSummary = '';
  const prdPath = path.join(ralphDir, 'prd.json');
  if (fs.existsSync(prdPath)) {
    try {
      const prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8')) as {
        userStories?: Array<{ id: string; title: string; passes: boolean; inProgress?: boolean }>;
      };
      if (prd.userStories) {
        prdSummary = prd.userStories
          .map(s => `- ${s.id}: ${s.title} [${s.passes ? 'DONE' : s.inProgress ? 'IN PROGRESS' : 'PENDING'}]`)
          .join('\n');
      }
    } catch {
      // ignore parse errors
    }
  }

  const systemContext = [
    `You are a helpful assistant discussing a code review for the project "${project.name}".`,
    reviewContent ? `\n## Review Output\n${reviewContent}` : '',
    prdSummary ? `\n## PRD Summary (User Stories)\n${prdSummary}` : '',
    '\nHelp the user understand the review findings, suggest improvements, and answer questions about the code.',
  ].join('');

  const history = readChatHistory(project.path);

  let conversationPrompt: string;
  if (history.messages.length > 0) {
    const formatted = history.messages
      .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    conversationPrompt = `Previous conversation:\n${formatted}\n\nHuman: ${message}`;
  } else {
    conversationPrompt = message;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const cliArgs = [
    '-p', conversationPrompt,
    '--append-system-prompt', systemContext,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    ...provider.getCliArgs(providerConfig, modelVariant),
  ];

  const child = spawn('claude', cliArgs, {
    cwd: project.path,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: runEnv,
  });

  let fullResponse = '';
  let stdoutBuf = '';

  child.stdout?.on('data', (data: Buffer) => {
    stdoutBuf += data.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';
    for (const raw of lines) {
      const text = extractTextFromStreamLine(raw);
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
  });

  child.stderr?.on('data', () => {
    // discard stderr for chat
  });

  child.on('close', () => {
    if (stdoutBuf.trim()) {
      const text = extractTextFromStreamLine(stdoutBuf.trim());
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    if (fullResponse) {
      const now = new Date().toISOString();
      history.messages.push(
        { role: 'user', content: message, timestamp: now },
        { role: 'assistant', content: fullResponse, timestamp: now },
      );
      writeChatHistory(project.path, history);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  });

  child.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  req.on('close', () => {
    if (child && !child.killed) {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  });
});
