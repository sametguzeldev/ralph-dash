import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from '../db/connection.js';
import { getAllProviders } from '../providers/registry.js';

export const settingsRouter = Router();

const VALID_SKILLS = ['prd', 'prd-questions', 'ralph'];

function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function parseJsonArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

settingsRouter.get('/', (_req, res) => {
  const isDocker = process.env.RALPH_DOCKER === 'true' || process.env.RALPH_DOCKER === '1';

  const response: Record<string, unknown> = {
    ralphPath: getSetting('ralphPath') || null,
    isDocker,
    selectedProviders: parseJsonArray(getSetting('selectedProviders')),
    selectedSkills: parseJsonArray(getSetting('selectedSkills')),
  };

  if (isDocker) {
    const gitName = getSetting('gitUserName');
    const gitEmail = getSetting('gitUserEmail');
    response.gitUserName = gitName || null;
    response.gitUserEmail = gitEmail || null;
    response.gitConfigured = !!(gitName && gitEmail);
  }

  res.json(response);
});

settingsRouter.put('/', (req, res) => {
  const { ralphPath, selectedProviders, selectedSkills } = req.body;
  let expandedPath: string | undefined;

  // Validate all fields first, before any DB writes

  // ralphPath is optional now — only validate if provided
  if (ralphPath !== undefined) {
    if (typeof ralphPath !== 'string' || !ralphPath) {
      return res.status(400).json({ error: 'ralphPath must be a non-empty string' });
    }

    expandedPath = ralphPath.replace(/^~/, os.homedir());

    if (!fs.existsSync(expandedPath)) {
      return res.status(400).json({ error: 'Path does not exist' });
    }

    if (!fs.existsSync(path.join(expandedPath, 'ralph-cc.sh'))) {
      return res.status(400).json({ error: 'ralph-cc.sh not found in the specified path' });
    }

    if (!fs.existsSync(path.join(expandedPath, 'skills', 'ralph', 'SKILL.md'))) {
      return res.status(400).json({ error: 'skills/ralph/SKILL.md not found in the specified path' });
    }
  }

  // Validate selectedProviders if provided
  if (selectedProviders !== undefined) {
    if (!Array.isArray(selectedProviders)) {
      return res.status(400).json({ error: 'selectedProviders must be an array' });
    }
    if (selectedProviders.length === 0) {
      return res.status(400).json({ error: 'At least one provider must be selected' });
    }
    const validProviderNames = getAllProviders().map(p => p.name);
    const invalid = selectedProviders.filter((p: unknown) => typeof p !== 'string' || !validProviderNames.includes(p as string));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid provider(s): ${invalid.join(', ')}` });
    }
  }

  // Validate selectedSkills if provided
  if (selectedSkills !== undefined) {
    if (!Array.isArray(selectedSkills)) {
      return res.status(400).json({ error: 'selectedSkills must be an array' });
    }
    // Skills are optional — empty array is valid (no skills synced)
    const invalid = selectedSkills.filter((s: unknown) => typeof s !== 'string' || !VALID_SKILLS.includes(s as string));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Invalid skill(s): ${invalid.join(', ')}. Valid skills: ${VALID_SKILLS.join(', ')}` });
    }
  }

  // All validations passed — persist in a single transaction
  const persist = db.transaction(() => {
    if (expandedPath !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ralphPath', expandedPath);
    }
    if (selectedProviders !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        'selectedProviders',
        JSON.stringify(selectedProviders)
      );
    }
    if (selectedSkills !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        'selectedSkills',
        JSON.stringify(selectedSkills)
      );
    }
  });
  persist();

  // Return current state
  const result: Record<string, unknown> = {};
  const currentRalphPath = getSetting('ralphPath');
  if (currentRalphPath) result.ralphPath = currentRalphPath;
  result.selectedProviders = parseJsonArray(getSetting('selectedProviders'));
  result.selectedSkills = parseJsonArray(getSetting('selectedSkills'));

  res.json(result);
});

// Git config management (Docker only)
settingsRouter.put('/git-config', (req, res) => {
  const isDocker = process.env.RALPH_DOCKER === 'true' || process.env.RALPH_DOCKER === '1';
  if (!isDocker) {
    return res.status(403).json({ error: 'Git config is only available in Docker mode' });
  }
  const { name, email } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name is required and must be non-empty' });
  }

  if (!email || typeof email !== 'string' || !/^[^@]+@[^@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'email must be a valid email address' });
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('gitUserName', trimmedName);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('gitUserEmail', trimmedEmail);

  res.json({ success: true, name: trimmedName, email: trimmedEmail });
});

settingsRouter.delete('/git-config', (_req, res) => {
  const isDocker = process.env.RALPH_DOCKER === 'true' || process.env.RALPH_DOCKER === '1';
  if (!isDocker) {
    return res.status(403).json({ error: 'Git config is only available in Docker mode' });
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run('gitUserName');
  db.prepare('DELETE FROM settings WHERE key = ?').run('gitUserEmail');

  res.json({ success: true });
});

