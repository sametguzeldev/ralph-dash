import { Router } from 'express';
import { db } from '../db/connection.js';
import { startRun, stopRun, getRunStatus, getRunOutput } from '../services/processManager.js';
import type { ProjectRow } from '../db/types.js';
import { ProviderError } from '../providers/providerError.js';

export const runnerRouter = Router();

runnerRouter.post('/:id/run/start', (req, res) => {
  const { id } = req.params;
  const projectId = parseInt(id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const result = startRun(project.id, project.path);
    if (!result.ok) {
      return res.status(409).json({ error: 'Run already in progress', conflictKind: result.conflictKind });
    }

    res.json({ success: true, ...getRunStatus(project.id) });
  } catch (error) {
    if (error instanceof ProviderError) {
      return res.status(400).json({ error: error.message, kind: error.kind });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

runnerRouter.post('/:id/run/stop', (req, res) => {
  const { id } = req.params;
  const projectId = parseInt(id, 10);

  const stopped = stopRun(projectId);
  if (!stopped) {
    return res.status(404).json({ error: 'No running process found' });
  }

  res.json({ success: true });
});

runnerRouter.get('/:id/run/status', (req, res) => {
  const { id } = req.params;
  const projectId = parseInt(id, 10);
  res.json(getRunStatus(projectId));
});

runnerRouter.get('/:id/run/output', (req, res) => {
  const { id } = req.params;
  const since = parseInt(req.query.since as string, 10) || 0;
  const projectId = parseInt(id, 10);
  res.json(getRunOutput(projectId, since));
});
