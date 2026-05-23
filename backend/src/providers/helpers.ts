import fs from 'fs';
import { ProviderError } from './providerError.js';

export function compactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function readSkillFile(providerName: string, skillPath: string): string {
  if (!fs.existsSync(skillPath)) {
    throw new ProviderError('artifact-missing', providerName, `Skill file not found: ${skillPath}`);
  }
  return fs.readFileSync(skillPath, 'utf-8');
}

export function ensureExecutableFile(providerName: string, filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new ProviderError('artifact-missing', providerName, `${label} not found: ${filePath}. Try "Sync Files" first.`);
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      throw new ProviderError('artifact-missing', providerName, `${label} is not executable and chmod failed: ${filePath}`);
    }
  }
}

/**
 * Clone process.env, drop CLAUDECODE, and layer in provider-specific env vars
 * without overwriting anything already set on the parent process.
 */
export function cloneRunEnv(extras: Record<string, string>): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  for (const [key, value] of Object.entries(extras)) {
    if (env[key] === undefined) env[key] = value;
  }

  return env;
}
