import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import type { ProviderRow } from '../db/types.js';
import { getProvider, getAllProviders } from '../providers/registry.js';

export const modelsRouter = Router();

const RUNNER_SCRIPTS: Record<string, string> = {
  claude: 'ralph-cc.sh',
  codex: 'ralph-codex.sh',
  opencode: 'ralph-opencode.sh',
};

function getProviderRow(name: string): ProviderRow | undefined {
  return db.prepare('SELECT * FROM providers WHERE name = ?').get(name) as ProviderRow | undefined;
}

/**
 * Get or lazily create a provider DB row.
 * Returns the row if the provider is registered, or undefined if unknown.
 */
function ensureProviderRow(providerName: string): ProviderRow | undefined {
  // Check if registered in the provider registry
  try {
    getProvider(providerName);
  } catch {
    return undefined;
  }

  const existing = getProviderRow(providerName);
  if (existing) return existing;

  // Create lazily on first configuration attempt
  const runnerScript = RUNNER_SCRIPTS[providerName] || `ralph-${providerName}.sh`;
  db.prepare('INSERT INTO providers (name, runner_script, is_configured, config) VALUES (?, ?, 0, ?)')
    .run(providerName, runnerScript, '{}');

  return getProviderRow(providerName)!;
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

  // Claude-specific model key
  if (typeof config.claudeModel === 'string' && config.claudeModel.trim()) {
    safe.claudeModel = config.claudeModel;
  }

  // Generic model key (used by codex, opencode)
  if (typeof config.model === 'string' && config.model.trim()) {
    safe.model = config.model;
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

// GET /api/models — list all registered providers (including unconfigured ones)
modelsRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM providers').all() as ProviderRow[];
  const rowMap = new Map(rows.map((r) => [r.name, r]));

  const registered = getAllProviders();
  const result = registered.map((provider) => {
    const row = rowMap.get(provider.name);
    const config = row ? sanitizeProviderConfig(row.config) : sanitizeProviderConfig(null);

    // Always include modelVariants from the registry so the frontend can render dropdowns
    const variants = provider.getModelVariants();
    if (variants.length > 0) {
      config.modelVariants = variants;
    }

    if (row) {
      return {
        id: row.id,
        name: row.name,
        runner_script: row.runner_script,
        is_configured: !!row.is_configured,
        config,
      };
    }
    // Registered but not yet in DB — return virtual unconfigured entry
    return {
      id: 0,
      name: provider.name,
      runner_script: RUNNER_SCRIPTS[provider.name] || null,
      is_configured: false,
      config,
    };
  });

  res.json(result);
});

// GET /api/models/:provider — single provider's full configuration
modelsRouter.get('/:provider', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    // Check if registered but not yet in DB
    try {
      getProvider(req.params.provider);
    } catch {
      return res.status(404).json({ error: 'Provider not found' });
    }
    return res.json({
      id: 0,
      name: req.params.provider,
      runner_script: RUNNER_SCRIPTS[req.params.provider] || null,
      is_configured: false,
      config: sanitizeProviderConfig(null),
    });
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
  const row = ensureProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { token, envVarName } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const trimmed = token.trim();

  // Claude-specific token validation
  if (row.name === 'claude') {
    if (!trimmed.startsWith('sk-ant-api') && !trimmed.startsWith('sk-ant-oat')) {
      return res.status(400).json({ error: 'Token must start with sk-ant-api (API key) or sk-ant-oat (OAuth token)' });
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

    return res.json({ success: true, tokenType });
  }

  // Non-claude providers: store token generically
  const config = parseConfig(row.config);
  config.token = trimmed;

  // OpenCode supports specifying the env var name
  if (row.name === 'opencode' && envVarName && typeof envVarName === 'string') {
    config.envVarName = envVarName.trim();
  }

  db.prepare('UPDATE providers SET is_configured = 1, config = ? WHERE name = ?')
    .run(JSON.stringify(config), row.name);

  res.json({ success: true, tokenType: 'api-key' });
});

// DELETE /api/models/:provider/token — remove auth token
modelsRouter.delete('/:provider/token', (req, res) => {
  const row = getProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const config = parseConfig(row.config);

  if (row.name === 'claude') {
    const wasOAuth = config.claudeTokenType === 'oauth';
    delete config.claudeToken;
    delete config.claudeTokenType;

    db.prepare('UPDATE providers SET is_configured = 0, config = ? WHERE name = ?')
      .run(JSON.stringify(config), row.name);

    if (wasOAuth) {
      setClaudeOnboarding(false);
    }
  } else {
    delete config.token;

    db.prepare('UPDATE providers SET is_configured = 0, config = ? WHERE name = ?')
      .run(JSON.stringify(config), row.name);
  }

  res.json({ success: true });
});

// PUT /api/models/:provider/model — save selected model variant
modelsRouter.put('/:provider/model', (req, res) => {
  const row = ensureProviderRow(req.params.provider);
  if (!row) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { model } = req.body;
  if (!model || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'model is required' });
  }

  const trimmed = model.trim();

  // For providers with a fixed model variant list, validate the selection
  const provider = getProvider(row.name);
  const variants = provider.getModelVariants();
  if (variants.length > 0 && !variants.includes(trimmed)) {
    return res.status(400).json({
      error: `Invalid model '${trimmed}' for provider '${row.name}'. Allowed: ${variants.join(', ')}`,
    });
  }

  const config = parseConfig(row.config);

  // Claude uses its own config key; other providers use generic 'model'
  if (row.name === 'claude') {
    config.claudeModel = trimmed;
  } else {
    config.model = trimmed;
  }

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

  if (row.name === 'claude') {
    delete config.claudeModel;
  } else {
    delete config.model;
  }

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
