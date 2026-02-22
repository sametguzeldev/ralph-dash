import fs from 'fs';
import path from 'path';

export type WorkflowStep =
  | 'no-files'
  | 'questions-created'
  | 'questions-answered'
  | 'prd-created'
  | 'prd-json-ready';

export interface WorkflowState {
  step: WorkflowStep;
  questionsFiles: string[];
  prdFiles: string[];
  hasPrdJson: boolean;
  prdJsonValid: boolean;
}

export function detectWorkflowStep(projectPath: string): WorkflowState {
  const tasksDir = path.join(projectPath, 'tasks');
  const prdJsonPath = path.join(projectPath, 'scripts', 'ralph', 'prd.json');

  const questionsFiles: string[] = [];
  const prdFiles: string[] = [];

  // Scan tasks/ directory for workflow files
  if (fs.existsSync(tasksDir)) {
    try {
      const entries = fs.readdirSync(tasksDir);
      for (const entry of entries) {
        if (entry.startsWith('prd-questions-') && entry.endsWith('.md')) {
          questionsFiles.push(path.join('tasks', entry));
        } else if (entry.startsWith('prd-') && entry.endsWith('.md')) {
          prdFiles.push(path.join('tasks', entry));
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Check prd.json
  let hasPrdJson = false;
  let prdJsonValid = false;
  if (fs.existsSync(prdJsonPath)) {
    hasPrdJson = true;
    try {
      const content = fs.readFileSync(prdJsonPath, 'utf-8');
      const validation = validatePrdJson(content);
      prdJsonValid = validation.valid;
    } catch {
      // Invalid or unreadable
    }
  }

  // Determine step (cascade from most advanced)
  let step: WorkflowStep = 'no-files';

  if (hasPrdJson && prdJsonValid) {
    step = 'prd-json-ready';
  } else if (prdFiles.length > 0) {
    step = 'prd-created';
  } else if (questionsFiles.length > 0) {
    const anyAnswered = questionsFiles.some(f =>
      isQuestionsFileAnswered(path.join(projectPath, f)),
    );
    step = anyAnswered ? 'questions-answered' : 'questions-created';
  }

  return { step, questionsFiles, prdFiles, hasPrdJson, prdJsonValid };
}

export function isQuestionsFileAnswered(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const answerPattern = /\*\*Answer:\*\*\s*(.*)/g;
    let total = 0;
    let answered = 0;
    let match;

    while ((match = answerPattern.exec(content)) !== null) {
      total++;
      if (match[1] && match[1].trim().length > 0) {
        answered++;
      }
    }

    // Consider answered if at least half of the questions have answers
    return total > 0 && answered >= total / 2;
  } catch {
    return false;
  }
}

export function validatePrdJson(content: string): { valid: boolean; errors: string[]; storyCount: number } {
  const errors: string[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, errors: ['Invalid JSON syntax'], storyCount: 0 };
  }

  if (typeof parsed.project !== 'string' || !parsed.project) {
    errors.push('Missing or invalid "project" field');
  }
  if (typeof parsed.branchName !== 'string' || !parsed.branchName) {
    errors.push('Missing or invalid "branchName" field');
  }
  if (typeof parsed.description !== 'string') {
    errors.push('Missing "description" field');
  }
  if (!Array.isArray(parsed.userStories)) {
    errors.push('Missing or invalid "userStories" array');
    return { valid: errors.length === 0, errors, storyCount: 0 };
  }

  const stories = parsed.userStories as Record<string, unknown>[];
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    if (!s || typeof s !== 'object') {
      errors.push(`Story ${i}: not an object`);
      continue;
    }
    if (typeof s.id !== 'string') errors.push(`Story ${i}: missing "id"`);
    if (typeof s.title !== 'string') errors.push(`Story ${i}: missing "title"`);
    if (!Array.isArray(s.acceptanceCriteria)) errors.push(`Story ${i}: missing "acceptanceCriteria" array`);
    if (typeof s.priority !== 'number') errors.push(`Story ${i}: missing "priority"`);
  }

  return { valid: errors.length === 0, errors, storyCount: stories.length };
}
