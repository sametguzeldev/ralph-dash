import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeProvider, parseStreamJsonLine } from './claude.js';
import { CodexProvider } from './codex.js';
import { OpenCodeProvider } from './opencode.js';
import { ProviderError } from './providerError.js';
import type { ProviderConfig } from './types.js';
import type { RunSpec } from '../services/processRun.js';
import type { SkillName } from '../services/skills/types.js';

const SKILLS: SkillName[] = ['prd-questions', 'prd', 'ralph'];
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CODEX_API_KEY',
  'CODEX_MODEL',
  'OPENAI_API_KEY',
  'OPENCODE_MODEL',
];

function normalizePaths<T>(value: T, replacements: Record<string, string>): T {
  if (typeof value === 'string') {
    let normalized = value;
    for (const [from, to] of Object.entries(replacements)) {
      normalized = normalized.split(from).join(to);
    }
    return normalized as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePaths(item, replacements)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizePaths(entry, replacements)]),
    ) as T;
  }

  return value;
}

function stableSpec(spec: RunSpec, envKeys: string[] = [], replacements: Record<string, string> = {}) {
  return normalizePaths({
    ...spec,
    env: Object.fromEntries(envKeys.map((key) => [key, spec.env[key]]).filter(([, value]) => value !== undefined)),
    parseLine: spec.parseLine?.name,
  }, replacements);
}

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    token: 'test-token',
    tokenType: 'api-key',
    model: 'db-model',
    autoMemoryEnabled: true,
    ...overrides,
  };
}

function writeSkill(projectPath: string, providerSkillRoot: string, skill: SkillName, content: string): void {
  const skillPath = path.join(projectPath, providerSkillRoot, skill, 'SKILL.md');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, content);
}

function expectMissingSkill(fn: () => unknown, providerName: string): void {
  expect(fn).toThrow(ProviderError);
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({
      kind: 'artifact-missing',
      providerName,
    });
  }
}

describe('provider descriptions', () => {
  let projectPath: string;
  let ralphPath: string;
  let previousRalphPath: string | undefined;
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-project-'));
    ralphPath = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-ralph-'));
    previousRalphPath = process.env.RALPH_PATH;
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    process.env.RALPH_PATH = ralphPath;
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(ralphPath, { recursive: true, force: true });
    if (previousRalphPath === undefined) {
      delete process.env.RALPH_PATH;
    } else {
      process.env.RALPH_PATH = previousRalphPath;
    }
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  });

  describe('ClaudeProvider', () => {
    const provider = new ClaudeProvider();

    it('describes loop runs with stable env and args', () => {
      expect(stableSpec(provider.describeLoop(makeConfig(), 'variant-model', projectPath), [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_MODEL',
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
      ], { [projectPath]: '<project>' })).toMatchInlineSnapshot(`
        {
          "args": [
            "<project>/scripts/ralph/ralph-cc.sh",
            "--model",
            "variant-model",
          ],
          "command": "bash",
          "cwd": "<project>",
          "env": {
            "ANTHROPIC_API_KEY": "test-token",
            "ANTHROPIC_MODEL": "variant-model",
          },
          "kind": "loop",
          "parseLine": undefined,
        }
      `);

      expect(stableSpec(provider.describeLoop(makeConfig({ token: undefined, tokenType: undefined, autoMemoryEnabled: false }), undefined, projectPath), [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_MODEL',
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
      ], { [projectPath]: '<project>' })).toMatchInlineSnapshot(`
        {
          "args": [
            "<project>/scripts/ralph/ralph-cc.sh",
            "--model",
            "db-model",
          ],
          "command": "bash",
          "cwd": "<project>",
          "env": {
            "ANTHROPIC_MODEL": "db-model",
            "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
          },
          "kind": "loop",
          "parseLine": undefined,
        }
      `);
    });

    it('describes skill runs for every skill and rejects missing files', () => {
      const specs = SKILLS.map((skill) => {
        writeSkill(projectPath, '.claude/skills', skill, `Claude skill content for ${skill}`);
        return stableSpec(provider.describeSkill(makeConfig(), 'variant-model', projectPath, skill, 'Skill prompt'), [
          'ANTHROPIC_API_KEY',
          'ANTHROPIC_MODEL',
        ], { [projectPath]: '<project>' });
      });

      expect(specs).toMatchInlineSnapshot(`
        [
          {
            "args": [
              "-p",
              "Skill prompt",
              "--append-system-prompt",
              "Claude skill content for prd-questions",
              "--dangerously-skip-permissions",
              "--output-format",
              "stream-json",
              "--verbose",
              "--model",
              "variant-model",
            ],
            "command": "claude",
            "cwd": "<project>",
            "env": {
              "ANTHROPIC_API_KEY": "test-token",
              "ANTHROPIC_MODEL": "variant-model",
            },
            "kind": "skill",
            "parseLine": "parseStreamJsonLine",
            "skillName": "prd-questions",
          },
          {
            "args": [
              "-p",
              "Skill prompt",
              "--append-system-prompt",
              "Claude skill content for prd",
              "--dangerously-skip-permissions",
              "--output-format",
              "stream-json",
              "--verbose",
              "--model",
              "variant-model",
            ],
            "command": "claude",
            "cwd": "<project>",
            "env": {
              "ANTHROPIC_API_KEY": "test-token",
              "ANTHROPIC_MODEL": "variant-model",
            },
            "kind": "skill",
            "parseLine": "parseStreamJsonLine",
            "skillName": "prd",
          },
          {
            "args": [
              "-p",
              "Skill prompt",
              "--append-system-prompt",
              "Claude skill content for ralph",
              "--dangerously-skip-permissions",
              "--output-format",
              "stream-json",
              "--verbose",
              "--model",
              "variant-model",
            ],
            "command": "claude",
            "cwd": "<project>",
            "env": {
              "ANTHROPIC_API_KEY": "test-token",
              "ANTHROPIC_MODEL": "variant-model",
            },
            "kind": "skill",
            "parseLine": "parseStreamJsonLine",
            "skillName": "ralph",
          },
        ]
      `);

      for (const skill of SKILLS) {
        fs.rmSync(path.join(projectPath, '.claude', 'skills', skill), { recursive: true, force: true });
        expectMissingSkill(
          () => provider.describeSkill(makeConfig(), 'variant-model', projectPath, skill, 'Skill prompt'),
          'claude',
        );
      }
    });

    it('exports the Claude stream-json parser', () => {
      expect(parseStreamJsonLine(JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      }))).toBe('Hello');
    });

    it('describes its sync manifest', () => {
      expect(normalizePaths(provider.syncManifest(), { [ralphPath]: '<ralph>' })).toMatchInlineSnapshot(`
        [
          {
            "destRelative": ".claude/skills/prd/SKILL.md",
            "sourcePath": "<ralph>/skills/prd/SKILL.md",
          },
          {
            "destRelative": ".claude/skills/prd-questions/SKILL.md",
            "sourcePath": "<ralph>/skills/prd-questions/SKILL.md",
          },
          {
            "destRelative": ".claude/skills/ralph/SKILL.md",
            "sourcePath": "<ralph>/skills/ralph/SKILL.md",
          },
          {
            "destRelative": "scripts/ralph/ralph-cc.sh",
            "executable": true,
            "sourcePath": "<ralph>/scripts/ralph/ralph-cc.sh",
          },
          {
            "destRelative": "scripts/ralph/CLAUDE.md",
            "sourcePath": "<ralph>/scripts/ralph/CLAUDE.md",
          },
        ]
      `);
    });
  });

  describe('CodexProvider', () => {
    const provider = new CodexProvider();

    it('describes loop runs with stable env and args', () => {
      expect(stableSpec(provider.describeLoop(makeConfig(), 'variant-model', projectPath), ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_MODEL'], { [projectPath]: '<project>' })).toMatchInlineSnapshot(`
        {
          "args": [
            "<project>/scripts/ralph/ralph-codex.sh",
          ],
          "command": "bash",
          "cwd": "<project>",
          "env": {
            "CODEX_API_KEY": "test-token",
            "CODEX_MODEL": "variant-model",
            "OPENAI_API_KEY": "test-token",
          },
          "kind": "loop",
          "parseLine": undefined,
        }
      `);
      expect(stableSpec(provider.describeLoop(makeConfig({ token: undefined, tokenType: 'chatgpt' }), undefined, projectPath), ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_MODEL'], { [projectPath]: '<project>' })).toMatchInlineSnapshot(`
        {
          "args": [
            "<project>/scripts/ralph/ralph-codex.sh",
          ],
          "command": "bash",
          "cwd": "<project>",
          "env": {
            "CODEX_MODEL": "db-model",
          },
          "kind": "loop",
          "parseLine": undefined,
        }
      `);
    });

    it('describes skill runs for every skill and rejects missing files', () => {
      const specs = SKILLS.map((skill) => {
        writeSkill(projectPath, '.agents/skills', skill, `Codex skill content for ${skill}`);
        return stableSpec(
          provider.describeSkill(makeConfig(), 'variant-model', projectPath, skill, 'Skill prompt'),
          ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_MODEL'],
          { [projectPath]: '<project>' },
        );
      });

      expect(specs).toMatchInlineSnapshot(`
        [
          {
            "args": [
              "exec",
              "--sandbox",
              "workspace-write",
              "--ask-for-approval",
              "never",
              "--model",
              "variant-model",
              "Codex skill content for prd-questions

        Skill prompt",
            ],
            "command": "codex",
            "cwd": "<project>",
            "env": {
              "CODEX_API_KEY": "test-token",
              "CODEX_MODEL": "variant-model",
              "OPENAI_API_KEY": "test-token",
            },
            "kind": "skill",
            "parseLine": undefined,
            "skillName": "prd-questions",
          },
          {
            "args": [
              "exec",
              "--sandbox",
              "workspace-write",
              "--ask-for-approval",
              "never",
              "--model",
              "variant-model",
              "Codex skill content for prd

        Skill prompt",
            ],
            "command": "codex",
            "cwd": "<project>",
            "env": {
              "CODEX_API_KEY": "test-token",
              "CODEX_MODEL": "variant-model",
              "OPENAI_API_KEY": "test-token",
            },
            "kind": "skill",
            "parseLine": undefined,
            "skillName": "prd",
          },
          {
            "args": [
              "exec",
              "--sandbox",
              "workspace-write",
              "--ask-for-approval",
              "never",
              "--model",
              "variant-model",
              "Codex skill content for ralph

        Skill prompt",
            ],
            "command": "codex",
            "cwd": "<project>",
            "env": {
              "CODEX_API_KEY": "test-token",
              "CODEX_MODEL": "variant-model",
              "OPENAI_API_KEY": "test-token",
            },
            "kind": "skill",
            "parseLine": undefined,
            "skillName": "ralph",
          },
        ]
      `);

      for (const skill of SKILLS) {
        fs.rmSync(path.join(projectPath, '.agents', 'skills', skill), { recursive: true, force: true });
        expectMissingSkill(
          () => provider.describeSkill(makeConfig(), 'variant-model', projectPath, skill, 'Skill prompt'),
          'codex',
        );
      }
    });

    it('describes its sync manifest', () => {
      expect(normalizePaths(provider.syncManifest(), { [ralphPath]: '<ralph>' })).toMatchInlineSnapshot(`
        [
          {
            "destRelative": ".agents/skills/prd/SKILL.md",
            "sourcePath": "<ralph>/skills/prd/SKILL.md",
          },
          {
            "destRelative": ".agents/skills/prd-questions/SKILL.md",
            "sourcePath": "<ralph>/skills/prd-questions/SKILL.md",
          },
          {
            "destRelative": ".agents/skills/ralph/SKILL.md",
            "sourcePath": "<ralph>/skills/ralph/SKILL.md",
          },
          {
            "destRelative": "scripts/ralph/ralph-codex.sh",
            "executable": true,
            "sourcePath": "<ralph>/scripts/ralph/ralph-codex.sh",
          },
          {
            "destRelative": "AGENTS.md",
            "sourcePath": "<ralph>/scripts/ralph/AGENTS.md",
          },
        ]
      `);
    });
  });

  describe('OpenCodeProvider', () => {
    const provider = new OpenCodeProvider();

    it('describes loop runs with stable env and args', () => {
      expect(stableSpec(provider.describeLoop(makeConfig({ envVarName: 'OPENAI_API_KEY' }), 'variant-model', projectPath), ['OPENAI_API_KEY', 'OPENCODE_MODEL'], { [projectPath]: '<project>' })).toMatchInlineSnapshot(`
        {
          "args": [
            "<project>/scripts/ralph/ralph-opencode.sh",
            "--yolo",
          ],
          "command": "bash",
          "cwd": "<project>",
          "env": {
            "OPENAI_API_KEY": "test-token",
            "OPENCODE_MODEL": "variant-model",
          },
          "kind": "loop",
          "parseLine": undefined,
        }
      `);
      expect(stableSpec(provider.describeLoop(makeConfig({ token: undefined, envVarName: undefined }), undefined, projectPath), ['OPENAI_API_KEY', 'OPENCODE_MODEL'], { [projectPath]: '<project>' })).toMatchInlineSnapshot(`
        {
          "args": [
            "<project>/scripts/ralph/ralph-opencode.sh",
            "--yolo",
          ],
          "command": "bash",
          "cwd": "<project>",
          "env": {
            "OPENCODE_MODEL": "db-model",
          },
          "kind": "loop",
          "parseLine": undefined,
        }
      `);
    });

    it.each(SKILLS)('rejects unsupported skill run for %s', (skill) => {
      expect(() => provider.describeSkill(makeConfig(), 'variant-model', projectPath, skill, 'Skill prompt')).toThrow(ProviderError);
      try {
        provider.describeSkill(makeConfig(), 'variant-model', projectPath, skill, 'Skill prompt');
      } catch (error) {
        expect(error).toMatchObject({
          kind: 'not-configured',
          providerName: 'opencode',
        });
      }
    });

    it('describes its sync manifest', () => {
      expect(normalizePaths(provider.syncManifest(), { [ralphPath]: '<ralph>' })).toMatchInlineSnapshot(`
        [
          {
            "destRelative": "scripts/ralph/ralph-opencode.sh",
            "executable": true,
            "sourcePath": "<ralph>/scripts/ralph/ralph-opencode.sh",
          },
          {
            "destRelative": "OPENCODE.md",
            "sourcePath": "<ralph>/scripts/ralph/OPENCODE.md",
          },
        ]
      `);
    });
  });
});
