import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { ProviderError } from '../providers/providerError.js';
import { getProvider, loadProviderConfig, buildRunEnv, DEFAULT_PROVIDER } from '../providers/registry.js';
import { getSkill, type SkillName, type SkillParams } from './skills/registry.js';
import * as processRun from './processRun.js';
import type { StartResult } from './processRun.js';

export type { SkillName } from './skills/registry.js';

function readSkillFile(projectPath: string, skill: SkillName, providerName: string): string {
  const skillPath = path.join(projectPath, '.claude', 'skills', skill, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new ProviderError('artifact-missing', providerName, `Skill file not found: ${skillPath}`);
  }
  return fs.readFileSync(skillPath, 'utf-8');
}

/**
 * Parse a stream-json line from claude CLI and extract a human-readable message.
 * Returns null if the line has no useful display content.
 */
export function parseStreamJsonLine(raw: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON - return raw line as-is (stderr or other output)
    return raw.trim() || null;
  }

  const type = parsed.type as string | undefined;

  // Init event
  if (type === 'system' && parsed.subtype === 'init') {
    return '⏳ Claude session started...';
  }

  // Assistant message - extract text and tool_use summaries
  if (type === 'assistant' && parsed.message) {
    const msg = parsed.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!content) return null;

    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
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

function ensureProviderConfigured(providerName: string): void {
  try {
    getProvider(providerName);
  } catch {
    throw new ProviderError('invalid-config', providerName, `Unknown provider: ${providerName}`);
  }

  const providerRow = db.prepare('SELECT is_configured FROM providers WHERE name = ?').get(providerName) as
    { is_configured: number } | undefined;

  if (!providerRow) {
    throw new ProviderError(
      'not-configured',
      providerName,
      `Provider '${providerName}' is not configured. Please add a token on the Models page first.`,
    );
  }

  if (!providerRow.is_configured) {
    throw new ProviderError(
      'not-configured',
      providerName,
      `Provider '${providerName}' is not configured. Please configure authentication on the Models page first.`,
    );
  }
}

export function startSkill(
  projectId: number,
  projectPath: string,
  skillName: string,
  params: SkillParams,
  providerName?: string,
  modelVariant?: string,
): StartResult {
  const existingRun = processRun.status(projectId);
  if (existingRun.running && existingRun.kind) {
    return { ok: false, conflictKind: existingRun.kind };
  }

  const skill = getSkill(skillName);

  const effectiveProvider = providerName || DEFAULT_PROVIDER;
  ensureProviderConfigured(effectiveProvider);

  const provider = getProvider(effectiveProvider);
  const providerConfig = loadProviderConfig(effectiveProvider);
  const cleanEnv = buildRunEnv(effectiveProvider, modelVariant, providerConfig);
  const skillContent = readSkillFile(projectPath, skill.name, effectiveProvider);
  const prompt = skill.buildPrompt(params);

  const cliArgs = [
    '-p', prompt,
    '--append-system-prompt', skillContent,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    ...provider.getCliArgs(providerConfig, modelVariant),
  ];

  return processRun.start(projectId, {
    kind: 'skill',
    skillName: skill.name,
    command: 'claude',
    args: cliArgs,
    cwd: projectPath,
    env: cleanEnv,
    parseLine: parseStreamJsonLine,
  });
}

export function stopSkill(projectId: number): boolean {
  return processRun.stop(projectId, 'skill');
}

export function getSkillStatus(projectId: number): {
  running: boolean;
  skill: SkillName | null;
  status: 'running' | 'completed' | 'failed' | null;
  startedAt?: string;
  exitCode: number | null;
} {
  const status = processRun.status(projectId, 'skill');
  return {
    running: status.running,
    skill: status.skillName ?? null,
    status: status.status ?? null,
    startedAt: status.startedAt,
    exitCode: status.exitCode ?? null,
  };
}

export function getSkillOutput(projectId: number, since = 0): { lines: string[]; total: number } {
  return processRun.output(projectId, since, 'skill');
}
