import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ralphPath') as { value: string } | undefined;
  res.json({ ralphPath: row?.value || null });
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
