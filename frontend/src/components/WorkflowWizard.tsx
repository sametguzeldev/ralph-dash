import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getWorkflowStatus,
  getSkillOutput,
  startSkillRun,
  stopSkillRun,
  deleteWorkflowFile,
  type WorkflowStatus,
} from '../lib/api';
import { WizardStepIndicator } from './WizardStepIndicator';
import { FileEditor } from './FileEditor';

interface WorkflowWizardProps {
  projectId: number;
  isRunning: boolean;
  onStartRun: () => void;
}

const STEP_LABELS = ['Questions', 'PRD', 'prd.json', 'Run'];

function stepFromWorkflow(w: WorkflowStatus | undefined, isRunning: boolean): number {
  if (!w) return 0;
  if (isRunning) return 3;
  switch (w.step) {
    case 'prd-json-ready': return 3;
    case 'prd-created': return 2;
    case 'questions-answered': return 1;
    case 'questions-created': return 0;
    default: return 0;
  }
}

function stepStatuses(w: WorkflowStatus | undefined, isRunning: boolean) {
  const current = stepFromWorkflow(w, isRunning);
  return STEP_LABELS.map((label, i) => ({
    label,
    status: (i < current ? 'complete' : i === current ? 'active' : 'pending') as 'complete' | 'active' | 'pending',
  }));
}

export function WorkflowWizard({ projectId, isRunning, onStartRun }: WorkflowWizardProps) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [featureDesc, setFeatureDesc] = useState('');
  const [editorOpen, setEditorOpen] = useState<{ path: string; type: 'markdown' | 'json' } | null>(null);

  // Workflow status (polls faster while a skill is running)
  const { data: workflow } = useQuery({
    queryKey: ['workflow-status', projectId],
    queryFn: () => getWorkflowStatus(projectId),
    refetchInterval: (query) => {
      const running = query.state.data?.skillStatus?.running;
      return running ? 2000 : 5000;
    },
  });

  // Auto-set active step based on workflow state, but respect manual navigation
  const [userOverride, setUserOverride] = useState(false);
  const suggestedStep = stepFromWorkflow(workflow, isRunning);
  const prevSuggestedRef = useRef(suggestedStep);

  useEffect(() => {
    if (suggestedStep !== prevSuggestedRef.current) {
      // Workflow actually progressed — reset override and follow
      setUserOverride(false);
      prevSuggestedRef.current = suggestedStep;
    }
    if (!userOverride) {
      setActiveStep(suggestedStep);
    }
  }, [suggestedStep, userOverride]);

  const handleStepClick = useCallback((step: number) => {
    setActiveStep(step);
    setUserOverride(true);
  }, []);

  const steps = stepStatuses(workflow, isRunning);
  const skillRunning = workflow?.skillStatus?.running ?? false;
  const skillStatus = workflow?.skillStatus;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-200">Workflow</span>
          {skillRunning && (
            <span className="flex items-center gap-1 text-xs text-ralph-400">
              <span className="w-1.5 h-1.5 rounded-full bg-ralph-400 animate-pulse" />
              {skillStatus?.skill} running
            </span>
          )}
        </div>
        <span className="text-gray-500">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {/* Step indicator */}
          <WizardStepIndicator
            steps={steps}
            activeStep={activeStep}
            onStepClick={handleStepClick}
          />

          {/* Step content */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            {activeStep === 0 && (
              <QuestionsStep
                projectId={projectId}
                workflow={workflow}
                skillRunning={skillRunning}
                skillStatus={skillStatus}
                featureDesc={featureDesc}
                setFeatureDesc={setFeatureDesc}
                onOpenEditor={(path) => setEditorOpen({ path, type: 'markdown' })}
              />
            )}
            {activeStep === 1 && (
              <PrdStep
                projectId={projectId}
                workflow={workflow}
                skillRunning={skillRunning}
                skillStatus={skillStatus}
                onOpenEditor={(path) => setEditorOpen({ path, type: 'markdown' })}
              />
            )}
            {activeStep === 2 && (
              <PrdJsonStep
                projectId={projectId}
                workflow={workflow}
                skillRunning={skillRunning}
                skillStatus={skillStatus}
                onOpenEditor={() => setEditorOpen({ path: 'scripts/ralph/prd.json', type: 'json' })}
              />
            )}
            {activeStep === 3 && (
              <RunStep
                isRunning={isRunning}
                workflow={workflow}
                onStartRun={onStartRun}
              />
            )}
          </div>

          {/* Skill output log */}
          {(skillRunning || (skillStatus?.status && skillStatus.status !== 'running')) && (
            <SkillOutputLog projectId={projectId} running={skillRunning} skillStatus={skillStatus} />
          )}
        </div>
      )}

      {/* File Editor Modal */}
      {editorOpen && (
        <FileEditor
          projectId={projectId}
          filePath={editorOpen.path}
          fileType={editorOpen.type}
          onClose={() => setEditorOpen(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] });
          }}
        />
      )}
    </div>
  );
}

// --- Step 1: Questions ---

function QuestionsStep({
  projectId,
  workflow,
  skillRunning,
  skillStatus,
  featureDesc,
  setFeatureDesc,
  onOpenEditor,
}: {
  projectId: number;
  workflow: WorkflowStatus | undefined;
  skillRunning: boolean;
  skillStatus: WorkflowStatus['skillStatus'] | undefined;
  featureDesc: string;
  setFeatureDesc: (s: string) => void;
  onOpenEditor: (path: string) => void;
}) {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => startSkillRun(projectId, { skill: 'prd-questions', featureDescription: featureDesc }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const followUpMutation = useMutation({
    mutationFn: (questionsFile: string) => startSkillRun(projectId, { skill: 'prd-questions', questionsFile }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => stopSkillRun(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (filePath: string) => deleteWorkflowFile(projectId, filePath),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const isThisSkillRunning = skillRunning && skillStatus?.skill === 'prd-questions';
  const files = workflow?.questionsFiles || [];

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium text-gray-200 mb-1">Generate Clarifying Questions</h4>
        <p className="text-xs text-gray-500">
          Describe the feature you want to build. Claude will generate targeted questions to clarify requirements.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={featureDesc}
          onChange={(e) => setFeatureDesc(e.target.value)}
          placeholder="e.g., Add user authentication with OAuth"
          disabled={isThisSkillRunning}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-ralph-500 disabled:opacity-50"
        />
        {isThisSkillRunning ? (
          <button
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium shrink-0"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => startMutation.mutate()}
            disabled={!featureDesc.trim() || skillRunning}
            className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium shrink-0"
          >
            Generate Questions
          </button>
        )}
      </div>

      {(startMutation.error || followUpMutation.error) && (
        <p className="text-xs text-red-400">{((startMutation.error || followUpMutation.error) as Error).message}</p>
      )}

      {/* Questions files with Edit + Follow-up + Delete actions */}
      {files.length > 0 && (
        <div>
          <span className="text-xs text-gray-500 block mb-1">Questions files:</span>
          <div className="space-y-1">
            {files.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 w-full px-3 py-1.5 bg-gray-800 rounded-lg text-sm"
              >
                <button
                  onClick={() => onOpenEditor(f)}
                  className="font-mono text-xs text-ralph-300 truncate hover:text-ralph-200 text-left"
                >
                  {f.split('/').pop()}
                </button>
                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <button
                    onClick={() => onOpenEditor(f)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Edit
                  </button>
                  <span className="text-gray-700">·</span>
                  <button
                    onClick={() => followUpMutation.mutate(f)}
                    disabled={skillRunning}
                    className="text-xs text-amber-500 hover:text-amber-400 disabled:opacity-40 disabled:hover:text-amber-500 transition-colors"
                  >
                    Follow-up
                  </button>
                  <span className="text-gray-700">·</span>
                  <button
                    onClick={() => { if (confirm(`Delete ${f.split('/').pop()}?`)) deleteMutation.mutate(f); }}
                    disabled={skillRunning}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-40 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <p className="text-xs text-gray-500">
          Open the questions file, fill in your answers, save. Use <span className="text-amber-500">Follow-up</span> to generate deeper questions based on your answers, or proceed to the next step.
        </p>
      )}
    </div>
  );
}

// --- Step 2: PRD ---

function PrdStep({
  projectId,
  workflow,
  skillRunning,
  skillStatus,
  onOpenEditor,
}: {
  projectId: number;
  workflow: WorkflowStatus | undefined;
  skillRunning: boolean;
  skillStatus: WorkflowStatus['skillStatus'] | undefined;
  onOpenEditor: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const questionsFiles = workflow?.questionsFiles || [];
  const prdFiles = workflow?.prdFiles || [];
  const [selectedFile, setSelectedFile] = useState('');

  // Auto-select when there's only one file, or keep selection in sync
  useEffect(() => {
    if (questionsFiles.length === 1) {
      setSelectedFile(questionsFiles[0] ?? '');
    } else if (questionsFiles.length > 0 && !questionsFiles.includes(selectedFile)) {
      setSelectedFile(questionsFiles[questionsFiles.length - 1] ?? '');
    }
  }, [questionsFiles]);

  const startMutation = useMutation({
    mutationFn: () => startSkillRun(projectId, { skill: 'prd', questionsFile: selectedFile }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => stopSkillRun(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (filePath: string) => deleteWorkflowFile(projectId, filePath),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const isThisSkillRunning = skillRunning && skillStatus?.skill === 'prd';

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium text-gray-200 mb-1">Generate PRD</h4>
        <p className="text-xs text-gray-500">
          Generate a Product Requirements Document from your answered questions.
        </p>
      </div>

      {questionsFiles.length === 1 && (
        <p className="text-xs text-gray-400">
          Using: <span className="font-mono text-ralph-300">{selectedFile}</span>
        </p>
      )}
      {questionsFiles.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0">Using:</span>
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={isThisSkillRunning}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs font-mono text-ralph-300 focus:outline-none focus:border-ralph-500 disabled:opacity-50"
          >
            {questionsFiles.map((f) => (
              <option key={f} value={f}>{f.split('/').pop()}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2">
        {isThisSkillRunning ? (
          <button
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => startMutation.mutate()}
            disabled={!selectedFile || skillRunning}
            className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            Generate PRD
          </button>
        )}
      </div>

      {startMutation.error && (
        <p className="text-xs text-red-400">{(startMutation.error as Error).message}</p>
      )}

      {/* PRD files with Edit + Delete actions */}
      {prdFiles.length > 0 && (
        <div>
          <span className="text-xs text-gray-500 block mb-1">PRD files:</span>
          <div className="space-y-1">
            {prdFiles.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 w-full px-3 py-1.5 bg-gray-800 rounded-lg text-sm"
              >
                <button
                  onClick={() => onOpenEditor(f)}
                  className="font-mono text-xs text-ralph-300 truncate hover:text-ralph-200 text-left"
                >
                  {f.split('/').pop()}
                </button>
                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <button
                    onClick={() => onOpenEditor(f)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Edit
                  </button>
                  <span className="text-gray-700">·</span>
                  <button
                    onClick={() => { if (confirm(`Delete ${f.split('/').pop()}?`)) deleteMutation.mutate(f); }}
                    disabled={skillRunning}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-40 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Step 3: prd.json ---

function PrdJsonStep({
  projectId,
  workflow,
  skillRunning,
  skillStatus,
  onOpenEditor,
}: {
  projectId: number;
  workflow: WorkflowStatus | undefined;
  skillRunning: boolean;
  skillStatus: WorkflowStatus['skillStatus'] | undefined;
  onOpenEditor: () => void;
}) {
  const queryClient = useQueryClient();
  const prdFiles = workflow?.prdFiles || [];
  const [selectedFile, setSelectedFile] = useState('');
  const hasPrdJson = workflow?.hasPrdJson ?? false;
  const prdJsonValid = workflow?.prdJsonValid ?? false;

  // Auto-select when there's only one file, or keep selection in sync
  useEffect(() => {
    if (prdFiles.length === 1) {
      setSelectedFile(prdFiles[0] ?? '');
    } else if (prdFiles.length > 0 && !prdFiles.includes(selectedFile)) {
      setSelectedFile(prdFiles[prdFiles.length - 1] ?? '');
    }
  }, [prdFiles]);

  const startMutation = useMutation({
    mutationFn: () => startSkillRun(projectId, { skill: 'ralph', prdFile: selectedFile }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => stopSkillRun(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] }),
  });

  const isThisSkillRunning = skillRunning && skillStatus?.skill === 'ralph';

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium text-gray-200 mb-1">Generate prd.json</h4>
        <p className="text-xs text-gray-500">
          Convert your PRD into the JSON format Ralph uses to execute user stories.
        </p>
      </div>

      {prdFiles.length === 1 && (
        <p className="text-xs text-gray-400">
          Using: <span className="font-mono text-ralph-300">{selectedFile}</span>
        </p>
      )}
      {prdFiles.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0">Using:</span>
          <select
            value={selectedFile}
            onChange={(e) => setSelectedFile(e.target.value)}
            disabled={isThisSkillRunning}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs font-mono text-ralph-300 focus:outline-none focus:border-ralph-500 disabled:opacity-50"
          >
            {prdFiles.map((f) => (
              <option key={f} value={f}>{f.split('/').pop()}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2">
        {isThisSkillRunning ? (
          <button
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => startMutation.mutate()}
            disabled={!selectedFile || skillRunning}
            className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            Generate prd.json
          </button>
        )}
      </div>

      {startMutation.error && (
        <p className="text-xs text-red-400">{(startMutation.error as Error).message}</p>
      )}

      {hasPrdJson && (
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenEditor}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            <span className="font-mono text-xs text-ralph-300">prd.json</span>
            <span className="text-gray-400">Edit</span>
          </button>
          {prdJsonValid ? (
            <span className="text-xs text-green-400">Valid</span>
          ) : (
            <span className="text-xs text-red-400">Invalid — open editor to fix</span>
          )}
        </div>
      )}
    </div>
  );
}

// --- Step 4: Run ---

function RunStep({
  isRunning,
  workflow,
  onStartRun,
}: {
  isRunning: boolean;
  workflow: WorkflowStatus | undefined;
  onStartRun: () => void;
}) {
  const hasPrdJson = workflow?.hasPrdJson ?? false;
  const prdJsonValid = workflow?.prdJsonValid ?? false;
  const canRun = hasPrdJson && prdJsonValid && !isRunning;

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium text-gray-200 mb-1">Execute Ralph Run</h4>
        <p className="text-xs text-gray-500">
          Start the autonomous Ralph loop. It will implement each user story from prd.json wave by wave.
        </p>
      </div>

      {!hasPrdJson && (
        <p className="text-xs text-amber-400">
          No prd.json found. Complete the previous steps first.
        </p>
      )}

      {hasPrdJson && !prdJsonValid && (
        <p className="text-xs text-amber-400">
          prd.json has validation errors. Go back to step 3 to fix them.
        </p>
      )}

      {isRunning ? (
        <p className="text-xs text-green-400 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Ralph is running. See the log viewer below for live output.
        </p>
      ) : (
        <button
          onClick={onStartRun}
          disabled={!canRun}
          className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
        >
          Start Run
        </button>
      )}
    </div>
  );
}

// --- Shared Components ---

function SkillOutputLog({
  projectId,
  running,
  skillStatus,
}: {
  projectId: number;
  running: boolean;
  skillStatus?: { status: string | null; startedAt?: string; exitCode: number | null; skill: string | null } | null;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState('');
  const sinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevRunningRef = useRef(running);

  // Reset when a new skill starts
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      setLines([]);
      sinceRef.current = 0;
    }
    prevRunningRef.current = running;
  }, [running]);

  // Elapsed time ticker
  useEffect(() => {
    if (!running || !skillStatus?.startedAt) {
      return;
    }
    const start = new Date(skillStatus.startedAt).getTime();
    const tick = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, skillStatus?.startedAt]);

  // Poll for output using plain setInterval (avoids TanStack Query caching issues)
  const status = skillStatus?.status;
  const isDone = status === 'completed' || status === 'failed';

  useEffect(() => {
    let active = true;
    let finalFetched = false;

    const fetchOutput = async () => {
      try {
        const data = await getSkillOutput(projectId, sinceRef.current);
        if (!active) return;
        if (data.lines.length > 0) {
          setLines(prev => [...prev, ...data.lines]);
          sinceRef.current = data.total;
        }
      } catch {
        // ignore fetch errors
      }
    };

    // Always do an immediate fetch
    fetchOutput();

    if (running) {
      // Poll every second while running
      const id = setInterval(fetchOutput, 1000);
      return () => { active = false; clearInterval(id); };
    }

    if (isDone && !finalFetched) {
      // One extra fetch after completion to catch final buffered lines
      finalFetched = true;
      // Small delay to let backend flush
      const timeout = setTimeout(fetchOutput, 500);
      return () => { active = false; clearTimeout(timeout); };
    }

    return () => { active = false; };
  }, [running, isDone, projectId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  if (lines.length === 0 && !running && !isDone) return null;

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  return (
    <div className="bg-gray-950 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          Skill Output
          {running && (
            <span className="text-ralph-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-ralph-400 animate-pulse" />
              Running
            </span>
          )}
          {isCompleted && <span className="text-green-400">✓ Completed</span>}
          {isFailed && <span className="text-red-400">✗ Failed{skillStatus?.exitCode != null ? ` (exit ${skillStatus.exitCode})` : ''}</span>}
        </div>
        {elapsed && (
          <span className={isDone ? 'text-gray-600' : 'text-gray-400'}>{elapsed}</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="h-48 overflow-auto p-3 font-mono text-xs text-gray-400"
      >
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap ${line.startsWith('❌') || line.startsWith('Error') ? 'text-red-400' : line.startsWith('✅') ? 'text-green-400' : ''}`}>
            {line}
          </div>
        ))}
        {lines.length === 0 && running && (
          <span className="text-gray-600 flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-gray-600 border-t-ralph-400 rounded-full animate-spin" />
            Waiting for output...
          </span>
        )}
      </div>
    </div>
  );
}
