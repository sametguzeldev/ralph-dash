import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { startReview, stopReview, getStatus, getOutput, getFullOutputText } from '../services/reviewRunner.js';
import type { ProjectRow } from '../db/types.js';

export const reviewRouter = Router();

reviewRouter.post('/:id/review/start', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (!project.review_provider) {
    return res.status(400).json({ error: 'No review provider configured for this project' });
  }

  const { baseBranch } = req.body as { baseBranch?: string };
  if (!baseBranch || typeof baseBranch !== 'string') {
    return res.status(400).json({ error: 'baseBranch is required' });
  }

  const result = startReview(project.id, baseBranch);
  if (!result.ok) {
    return res.status(409).json({ error: result.error });
  }

  res.json({ success: true, ...getStatus(project.id) });
});

reviewRouter.post('/:id/review/stop', (req, res) => {
  const projectId = parseInt(req.params.id, 10);

  const stopped = stopReview(projectId);
  if (!stopped) {
    return res.status(404).json({ error: 'No running review found' });
  }

  res.json({ success: true });
});

reviewRouter.get('/:id/review/status', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  res.json(getStatus(projectId));
});

reviewRouter.get('/:id/review/output', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const since = parseInt(req.query.since as string, 10) || 0;
  res.json(getOutput(projectId, since));
});

reviewRouter.post('/:id/review/save-feedback', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const outputText = getFullOutputText(projectId);
  if (outputText === null) {
    return res.status(400).json({ error: 'No review output exists' });
  }

  const feedbackDir = path.join(project.path, 'scripts', 'ralph');
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(path.join(feedbackDir, 'review-feedback.md'), outputText, 'utf-8');

  res.json({ success: true });
});
