import { db } from './connection.js';

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      runner_script TEXT,
      is_configured INTEGER DEFAULT 0,
      config TEXT
    );
  `);

  // Add provider and model_variant columns to projects if they don't exist yet.
  // SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we check the table info.
  const cols = db.pragma('table_info(projects)') as Array<{ name: string }>;
  const colNames = new Set(cols.map(c => c.name));

  if (!colNames.has('provider')) {
    db.exec(`ALTER TABLE projects ADD COLUMN provider TEXT`);
  }
  if (!colNames.has('model_variant')) {
    db.exec(`ALTER TABLE projects ADD COLUMN model_variant TEXT`);
  }

  migrateSettingsToProviders();
}

/**
 * Idempotent migration: move claude-specific settings from the key-value
 * `settings` table into a 'claude' row in the `providers` table, then
 * backfill existing projects with provider='claude'.
 */
function migrateSettingsToProviders() {
  // If the 'claude' provider already exists, migration has run — nothing to do.
  const existing = db.prepare('SELECT id FROM providers WHERE name = ?').get('claude') as { id: number } | undefined;
  if (existing) return;

  // Read legacy settings that will be migrated
  const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeToken') as { value: string } | undefined;
  const tokenTypeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeTokenType') as { value: string } | undefined;
  const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('claudeModel') as { value: string } | undefined;
  const autoMemoryRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('autoMemoryEnabled') as { value: string } | undefined;

  const defaultVariant = 'claude-sonnet-4-6';

  const config = {
    modelVariants: [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ],
    defaultVariant,
    // Carry over legacy settings into the provider config
    ...(tokenRow?.value ? { claudeToken: tokenRow.value } : {}),
    ...(tokenTypeRow?.value ? { claudeTokenType: tokenTypeRow.value } : {}),
    ...(modelRow?.value ? { claudeModel: modelRow.value } : {}),
    ...(autoMemoryRow?.value !== undefined ? { autoMemoryEnabled: autoMemoryRow.value } : {}),
  };

  const isConfigured = tokenRow?.value ? 1 : 0;

  // Wrap in a transaction so it's all-or-nothing
  const migrate = db.transaction(() => {
    db.prepare(
      `INSERT INTO providers (name, runner_script, is_configured, config) VALUES (?, ?, ?, ?)`
    ).run('claude', 'ralph-cc.sh', isConfigured, JSON.stringify(config));

    // Backfill existing projects: set provider='claude' and model_variant
    const migratedModel = modelRow?.value || defaultVariant;
    db.prepare(
      `UPDATE projects SET provider = ?, model_variant = ? WHERE provider IS NULL`
    ).run('claude', migratedModel);

    // Remove migrated keys from the settings table
    const keysToRemove = ['claudeToken', 'claudeTokenType', 'claudeModel', 'autoMemoryEnabled'];
    const deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');
    for (const key of keysToRemove) {
      deleteStmt.run(key);
    }
  });

  migrate();
}
