import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { getProvider, DEFAULT_PROVIDER } from '../providers/registry.js';
import type { FileSyncEntry } from '../providers/types.js';

/** Validate skill name to prevent path traversal. */
function isValidSkillName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
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

/**
 * Extract the skill name from a sync entry that points at a SKILL.md file.
 * Returns null if the entry is not a skill file.
 */
function skillNameForEntry(entry: FileSyncEntry): string | null {
  for (const candidate of [entry.sourcePath, entry.destRelative]) {
    const parts = candidate.split(path.sep);
    if (parts.at(-1) !== 'SKILL.md') continue;
    const skillsIndex = parts.lastIndexOf('skills');
    if (skillsIndex >= 0 && parts[skillsIndex + 1]) {
      return parts[skillsIndex + 1];
    }
  }
  return null;
}

export function copyRalphFiles(ralphPath: string, projectRoot: string, providerName: string = DEFAULT_PROVIDER) {
  const selectedSkills = getJsonArraySetting('selectedSkills').filter((skill) => {
    if (isValidSkillName(skill)) return true;
    console.warn(`Skipping invalid skill name: ${skill}`);
    return false;
  });
  const selectedProviders = new Set(getJsonArraySetting('selectedProviders'));
  selectedProviders.add(providerName);
  const selectedSkillSet = new Set(selectedSkills);

  const filesToSync: FileSyncEntry[] = [];
  const seenDests = new Set<string>();

  for (const provName of selectedProviders) {
    const provider = getProvider(provName);
    for (const entry of provider.syncManifest(ralphPath)) {
      const skillName = skillNameForEntry(entry);
      if (skillName && !selectedSkillSet.has(skillName)) continue;
      if (seenDests.has(entry.destRelative)) continue;
      seenDests.add(entry.destRelative);
      filesToSync.push(entry);
    }
  }

  for (const file of filesToSync) {
    const dest = path.join(projectRoot, file.destRelative);
    if (!fs.existsSync(file.sourcePath)) continue;

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.sourcePath, dest);
    if (file.executable) {
      fs.chmodSync(dest, 0o755);
    }
  }
}
