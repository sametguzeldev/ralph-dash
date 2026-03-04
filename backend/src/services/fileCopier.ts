import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { getProvider, DEFAULT_PROVIDER } from '../providers/registry.js';

/** Map provider name to the directory where skills are placed in a project. */
function getSkillsDir(providerName: string): string {
  if (providerName === 'codex') return '.agents/skills';
  return '.claude/skills';
}

/** Read a JSON array setting from the DB, returning [] on missing/invalid. */
function getJsonArraySetting(key: string): string[] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function copyRalphFiles(ralphPath: string, projectRoot: string, providerName: string = DEFAULT_PROVIDER) {
  const selectedSkills = getJsonArraySetting('selectedSkills');
  const selectedProviders = getJsonArraySetting('selectedProviders');

  const filesToSync: { source: string; dest: string }[] = [];
  const seenDests = new Set<string>();

  function addFile(source: string, dest: string) {
    if (!seenDests.has(dest)) {
      seenDests.add(dest);
      filesToSync.push({ source, dest });
    }
  }

  // Skills: for each selected provider, add selected skills to that provider's skills directory
  for (const provName of selectedProviders) {
    const skillsDir = getSkillsDir(provName);
    for (const skill of selectedSkills) {
      addFile(
        path.join(ralphPath, 'skills', skill, 'SKILL.md'),
        path.join(skillsDir, skill, 'SKILL.md'),
      );
    }
  }

  // CLAUDE.md: only when Claude is a selected provider
  if (selectedProviders.includes('claude')) {
    addFile(
      path.join(ralphPath, 'scripts', 'ralph', 'CLAUDE.md'),
      path.join('scripts', 'ralph', 'CLAUDE.md'),
    );
  }

  // Runner script: always for the project's own provider
  const provider = getProvider(providerName);
  addFile(
    path.join(ralphPath, 'scripts', 'ralph', provider.runnerScript),
    path.join('scripts', 'ralph', provider.runnerScript),
  );

  // Copy all collected files
  for (const file of filesToSync) {
    const src = file.source;
    const dest = path.join(projectRoot, file.dest);

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      // Make shell scripts executable
      if (dest.endsWith('.sh')) {
        fs.chmodSync(dest, 0o755);
      }
    }
  }
}
