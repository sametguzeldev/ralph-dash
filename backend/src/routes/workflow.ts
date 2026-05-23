import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { ProviderError } from '../providers/providerError.js';
import { loadGitIdentity, loadProviderConfig, requireProvider } from '../providers/registry.js';
import { detectWorkflowStep, validatePrdJson } from '../services/workflowDetector.js';
import * as ProcessRun from '../services/processRun.js';
import { getSkill } from '../services/skills/registry.js';
import type { ProjectRow } from '../db/types.js';
import type { SkillName } from '../services/skills/types.js';

export const workflowRouter = Router();

// Allowed paths for security: entries ending with '/' are directory prefixes, others are exact matches
const ALLOWED_DIRS = ['tasks/'];
const ALLOWED_FILES = ['scripts/ralph/prd.json'];

function isPathAllowed(relativePath: string): boolean {
  return ALLOWED_DIRS.some(dir => relativePath.startsWith(dir))
    || ALLOWED_FILES.includes(relativePath);
}

function resolveAndValidate(projectPath: string, relativePath: string): string | null {
  if (!isPathAllowed(relativePath)) return null;
  const resolved = path.resolve(projectPath, relativePath);
  const resolvedProject = path.resolve(projectPath);
  if (!resolved.startsWith(resolvedProject + path.sep)) return null;
  return resolved;
}

function getProject(id: string): ProjectRow | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}

function getSkillStatus(projectId: number): {
  running: boolean;
  skill: SkillName | null;
  status: 'running' | 'completed' | 'failed' | null;
  startedAt?: string;
  exitCode: number | null;
} {
  const status = ProcessRun.status(projectId, 'skill');
  return {
    running: status.running,
    skill: status.skillName ?? null,
    status: status.status ?? null,
    startedAt: status.startedAt,
    exitCode: status.exitCode ?? null,
  };
}

// GET /:id/workflow/status
workflowRouter.get('/:id/workflow/status', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const workflow = detectWorkflowStep(project.path);
  const skillStatus = getSkillStatus(project.id);

  res.json({
    ...workflow,
    skillStatus,
  });
});

// GET /:id/workflow/files
workflowRouter.get('/:id/workflow/files', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const workflow = detectWorkflowStep(project.path);
  const files: { relativePath: string; type: string; modifiedAt: string; sizeBytes: number }[] = [];

  const addFile = (relativePath: string, type: string) => {
    const fullPath = path.join(project.path, relativePath);
    try {
      const stat = fs.statSync(fullPath);
      files.push({
        relativePath,
        type,
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      });
    } catch {
      // File may have been removed
    }
  };

  for (const f of workflow.questionsFiles) addFile(f, 'questions');
  for (const f of workflow.prdFiles) addFile(f, 'prd');
  if (workflow.hasPrdJson) addFile('scripts/ralph/prd.json', 'prd-json');

  res.json(files);
});

// GET /:id/workflow/file?path=...
workflowRouter.get('/:id/workflow/file', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const relativePath = req.query.path as string;
  if (!relativePath) return res.status(400).json({ error: 'path query param required' });

  const fullPath = resolveAndValidate(project.path, relativePath);
  if (!fullPath) return res.status(403).json({ error: 'Access denied to this path' });

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const stat = fs.statSync(fullPath);
    res.json({
      relativePath,
      content,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Read failed';
    res.status(500).json({ error: message });
  }
});

// PUT /:id/workflow/file
workflowRouter.put('/:id/workflow/file', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { relativePath, content } = req.body;
  if (!relativePath || typeof content !== 'string') {
    return res.status(400).json({ error: 'relativePath and content are required' });
  }

  const fullPath = resolveAndValidate(project.path, relativePath);
  if (!fullPath) return res.status(403).json({ error: 'Access denied to this path' });

  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    // Validate JSON if writing prd.json
    if (relativePath === 'scripts/ralph/prd.json') {
      try {
        JSON.parse(content);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON syntax' });
      }
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Write failed';
    res.status(500).json({ error: message });
  }
});

// DELETE /:id/workflow/file?path=...
workflowRouter.delete('/:id/workflow/file', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const relativePath = req.query.path as string;
  if (!relativePath) return res.status(400).json({ error: 'path query param required' });

  // Don't allow deleting prd.json through this endpoint
  if (relativePath === 'scripts/ralph/prd.json') {
    return res.status(403).json({ error: 'Cannot delete prd.json through this endpoint' });
  }

  const fullPath = resolveAndValidate(project.path, relativePath);
  if (!fullPath) return res.status(403).json({ error: 'Access denied to this path' });

  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  try {
    fs.unlinkSync(fullPath);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    res.status(500).json({ error: message });
  }
});

// POST /:id/workflow/skill/start
workflowRouter.post('/:id/workflow/skill/start', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { skill, featureDescription, questionsFile, prdFile } = req.body;

  try {
    if (!project.provider) {
      throw new ProviderError('not-configured', 'project', 'Project has no provider assigned. Configure a provider first.');
    }

    const skillDefinition = getSkill(skill);
    const prompt = skillDefinition.buildPrompt({
      featureDescription,
      questionsFile,
      prdFile,
    });
    const provider = requireProvider(project.provider);
    const cfg = loadProviderConfig(project.provider);
    const spec = provider.describeSkill(
      cfg,
      project.model_variant ?? undefined,
      project.path,
      skillDefinition.name,
      prompt,
    );
    const started = ProcessRun.start(project.id, { ...spec, env: { ...loadGitIdentity(), ...spec.env } });

    if (!started.ok) {
      return res.status(409).json({
        error: `A ${started.conflictKind} is already running for this project`,
        conflictKind: started.conflictKind,
      });
    }

    return res.json({ success: true, ...getSkillStatus(project.id) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start skill';
    if (err instanceof ProviderError) {
      return res.status(400).json({ error: message, kind: err.kind });
    }
    return res.status(500).json({ error: message });
  }
});

// POST /:id/workflow/skill/stop
workflowRouter.post('/:id/workflow/skill/stop', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const stopped = ProcessRun.stop(project.id, 'skill');
  if (!stopped) {
    return res.status(404).json({ error: 'No running skill found' });
  }

  res.json({ success: true });
});

// GET /:id/workflow/skill/status
workflowRouter.get('/:id/workflow/skill/status', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  res.json(getSkillStatus(project.id));
});

// GET /:id/workflow/skill/output?since=N
workflowRouter.get('/:id/workflow/skill/output', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const since = parseInt(req.query.since as string, 10) || 0;
  res.json(ProcessRun.output(project.id, since, 'skill'));
});

// POST /:id/workflow/prd-json/validate
workflowRouter.post('/:id/workflow/prd-json/validate', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }

  res.json(validatePrdJson(content));
});
