import { Router } from 'express';
import { db } from '../db/connection.js';
import { startRun, stopRun, getRunStatus, getRunOutput } from '../services/processManager.js';

export const runnerRouter = Router();

interface ProjectRow {
  id: number;
  name: string;
  path: string;
}

runnerRouter.post('/:id/run/start', (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const started = startRun(project.id, project.path);
  if (!started) {
    return res.status(409).json({ error: 'Run already in progress' });
  }

  res.json({ success: true, ...getRunStatus(project.id) });
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
  const lines = getRunOutput(projectId, since);
  res.json({ lines, total: since + lines.length });
});
