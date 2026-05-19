import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from '../db/connection.js';
import { copyRalphFiles } from '../services/fileCopier.js';
import { parsePrd, parseProgress, readBranch, deriveTaskStatus, listArchives, parsePrdFromDir, parseProgressFromDir, getArchiveDir } from '../services/fileParser.js';
import { getRunStatus, stopRun } from '../services/processManager.js';
import { detectWorkflowStep } from '../services/workflowDetector.js';
import { DEFAULT_PROVIDER, getProvider, normalizeModelVariant } from '../providers/registry.js';
import type { ProjectRow } from '../db/types.js';

export const projectsRouter = Router();

function withSafeModelSelections(project: ProjectRow): ProjectRow {
  const safe = { ...project };

  if (safe.provider && safe.model_variant) {
    try {
      safe.model_variant = normalizeModelVariant(safe.provider, safe.model_variant) ?? null;
    } catch {
      // Keep the stored value if the provider itself is unknown; other handlers
      // will surface that as a configuration error.
    }
  }

  if (safe.review_provider && safe.review_model_variant) {
    try {
      safe.review_model_variant = normalizeModelVariant(safe.review_provider, safe.review_model_variant) ?? null;
    } catch {
      // Keep the stored value if the provider itself is unknown.
    }
  }

  return safe;
}

projectsRouter.get('/', (_req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[];

  const enriched = projects.map(p => {
    const safeProject = withSafeModelSelections(p);
    const prd = parsePrd(p.path);
    const branch = readBranch(p.path);
    const runStatus = getRunStatus(p.id);
    const totalStories = prd?.userStories?.length || 0;
    const doneStories = prd?.userStories?.filter(s => s.passes).length || 0;
    const inProgressStories = prd?.userStories?.filter(s => s.inProgress && !s.passes).length || 0;

    return {
      ...safeProject,
      branch,
      totalStories,
      doneStories,
      inProgressStories,
      running: runStatus.running,
    };
  });

  res.json(enriched);
});

projectsRouter.post('/', (req, res) => {
  const { name, path: projectPath } = req.body;

  if (!name || !projectPath) {
    return res.status(400).json({ error: 'name and path are required' });
  }

  const expandedPath = projectPath.replace(/^~/, os.homedir());

  if (!fs.existsSync(expandedPath)) {
    return res.status(400).json({ error: 'Project path does not exist' });
  }

  // Check if ralph path is configured
  const settingsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ralphPath') as { value: string } | undefined;
  if (!settingsRow) {
    return res.status(400).json({ error: 'Ralph path not configured. Go to Settings first.' });
  }

  try {
    const result = db.prepare('INSERT INTO projects (name, path) VALUES (?, ?)').run(name, expandedPath);
    try {
      const inserted = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as ProjectRow;
      copyRalphFiles(settingsRow.value, expandedPath, inserted.provider ?? DEFAULT_PROVIDER);
    } catch (copyErr: unknown) {
      db.prepare('DELETE FROM projects WHERE id = ?').run(result.lastInsertRowid);
      const message = copyErr instanceof Error ? copyErr.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as ProjectRow;
    res.status(201).json(withSafeModelSelections(project));
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Project with this path already exists' });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

projectsRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  const projectId = Number(id);

  // Check project exists before attempting stop/delete
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Stop any active run before deleting
  const runStatus = getRunStatus(projectId);
  if (runStatus.running) {
    stopRun(projectId);
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

  res.json({ success: true });
});

projectsRouter.post('/:id/sync', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const settingsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ralphPath') as { value: string } | undefined;
  if (!settingsRow) {
    return res.status(400).json({ error: 'Ralph path not configured. Go to Settings first.' });
  }

  try {
    copyRalphFiles(settingsRow.value, project.path, project.provider ?? DEFAULT_PROVIDER);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

projectsRouter.get('/:id', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.json(withSafeModelSelections(project));
});

projectsRouter.get('/:id/status', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const prd = parsePrd(project.path);
  const progress = parseProgress(project.path);
  const branch = readBranch(project.path);
  const runStatus = getRunStatus(project.id);
  const workflowStatus = detectWorkflowStep(project.path);

  // Derive task statuses
  const tasks = prd?.userStories?.map(story => ({
    ...story,
    status: deriveTaskStatus(story),
  })) || [];

  res.json({
    project: withSafeModelSelections(project),
    prd: prd ? { ...prd, userStories: tasks } : null,
    progress,
    branch,
    runStatus: runStatus.running ? 'running' : 'stopped',
    workflowStep: workflowStatus.step,
    workflowFiles: {
      questions: workflowStatus.questionsFiles,
      prds: workflowStatus.prdFiles,
      hasPrdJson: workflowStatus.hasPrdJson,
    },
    lastRefreshed: new Date().toISOString(),
  });
});

// ---- Provider / Model Variant ----

projectsRouter.put('/:id/provider', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { provider } = req.body;
  if (!provider || typeof provider !== 'string') {
    return res.status(400).json({ error: 'provider is required' });
  }

  const trimmed = provider.trim();

  // Validate provider exists in the registry
  let registeredProvider;
  try {
    registeredProvider = getProvider(trimmed);
  } catch {
    return res.status(400).json({ error: `Unknown provider: ${trimmed}` });
  }

  // Compute default model variant: prefer provider's saved model preference, fallback to first registry variant
  const variants = registeredProvider.getModelVariants();
  let defaultVariant: string | null = null;

  if (variants.length > 0) {
    // Check if provider has a saved model preference in DB config
    const row = db.prepare('SELECT config FROM providers WHERE name = ?').get(trimmed) as { config: string | null } | undefined;
    if (row?.config) {
      try {
        const parsed = JSON.parse(row.config) as Record<string, unknown>;
        const providerConfig = registeredProvider.parseConfig(parsed);
        if (providerConfig.model && variants.includes(providerConfig.model)) {
          defaultVariant = providerConfig.model;
        } else {
          defaultVariant = variants[0];
        }
      } catch {
        defaultVariant = variants[0];
      }
    } else {
      defaultVariant = variants[0];
    }
  }

  // Update provider and reset model_variant to the provider's default
  db.prepare('UPDATE projects SET provider = ?, model_variant = ? WHERE id = ?')
    .run(trimmed, defaultVariant, Number(id));

  res.json({ success: true });
});

projectsRouter.put('/:id/model-variant', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { variant } = req.body;
  if (!variant || typeof variant !== 'string') {
    return res.status(400).json({ error: 'variant is required' });
  }

  // Validate variant against the selected provider
  if (!project.provider) {
    return res.status(400).json({ error: 'Project has no provider assigned' });
  }

  const trimmedVariant = variant.trim();
  if (!trimmedVariant) {
    return res.status(400).json({ error: 'variant cannot be empty' });
  }

  // Validate variant against the provider's registry variant list
  let registeredProvider;
  try {
    registeredProvider = getProvider(project.provider);
  } catch {
    return res.status(400).json({ error: 'Unknown provider' });
  }

  const allowedVariants = registeredProvider.getModelVariants();
  if (allowedVariants.length > 0 && !allowedVariants.includes(trimmedVariant)) {
    return res.status(400).json({ error: `Invalid variant '${trimmedVariant}' for provider '${project.provider}'. Allowed: ${allowedVariants.join(', ')}` });
  }

  db.prepare('UPDATE projects SET model_variant = ? WHERE id = ?')
    .run(trimmedVariant, Number(id));

  res.json({ success: true });
});

// ---- Review Provider / Model Variant ----

projectsRouter.put('/:id/review-provider', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { provider } = req.body;

  if (provider === null || provider === undefined) {
    db.prepare('UPDATE projects SET review_provider = NULL, review_model_variant = NULL WHERE id = ?')
      .run(Number(id));
    return res.json({ success: true });
  }

  if (typeof provider !== 'string') {
    return res.status(400).json({ error: 'provider must be a string or null' });
  }

  const trimmed = provider.trim();
  if (!trimmed) {
    db.prepare('UPDATE projects SET review_provider = NULL, review_model_variant = NULL WHERE id = ?')
      .run(Number(id));
    return res.json({ success: true });
  }

  let registeredProvider;
  try {
    registeredProvider = getProvider(trimmed);
  } catch {
    return res.status(400).json({ error: `Unknown provider: ${trimmed}` });
  }

  const variants = registeredProvider.getModelVariants();
  let defaultVariant: string | null = null;

  if (variants.length > 0) {
    const row = db.prepare('SELECT config FROM providers WHERE name = ?').get(trimmed) as { config: string | null } | undefined;
    if (row?.config) {
      try {
        const parsed = JSON.parse(row.config) as Record<string, unknown>;
        const providerConfig = registeredProvider.parseConfig(parsed);
        if (providerConfig.model && variants.includes(providerConfig.model)) {
          defaultVariant = providerConfig.model;
        } else {
          defaultVariant = variants[0];
        }
      } catch {
        defaultVariant = variants[0];
      }
    } else {
      defaultVariant = variants[0];
    }
  }

  db.prepare('UPDATE projects SET review_provider = ?, review_model_variant = ? WHERE id = ?')
    .run(trimmed, defaultVariant, Number(id));

  res.json({ success: true });
});

projectsRouter.put('/:id/review-model-variant', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { modelVariant } = req.body;
  if (!modelVariant || typeof modelVariant !== 'string') {
    return res.status(400).json({ error: 'modelVariant is required' });
  }

  if (!project.review_provider) {
    return res.status(400).json({ error: 'Project has no review provider assigned' });
  }

  const trimmed = modelVariant.trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'modelVariant cannot be empty' });
  }

  let registeredProvider;
  try {
    registeredProvider = getProvider(project.review_provider);
  } catch {
    return res.status(400).json({ error: 'Unknown review provider' });
  }

  const allowedVariants = registeredProvider.getModelVariants();
  if (allowedVariants.length > 0 && !allowedVariants.includes(trimmed)) {
    return res.status(400).json({ error: `Invalid variant '${trimmed}' for provider '${project.review_provider}'. Allowed: ${allowedVariants.join(', ')}` });
  }

  db.prepare('UPDATE projects SET review_model_variant = ? WHERE id = ?')
    .run(trimmed, Number(id));

  res.json({ success: true });
});

// ---- Archives ----

projectsRouter.post('/:id/archive', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const ralphPath = path.join(project.path, 'scripts', 'ralph');
  const prdPath = path.join(ralphPath, 'prd.json');

  if (!fs.existsSync(prdPath)) {
    return res.status(400).json({ error: 'No prd.json exists to archive' });
  }

  let prd: { project?: string } | null = null;
  try {
    prd = JSON.parse(fs.readFileSync(prdPath, 'utf-8'));
  } catch {
    return res.status(400).json({ error: 'Failed to parse prd.json' });
  }

  const featureName = (prd?.project || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const today = new Date().toISOString().slice(0, 10);
  const archiveBase = path.join(ralphPath, 'archive');
  fs.mkdirSync(archiveBase, { recursive: true });

  let folderName = `${today}-${featureName}`;
  if (fs.existsSync(path.join(archiveBase, folderName))) {
    let suffix = 2;
    while (fs.existsSync(path.join(archiveBase, `${folderName}-${suffix}`))) {
      suffix++;
    }
    folderName = `${folderName}-${suffix}`;
  }

  const archiveDir = path.join(archiveBase, folderName);
  fs.mkdirSync(archiveDir, { recursive: true });

  fs.renameSync(prdPath, path.join(archiveDir, 'prd.json'));

  const progressPath = path.join(ralphPath, 'progress.txt');
  if (fs.existsSync(progressPath)) {
    fs.renameSync(progressPath, path.join(archiveDir, 'progress.txt'));
  }

  const lastBranchPath = path.join(ralphPath, '.last-branch');
  if (fs.existsSync(lastBranchPath)) {
    fs.renameSync(lastBranchPath, path.join(archiveDir, '.last-branch'));
  }

  const feedbackPath = path.join(ralphPath, 'review-feedback.md');
  if (fs.existsSync(feedbackPath)) {
    fs.unlinkSync(feedbackPath);
  }

  const reviewOutputPath = path.join(ralphPath, 'review-output.md');
  if (fs.existsSync(reviewOutputPath)) {
    fs.unlinkSync(reviewOutputPath);
  }

  const chatHistoryPath = path.join(ralphPath, 'review-chat.json');
  if (fs.existsSync(chatHistoryPath)) {
    fs.unlinkSync(chatHistoryPath);
  }

  res.json({ success: true, folder: folderName });
});

projectsRouter.get('/:id/archives', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.json(listArchives(project.path));
});

projectsRouter.get('/:id/archives/:folder', (req, res) => {
  const { id, folder } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const dir = getArchiveDir(project.path, folder);

  const resolvedDir = path.resolve(dir);
  const resolvedProjectPath = path.resolve(project.path);
  if (!resolvedDir.startsWith(resolvedProjectPath + path.sep)) {
    return res.status(400).json({ error: 'Invalid archive folder' });
  }

  const prd = parsePrdFromDir(dir);
  const progress = parseProgressFromDir(dir);

  if (!prd && !progress) {
    return res.status(404).json({ error: 'Archive not found' });
  }

  const tasks = prd?.userStories?.map(story => ({
    ...story,
    status: deriveTaskStatus(story),
  })) || [];

  res.json({
    project: withSafeModelSelections(project),
    prd: prd ? { ...prd, userStories: tasks } : null,
    progress,
    branch: prd?.branchName || null,
    runStatus: 'stopped' as const,
    lastRefreshed: new Date().toISOString(),
  });
});
