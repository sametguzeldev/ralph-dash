import { Router } from 'express';
import { db } from '../db/connection.js';
import * as ProcessRun from '../services/processRun.js';
import type { ProjectRow } from '../db/types.js';
import { ProviderError } from '../providers/providerError.js';
import { loadGitIdentity, loadProviderConfig, requireProvider } from '../providers/registry.js';

export const runnerRouter = Router();

runnerRouter.post('/:id/run/start', (req, res) => {
  const { id } = req.params;
  const projectId = parseInt(id, 10);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    if (!project.provider) {
      throw new ProviderError('not-configured', 'project', 'Project has no provider assigned. Configure a provider first.');
    }
    const provider = requireProvider(project.provider);
    const cfg = loadProviderConfig(project.provider);
    const spec = provider.describeLoop(cfg, project.model_variant ?? undefined, project.path);
    const result = ProcessRun.start(project.id, { ...spec, env: { ...loadGitIdentity(), ...spec.env } });
    if (!result.ok) {
      return res.status(409).json({ error: 'Run already in progress', conflictKind: result.conflictKind });
    }

    res.json({ success: true, ...ProcessRun.status(project.id, 'loop') });
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

  const stopped = ProcessRun.stop(projectId, 'loop');
  if (!stopped) {
    return res.status(404).json({ error: 'No running process found' });
  }

  res.json({ success: true });
});

runnerRouter.get('/:id/run/status', (req, res) => {
  const { id } = req.params;
  const projectId = parseInt(id, 10);
  res.json(ProcessRun.status(projectId, 'loop'));
});

runnerRouter.get('/:id/run/output', (req, res) => {
  const { id } = req.params;
  const since = parseInt(req.query.since as string, 10) || 0;
  const projectId = parseInt(id, 10);
  res.json(ProcessRun.output(projectId, since, 'loop'));
});
