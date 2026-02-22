import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { detectWorkflowStep, validatePrdJson } from '../services/workflowDetector.js';
import { startSkill, stopSkill, clearSkillRun, getSkillStatus, getSkillOutput, type SkillName } from '../services/skillRunner.js';

export const workflowRouter = Router();

interface ProjectRow {
  id: number;
  name: string;
  path: string;
}

// Allowed file prefixes for security
const ALLOWED_PATHS = ['tasks/', 'scripts/ralph/prd.json'];

function isPathAllowed(relativePath: string): boolean {
  return ALLOWED_PATHS.some(prefix => relativePath.startsWith(prefix));
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
  const validSkills: SkillName[] = ['prd-questions', 'prd', 'ralph'];
  if (!validSkills.includes(skill)) {
    return res.status(400).json({ error: `Invalid skill. Must be one of: ${validSkills.join(', ')}` });
  }

  // Clear any completed skill run before starting a new one
  clearSkillRun(project.id);

  const started = startSkill(project.id, project.path, skill, {
    featureDescription,
    questionsFile,
    prdFile,
  });

  if (!started) {
    return res.status(409).json({ error: 'A skill is already running for this project' });
  }

  res.json({ success: true, ...getSkillStatus(project.id) });
});

// POST /:id/workflow/skill/stop
workflowRouter.post('/:id/workflow/skill/stop', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const stopped = stopSkill(project.id);
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
  res.json(getSkillOutput(project.id, since));
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
