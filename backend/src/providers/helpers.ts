import fs from 'fs';
import path from 'path';
import { ProviderError } from './providerError.js';

export function compactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function getRalphPath(providerName: string): string {
  const configured = process.env.RALPH_PATH;
  if (!configured) {
    throw new ProviderError('not-configured', providerName, 'RALPH_PATH is not configured');
  }
  return path.resolve(configured);
}

export function readSkillFile(providerName: string, skillPath: string): string {
  if (!fs.existsSync(skillPath)) {
    throw new ProviderError('artifact-missing', providerName, `Skill file not found: ${skillPath}`);
  }
  return fs.readFileSync(skillPath, 'utf-8');
}

/**
 * Clone process.env, drop CLAUDECODE, and layer in provider-specific env vars
 * without overwriting anything already set on the parent process.
 */
export function cloneRunEnv(extras: Record<string, string>): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  for (const [key, value] of Object.entries(extras)) {
    if (!env[key]) env[key] = value;
  }
  return env;
}
