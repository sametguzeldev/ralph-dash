const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// Settings
export function getSettings() {
  return request<{ ralphPath: string | null }>('/settings');
}

export function updateSettings(ralphPath: string) {
  return request<{ ralphPath: string }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ ralphPath }),
  });
}

// Projects
export interface ProjectSummary {
  id: number;
  name: string;
  path: string;
  created_at: string;
  branch: string | null;
  totalStories: number;
  doneStories: number;
  running: boolean;
}

export function getProjects() {
  return request<ProjectSummary[]>('/projects');
}

export function createProject(name: string, path: string) {
  return request<{ id: number; name: string; path: string }>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, path }),
  });
}

export function deleteProject(id: number) {
  return request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' });
}

// Project Status
export interface UserStoryWithStatus {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface PrdDataWithStatus {
  project: string;
  branchName: string;
  description: string;
  userStories: UserStoryWithStatus[];
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

export interface ProjectStatus {
  project: { id: number; name: string; path: string };
  prd: PrdDataWithStatus | null;
  progress: ProgressData | null;
  branch: string | null;
  runStatus: 'running' | 'stopped';
  lastRefreshed: string;
}

export function getProjectStatus(id: number) {
  return request<ProjectStatus>(`/projects/${id}/status`);
}

// Runner
export function startRun(id: number) {
  return request<{ success: boolean }>(`/projects/${id}/run/start`, { method: 'POST' });
}

export function stopRun(id: number) {
  return request<{ success: boolean }>(`/projects/${id}/run/stop`, { method: 'POST' });
}

export function getRunOutput(id: number, since = 0) {
  return request<{ lines: string[]; total: number }>(`/projects/${id}/run/output?since=${since}`);
}
