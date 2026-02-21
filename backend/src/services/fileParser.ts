import fs from 'fs';
import path from 'path';

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

export interface PrdData {
  project: string;
  branchName: string;
  description: string;
  userStories: UserStory[];
  qualityChecks?: Record<string, string>;
}

export interface ProgressEntry {
  date: string;
  storyId: string;
  content: string;
  learnings: string[];
}

export interface ProgressData {
  codebasePatterns: string[];
  startedAt: string;
  entries: ProgressEntry[];
}

export function parsePrd(projectPath: string): PrdData | null {
  const prdPath = path.join(projectPath, 'scripts', 'ralph', 'prd.json');
  if (!fs.existsSync(prdPath)) return null;

  try {
    const raw = fs.readFileSync(prdPath, 'utf-8');
    return JSON.parse(raw) as PrdData;
  } catch {
    return null;
  }
}

export function parseProgress(projectPath: string): ProgressData | null {
  const progressPath = path.join(projectPath, 'scripts', 'ralph', 'progress.txt');
  if (!fs.existsSync(progressPath)) return null;

  try {
    const raw = fs.readFileSync(progressPath, 'utf-8');
    const result: ProgressData = {
      codebasePatterns: [],
      startedAt: '',
      entries: [],
    };

    // Extract Codebase Patterns section
    const patternsMatch = raw.match(/## Codebase Patterns\n([\s\S]*?)(?=\n#|\n---)/);
    if (patternsMatch) {
      result.codebasePatterns = patternsMatch[1]!
        .split('\n')
        .filter(line => line.startsWith('- '))
        .map(line => line.slice(2).trim());
    }

    // Extract started timestamp
    const startedMatch = raw.match(/Started:\s*(.+)/);
    if (startedMatch) {
      result.startedAt = startedMatch[1]!.trim();
    }

    // Extract individual entries
    const entryRegex = /## (\d{4}-\d{2}-\d{2})\s*-\s*(US-\d+)\n([\s\S]*?)(?=\n---|\n## \d{4}|$)/g;
    let match;
    while ((match = entryRegex.exec(raw)) !== null) {
      const content = match[3]!.trim();
      const learnings: string[] = [];

      // Extract learnings section
      const learningsMatch = content.match(/\*\*Learnings.*?\*\*\n([\s\S]*?)(?=\n---|\n## |$)/);
      if (learningsMatch) {
        learningsMatch[1]!
          .split('\n')
          .filter(line => line.trim().startsWith('- '))
          .forEach(line => learnings.push(line.trim().slice(2).trim()));
      }

      result.entries.push({
        date: match[1]!,
        storyId: match[2]!,
        content,
        learnings,
      });
    }

    return result;
  } catch {
    return null;
  }
}

export function readBranch(projectPath: string): string | null {
  const branchPath = path.join(projectPath, 'scripts', 'ralph', '.last-branch');
  if (!fs.existsSync(branchPath)) return null;

  try {
    return fs.readFileSync(branchPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

export type TaskStatus = 'pending' | 'in_progress' | 'done';

export function deriveTaskStatus(
  story: UserStory,
  progressEntries: ProgressEntry[],
): TaskStatus {
  if (story.passes) return 'done';

  // Check if there's a progress entry for this story (meaning it was worked on)
  const hasProgressEntry = progressEntries.some(e => e.storyId === story.id);
  if (hasProgressEntry) return 'in_progress';

  return 'pending';
}
