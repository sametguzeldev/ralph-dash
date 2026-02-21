import fs from 'fs';
import path from 'path';

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  inProgress?: boolean;
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

export interface ArchiveSummary {
  folder: string;
  date: string;
  featureName: string;
  branchName: string;
  totalStories: number;
  doneStories: number;
}

// ---------------------------------------------------------------------------
// Core parsers — accept a directory containing prd.json / progress.txt
// ---------------------------------------------------------------------------

export function parsePrdFromDir(dir: string): PrdData | null {
  const prdPath = path.join(dir, 'prd.json');
  if (!fs.existsSync(prdPath)) return null;

  try {
    const raw = fs.readFileSync(prdPath, 'utf-8');
    return JSON.parse(raw) as PrdData;
  } catch {
    return null;
  }
}

export function parseProgressFromDir(dir: string): ProgressData | null {
  const progressPath = path.join(dir, 'progress.txt');
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

// ---------------------------------------------------------------------------
// Convenience wrappers — accept a project root path (backward-compatible)
// ---------------------------------------------------------------------------

function ralphDir(projectPath: string): string {
  return path.join(projectPath, 'scripts', 'ralph');
}

export function parsePrd(projectPath: string): PrdData | null {
  return parsePrdFromDir(ralphDir(projectPath));
}

export function parseProgress(projectPath: string): ProgressData | null {
  return parseProgressFromDir(ralphDir(projectPath));
}

export function readBranch(projectPath: string): string | null {
  const branchPath = path.join(ralphDir(projectPath), '.last-branch');
  if (!fs.existsSync(branchPath)) return null;

  try {
    return fs.readFileSync(branchPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Task status derivation
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'done';

export function deriveTaskStatus(story: UserStory): TaskStatus {
  if (story.passes) return 'done';
  if (story.inProgress) return 'in_progress';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Archive helpers
// ---------------------------------------------------------------------------

const ARCHIVE_FOLDER_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

export function listArchives(projectPath: string): ArchiveSummary[] {
  const archiveDir = path.join(ralphDir(projectPath), 'archive');
  if (!fs.existsSync(archiveDir)) return [];

  try {
    const entries = fs.readdirSync(archiveDir, { withFileTypes: true });
    const archives: ArchiveSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = ARCHIVE_FOLDER_RE.exec(entry.name);
      if (!match) continue;

      const folder = entry.name;
      const date = match[1]!;
      const featureName = match[2]!;
      const dir = path.join(archiveDir, folder);

      // Lightweight parse — only need prd for counts + branchName
      const prd = parsePrdFromDir(dir);

      archives.push({
        folder,
        date,
        featureName,
        branchName: prd?.branchName ?? `ralph/${featureName}`,
        totalStories: prd?.userStories.length ?? 0,
        doneStories: prd?.userStories.filter(s => s.passes).length ?? 0,
      });
    }

    // Newest first
    archives.sort((a, b) => b.date.localeCompare(a.date));
    return archives;
  } catch {
    return [];
  }
}

export function getArchiveDir(projectPath: string, folder: string): string {
  return path.join(ralphDir(projectPath), 'archive', folder);
}
