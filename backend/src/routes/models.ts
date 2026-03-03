import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import type { ProviderRow } from '../db/types.js';

export const modelsRouter = Router();

function getProviderRow(name: string): ProviderRow | undefined {
  return db.prepare('SELECT * FROM providers WHERE name = ?').get(name) as ProviderRow | undefined;
}

function updateProviderConfig(name: string, config: Record<string, unknown>): void {
  db.prepare('UPDATE providers SET config = ? WHERE name = ?').run(JSON.stringify(config), name);
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function setClaudeOnboarding(value: boolean): void {
  try {
    const homeDir = process.env.HOME || '/home/node';
    const claudeJsonPath = path.join(homeDir, '.claude.json');
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    existing.hasCompletedOnboarding = value;
    fs.writeFileSync(claudeJsonPath, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error('Failed to update ~/.claude.json:', err);
  }
}

function sanitizeProviderConfig(raw: string | null): Record<string, unknown> {
  const config = parseConfig(raw);
  const safe: Record<string, unknown> = {};

  if (typeof config.claudeModel === 'string' && config.claudeModel.trim()) {
    safe.claudeModel = config.claudeModel;
  }

  if (Array.isArray(config.modelVariants) && (config.modelVariants as unknown[]).every((v) => typeof v === 'string')) {
    safe.modelVariants = config.modelVariants;
  }

  if (typeof config.defaultVariant === 'string' && config.defaultVariant.trim()) {
    safe.defaultVariant = config.defaultVariant;
  }

  if (config.preferences && typeof config.preferences === 'object' && !Array.isArray(config.preferences)) {
    safe.preferences = config.preferences;
  } else {
    safe.preferences = {};
  }

  if (typeof config.envVarName === 'string' && config.envVarName.trim()) {
    safe.envVarName = config.envVarName;
  }

  return safe;
}

// GET /api/models — list all providers
modelsRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM providers').all() as ProviderRow[];
  const providers = rows.map((row) => ({
    id: row.id,
    name: row.name,
    runner_script: row.runner_script,
    is_configured: !!row.is_configured,
    config: sanitizeProviderConfig(row.config),
  }));
  res.json(providers);
});

// GET /api/models/:provider — single provider's full configuration
modelsRouter.get('/:provider', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  res.json({
    id: row.id,
    name: row.name,
    runner_script: row.runner_script,
    is_configured: !!row.is_configured,
    config: sanitizeProviderConfig(row.config),
  });
});

// PUT /api/models/:provider/token — save auth token
modelsRouter.put('/:provider/token', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const trimmed = token.trim();

  // Claude-specific token validation
  if (row.name === 'claude') {
    if (!trimmed.startsWith('sk-ant-api') && !trimmed.startsWith('sk-ant-oat')) {
      return res.status(400).json({ error: 'Token must start with sk-ant-api (API key) or sk-ant-oat (OAuth token)' });
    }
  }

  const tokenType = trimmed.startsWith('sk-ant-oat') ? 'oauth' : 'api-key';

  const config = parseConfig(row.config);
  config.claudeToken = trimmed;
  config.claudeTokenType = tokenType;

  db.prepare('UPDATE providers SET is_configured = 1, config = ? WHERE name = ?')
    .run(JSON.stringify(config), row.name);

  if (tokenType === 'oauth') {
    setClaudeOnboarding(true);
  }

  res.json({ success: true, tokenType });
});

// DELETE /api/models/:provider/token — remove auth token
modelsRouter.delete('/:provider/token', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const config = parseConfig(row.config);
  const wasOAuth = config.claudeTokenType === 'oauth';

  delete config.claudeToken;
  delete config.claudeTokenType;

  db.prepare('UPDATE providers SET is_configured = 0, config = ? WHERE name = ?')
    .run(JSON.stringify(config), row.name);

  if (wasOAuth) {
    setClaudeOnboarding(false);
  }

  res.json({ success: true });
});

// PUT /api/models/:provider/model — save selected model variant
modelsRouter.put('/:provider/model', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { model } = req.body;
  if (!model || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'model is required' });
  }

  const trimmed = model.trim();
  const config = parseConfig(row.config);
  config.claudeModel = trimmed;
  updateProviderConfig(row.name, config);

  res.json({ success: true, model: trimmed });
});

// DELETE /api/models/:provider/model — reset model variant to provider default
modelsRouter.delete('/:provider/model', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const config = parseConfig(row.config);
  delete config.claudeModel;
  updateProviderConfig(row.name, config);

  res.json({ success: true });
});

// PUT /api/models/:provider/preferences — save provider-specific behavioral preferences
modelsRouter.put('/:provider/preferences', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { preferences } = req.body;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return res.status(400).json({ error: 'preferences must be a non-array object' });
  }

  const config = parseConfig(row.config);
  config.preferences = preferences;
  updateProviderConfig(row.name, config);

  res.json({ success: true });
});
