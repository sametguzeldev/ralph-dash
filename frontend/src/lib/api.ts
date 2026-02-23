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
export interface SettingsResponse {
  ralphPath: string | null;
  isDocker: boolean;
  claudeConfigured: boolean;
}

export function getSettings() {
  return request<SettingsResponse>('/settings');
}

export function updateSettings(ralphPath: string) {
  return request<{ ralphPath: string }>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ ralphPath }),
  });
}

export function saveClaudeToken(token: string) {
  return request<{ success: boolean; tokenType: 'api-key' | 'oauth' }>('/settings/claude-token', {
    method: 'PUT',
    body: JSON.stringify({ token }),
  });
}

export function deleteClaudeToken() {
  return request<{ success: boolean }>('/settings/claude-token', {
    method: 'DELETE',
  });
}

export interface GitConfigRequest {
  name: string;
  email: string;
}

export interface GitConfigResponse {
  success: boolean;
  name: string;
  email: string;
}

export function saveGitConfig(name: string, email: string) {
  return request<GitConfigResponse>('/settings/git-config', {
    method: 'PUT',
    body: JSON.stringify({ name, email } satisfies GitConfigRequest),
  });
}

export function deleteGitConfig() {
  return request<{ success: boolean }>('/settings/git-config', {
    method: 'DELETE',
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
  inProgressStories: number;
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

export function syncProjectFiles(id: number) {
  return request<{ success: boolean }>(`/projects/${id}/sync`, { method: 'POST' });
}

// Project Status
export interface UserStoryWithStatus {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  inProgress?: boolean;
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
  workflowStep?: 'no-files' | 'questions-created' | 'questions-answered' | 'prd-created' | 'prd-json-ready';
  workflowFiles?: {
    questions: string[];
    prds: string[];
    hasPrdJson: boolean;
  };
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

// Archives
export interface ArchiveSummary {
  folder: string;
  date: string;
  featureName: string;
  branchName: string;
  totalStories: number;
  doneStories: number;
}

export function getArchives(id: number) {
  return request<ArchiveSummary[]>(`/projects/${id}/archives`);
}

export function getArchiveDetail(id: number, folder: string) {
  return request<ProjectStatus>(`/projects/${id}/archives/${encodeURIComponent(folder)}`);
}

// Workflow
export type SkillName = 'prd-questions' | 'prd' | 'ralph';

export interface WorkflowFileInfo {
  relativePath: string;
  type: 'questions' | 'prd' | 'prd-json';
  modifiedAt: string;
  sizeBytes: number;
}

export interface WorkflowFileContent {
  relativePath: string;
  content: string;
  modifiedAt: string;
}

export interface SkillStatus {
  running: boolean;
  skill: SkillName | null;
  status: 'running' | 'completed' | 'failed' | null;
  startedAt?: string;
  exitCode: number | null;
}

export type WorkflowStep = 'no-files' | 'questions-created' | 'questions-answered' | 'prd-created' | 'prd-json-ready';

export interface WorkflowStatus {
  step: WorkflowStep;
  questionsFiles: string[];
  prdFiles: string[];
  hasPrdJson: boolean;
  prdJsonValid: boolean;
  skillStatus: SkillStatus;
}

export interface PrdJsonValidation {
  valid: boolean;
  errors: string[];
  storyCount: number;
}

export function getWorkflowStatus(id: number) {
  return request<WorkflowStatus>(`/projects/${id}/workflow/status`);
}

export function getWorkflowFiles(id: number) {
  return request<WorkflowFileInfo[]>(`/projects/${id}/workflow/files`);
}

export function getWorkflowFile(id: number, filePath: string) {
  return request<WorkflowFileContent>(`/projects/${id}/workflow/file?path=${encodeURIComponent(filePath)}`);
}

export function deleteWorkflowFile(id: number, filePath: string) {
  return request<{ success: boolean }>(`/projects/${id}/workflow/file?path=${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
}

export function saveWorkflowFile(id: number, filePath: string, content: string) {
  return request<{ success: boolean }>(`/projects/${id}/workflow/file`, {
    method: 'PUT',
    body: JSON.stringify({ relativePath: filePath, content }),
  });
}

export function startSkillRun(id: number, body: {
  skill: SkillName;
  featureDescription?: string;
  questionsFile?: string;
  prdFile?: string;
}) {
  return request<{ success: boolean }>(`/projects/${id}/workflow/skill/start`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function stopSkillRun(id: number) {
  return request<{ success: boolean }>(`/projects/${id}/workflow/skill/stop`, { method: 'POST' });
}

export function getSkillStatus(id: number) {
  return request<SkillStatus>(`/projects/${id}/workflow/skill/status`);
}

export function getSkillOutput(id: number, since = 0) {
  return request<{ lines: string[]; total: number }>(`/projects/${id}/workflow/skill/output?since=${since}`);
}

export function validatePrdJson(id: number, content: string) {
  return request<PrdJsonValidation>(`/projects/${id}/workflow/prd-json/validate`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
