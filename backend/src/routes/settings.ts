import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ralphPath') as { value: string } | undefined;
  const isDocker = process.env.RALPH_DOCKER === 'true' || process.env.RALPH_DOCKER === '1';

  const response: Record<string, unknown> = {
    ralphPath: row?.value || null,
    isDocker,
  };

  if (isDocker) {
    const nameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserName') as { value: string } | undefined;
    const emailRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('gitUserEmail') as { value: string } | undefined;
    response.gitUserName = nameRow?.value || null;
    response.gitUserEmail = emailRow?.value || null;
    response.gitConfigured = !!(nameRow?.value && emailRow?.value);
  }

  res.json(response);
});

settingsRouter.put('/', (req, res) => {
  const { ralphPath } = req.body;

  if (!ralphPath || typeof ralphPath !== 'string') {
    return res.status(400).json({ error: 'ralphPath is required' });
  }

  const expandedPath = ralphPath.replace(/^~/, process.env.HOME || '');

  if (!fs.existsSync(expandedPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }

  if (!fs.existsSync(path.join(expandedPath, 'ralph-cc.sh'))) {
    return res.status(400).json({ error: 'ralph-cc.sh not found in the specified path' });
  }

  if (!fs.existsSync(path.join(expandedPath, 'skills', 'ralph', 'SKILL.md'))) {
    return res.status(400).json({ error: 'skills/ralph/SKILL.md not found in the specified path' });
  }

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('ralphPath', expandedPath);

  res.json({ ralphPath: expandedPath });
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

