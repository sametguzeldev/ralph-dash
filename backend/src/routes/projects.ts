import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from '../db/connection.js';
import { copyRalphFiles } from '../services/fileCopier.js';
import { parsePrd, parseProgress, readBranch, deriveTaskStatus, listArchives, parsePrdFromDir, parseProgressFromDir, getArchiveDir } from '../services/fileParser.js';
import { getRunStatus, stopRun } from '../services/processManager.js';

export const projectsRouter = Router();

interface ProjectRow {
  id: number;
  name: string;
  path: string;
  created_at: string;
}

projectsRouter.get('/', (_req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[];

  const enriched = projects.map(p => {
    const prd = parsePrd(p.path);
    const branch = readBranch(p.path);
    const runStatus = getRunStatus(p.id);
    const totalStories = prd?.userStories.length || 0;
    const doneStories = prd?.userStories.filter(s => s.passes).length || 0;
    const inProgressStories = prd?.userStories.filter(s => s.inProgress && !s.passes).length || 0;

    return {
      ...p,
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
      copyRalphFiles(settingsRow.value, expandedPath);
    } catch (copyErr: unknown) {
      db.prepare('DELETE FROM projects WHERE id = ?').run(result.lastInsertRowid);
      const message = copyErr instanceof Error ? copyErr.message : 'Unknown error';
      return res.status(500).json({ error: message });
    }
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as ProjectRow;
    res.status(201).json(project);
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
    copyRalphFiles(settingsRow.value, project.path);
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

  res.json(project);
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

  // Derive task statuses
  const tasks = prd?.userStories.map(story => ({
    ...story,
    status: deriveTaskStatus(story),
  })) || [];

  res.json({
    project,
    prd: prd ? { ...prd, userStories: tasks } : null,
    progress,
    branch,
    runStatus: runStatus.running ? 'running' : 'stopped',
    lastRefreshed: new Date().toISOString(),
  });
});

// ---- Archives ----

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

  const tasks = prd?.userStories.map(story => ({
    ...story,
    status: deriveTaskStatus(story),
  })) || [];

  res.json({
    project,
    prd: prd ? { ...prd, userStories: tasks } : null,
    progress,
    branch: prd?.branchName || null,
    runStatus: 'stopped' as const,
    lastRefreshed: new Date().toISOString(),
  });
});
