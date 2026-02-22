import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';

export type SkillName = 'prd-questions' | 'prd' | 'ralph';

interface SkillRun {
  process: ChildProcess;
  skill: SkillName;
  output: string[];
  totalLines: number;
  startedAt: Date;
  status: 'running' | 'completed' | 'failed';
  exitCode: number | null;
  stoppedByUser: boolean;
}

const MAX_OUTPUT_LINES = 500;
const skillRuns = new Map<number, SkillRun>();

function readSkillFile(projectPath: string, skill: SkillName): string {
  const skillPath = path.join(projectPath, '.claude', 'skills', skill, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill file not found: ${skillPath}`);
  }
  return fs.readFileSync(skillPath, 'utf-8');
}

function buildPrompt(skill: SkillName, params: {
  featureDescription?: string;
  questionsFile?: string;
  prdFile?: string;
}): string {
  switch (skill) {
    case 'prd-questions':
      if (params.questionsFile) {
        // Follow-up mode: review answers and append follow-up questions
        return `Review the answered questions file at ${params.questionsFile} and generate follow-up questions based on the answers provided. Append them as a new "## Follow-up Questions" section.`;
      }
      if (!params.featureDescription) throw new Error('featureDescription or questionsFile is required for prd-questions');
      return `Generate clarifying questions for this feature: ${params.featureDescription}`;
    case 'prd':
      if (!params.questionsFile) throw new Error('questionsFile is required for prd');
      return `Generate a PRD from the answered questions file at ${params.questionsFile}`;
    case 'ralph':
      if (!params.prdFile) throw new Error('prdFile is required for ralph');
      return `Convert the PRD at ${params.prdFile} to prd.json format`;
    default:
      throw new Error(`Unknown skill: ${skill}`);
  }
}

/**
 * Parse a stream-json line from claude CLI and extract a human-readable message.
 * Returns null if the line has no useful display content.
 */
function parseStreamJsonLine(raw: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — return raw line as-is (stderr or other output)
    return raw.trim() || null;
  }

  const type = parsed.type as string | undefined;

  // Init event
  if (type === 'system' && parsed.subtype === 'init') {
    return '⏳ Claude session started...';
  }

  // Assistant message — extract text and tool_use summaries
  if (type === 'assistant' && parsed.message) {
    const msg = parsed.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;

    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        // Trim long text to keep output log concise
        const text = block.text.trim();
        if (text) parts.push(text);
      } else if (block.type === 'tool_use') {
        const name = block.name as string;
        const input = block.input as Record<string, unknown> | undefined;
        if (name === 'Write' && input?.file_path) {
          parts.push(`📝 Writing ${input.file_path}`);
        } else if (name === 'Read' && input?.file_path) {
          parts.push(`📖 Reading ${input.file_path}`);
        } else if (name === 'Edit' && input?.file_path) {
          parts.push(`✏️  Editing ${input.file_path}`);
        } else if (name === 'Bash' && input?.command) {
          const cmd = String(input.command).slice(0, 80);
          parts.push(`💻 Running: ${cmd}`);
        } else {
          parts.push(`🔧 Using ${name}`);
        }
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  // Result event
  if (type === 'result') {
    const result = parsed.result as string | undefined;
    if (result) return result;
    if (parsed.subtype === 'success') return '✅ Skill completed successfully';
    if (parsed.subtype === 'error') {
      const error = parsed.error as string | undefined;
      return `❌ Error: ${error || 'unknown error'}`;
    }
  }

  return null;
}

export function startSkill(
  projectId: number,
  projectPath: string,
  skill: SkillName,
  params: {
    featureDescription?: string;
    questionsFile?: string;
    prdFile?: string;
  },
): boolean {
  if (skillRuns.has(projectId)) return false;

  const skillContent = readSkillFile(projectPath, skill);
  const prompt = buildPrompt(skill, params);

  // Strip CLAUDECODE env var to avoid "nested session" detection
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  // Inject Claude authentication token from DB (only if not already in env)
  if (!cleanEnv.ANTHROPIC_API_KEY && !cleanEnv.CLAUDE_CODE_OAUTH_TOKEN) {
    const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeToken') as { value: string } | undefined;
    if (tokenRow?.value) {
      if (tokenRow.value.startsWith('sk-ant-oat')) {
        cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = tokenRow.value;
      } else if (tokenRow.value.startsWith('sk-ant-api')) {
        cleanEnv.ANTHROPIC_API_KEY = tokenRow.value;
      } else {
        console.warn(`[skillRunner] Stored Claude token has unrecognized prefix, skipping injection`);
      }
    }
  }

  const child = spawn('claude', [
    '-p', prompt,
    '--append-system-prompt', skillContent,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ], {
    cwd: projectPath,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnv,
  });

  const info: SkillRun = {
    process: child,
    skill,
    output: [],
    totalLines: 0,
    startedAt: new Date(),
    status: 'running',
    exitCode: null,
    stoppedByUser: false,
  };

  const appendLine = (line: string) => {
    info.output.push(line);
    info.totalLines++;
    if (info.output.length > MAX_OUTPUT_LINES) {
      info.output.shift();
    }
  };

  // Buffer partial lines from stream chunks
  let stdoutBuffer = '';
  child.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    // Keep the last element (may be incomplete)
    stdoutBuffer = lines.pop() || '';
    for (const raw of lines) {
      const parsed = parseStreamJsonLine(raw);
      if (parsed) {
        // A parsed message can itself be multi-line
        for (const part of parsed.split('\n')) {
          if (part.trim()) appendLine(part);
        }
      }
    }
  });

  // Stderr goes through as-is (error messages, warnings)
  let stderrBuffer = '';
  child.stderr?.on('data', (data: Buffer) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) appendLine(line);
    }
  });

  child.on('close', (code) => {
    // Flush any remaining stdout buffer
    if (stdoutBuffer.trim()) {
      const parsed = parseStreamJsonLine(stdoutBuffer.trim());
      if (parsed) {
        for (const part of parsed.split('\n')) {
          if (part.trim()) appendLine(part);
        }
      }
    }

    // Flush any remaining stderr buffer
    if (stderrBuffer.trim()) {
      appendLine(stderrBuffer.trim());
    }

    const current = skillRuns.get(projectId);
    if (current && current.process === child && !current.stoppedByUser) {
      current.status = code === 0 ? 'completed' : 'failed';
      current.exitCode = code;
    }
  });

  child.on('error', () => {
    const current = skillRuns.get(projectId);
    if (current && current.process === child) {
      current.status = 'failed';
      current.exitCode = -1;
    }
  });

  skillRuns.set(projectId, info);
  return true;
}

export function stopSkill(projectId: number): boolean {
  const info = skillRuns.get(projectId);
  if (!info || info.status !== 'running') return false;

  try {
    if (info.process.pid) {
      process.kill(-info.process.pid, 'SIGTERM');
    }
  } catch {
    info.process.kill('SIGTERM');
  }

  info.stoppedByUser = true;
  info.status = 'failed';
  info.exitCode = -1;
  return true;
}

export function clearSkillRun(projectId: number): void {
  const info = skillRuns.get(projectId);
  if (info && info.status !== 'running') {
    skillRuns.delete(projectId);
  }
}

export function getSkillStatus(projectId: number): {
  running: boolean;
  skill: SkillName | null;
  status: 'running' | 'completed' | 'failed' | null;
  startedAt?: string;
  exitCode: number | null;
} {
  const info = skillRuns.get(projectId);
  if (!info) return { running: false, skill: null, status: null, exitCode: null };
  return {
    running: info.status === 'running',
    skill: info.skill,
    status: info.status,
    startedAt: info.startedAt.toISOString(),
    exitCode: info.exitCode,
  };
}

export function getSkillOutput(projectId: number, since = 0): { lines: string[]; total: number } {
  const info = skillRuns.get(projectId);
  if (!info) return { lines: [], total: since };
  const bufferStart = info.totalLines - info.output.length;
  const bufferOffset = Math.max(0, since - bufferStart);
  return { lines: info.output.slice(bufferOffset), total: info.totalLines };
}
