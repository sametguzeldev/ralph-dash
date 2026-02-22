import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ralphPath') as { value: string } | undefined;
  const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeToken') as { value: string } | undefined;
  res.json({
    ralphPath: row?.value || null,
    isDocker: !!process.env.RALPH_DOCKER,
    claudeConfigured: !!tokenRow?.value,
  });
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

// Claude token management (Docker authentication)
settingsRouter.put('/claude-token', (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const trimmed = token.trim();

  if (!trimmed.startsWith('sk-ant-api') && !trimmed.startsWith('sk-ant-oat')) {
    return res.status(400).json({ error: 'Token must start with sk-ant-api (API key) or sk-ant-oat (OAuth token)' });
  }

  const tokenType = trimmed.startsWith('sk-ant-oat') ? 'oauth' : 'api-key';

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claudeToken', trimmed);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('claudeTokenType', tokenType);

  // For OAuth tokens, merge hasCompletedOnboarding into ~/.claude.json
  if (tokenType === 'oauth') {
    try {
      const homeDir = process.env.HOME || '/home/node';
      const claudeJsonPath = path.join(homeDir, '.claude.json');
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
      } catch {
        // File doesn't exist or is invalid — start fresh
      }
      existing.hasCompletedOnboarding = true;
      fs.writeFileSync(claudeJsonPath, JSON.stringify(existing, null, 2));
    } catch (err) {
      console.error('Failed to write ~/.claude.json:', err);
    }
  }

  res.json({ success: true, tokenType });
});

settingsRouter.delete('/claude-token', (_req, res) => {
  const typeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeTokenType') as { value: string } | undefined;
  const wasOAuth = typeRow?.value === 'oauth';

  db.prepare('DELETE FROM settings WHERE key = ?').run('claudeToken');
  db.prepare('DELETE FROM settings WHERE key = ?').run('claudeTokenType');

  // Only clean up ~/.claude.json if the deleted token was OAuth-type
  if (wasOAuth) try {
    const homeDir = process.env.HOME || '/home/node';
    const claudeJsonPath = path.join(homeDir, '.claude.json');
    const raw = fs.readFileSync(claudeJsonPath, 'utf-8');
    const existing = JSON.parse(raw);
    delete existing.hasCompletedOnboarding;
    if (Object.keys(existing).length === 0) {
      fs.unlinkSync(claudeJsonPath);
    } else {
      fs.writeFileSync(claudeJsonPath, JSON.stringify(existing, null, 2));
    }
  } catch {
    // File doesn't exist or couldn't be updated — no-op
  }

  res.json({ success: true });
});
