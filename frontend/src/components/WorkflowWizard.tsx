import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getWorkflowStatus,
  getSkillOutput,
  getRunOutput,
  startSkillRun,
  stopSkillRun,
  deleteWorkflowFile,
  startReview,
  stopReview,
  getReviewStatus,
  getReviewOutput,
  getSavedReview,
  saveReviewFeedback,
  analyzeFindings,
  generateFixPrd,
  archiveProject,
  type WorkflowStatus,
  type ReviewStatus,
  type Finding,
} from '../lib/api';
import { WizardStepIndicator } from './WizardStepIndicator';
import { FileEditor } from './FileEditor';
import { useIsMobile } from '../hooks/useIsMobile';

/** Shared hook for file-selection state with auto-sync. */
function useSelectedFile(files: string[]): [string, (v: string) => void] {
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (files.length === 0) {
      setSelected('');
    } else if (files.length === 1) {
      setSelected(files[0] ?? '');
    } else if (!files.includes(selected)) {
      setSelected(files[files.length - 1] ?? '');
    }
  }, [files, selected]);

  return [selected, setSelected];
}

interface WorkflowWizardProps {
  projectId: number;
  isRunning: boolean;
  hasProvider: boolean;
  hasReviewProvider: boolean;
  onStartRun: () => Promise<unknown>;
  onStopRun: () => Promise<unknown>;
}

const STEP_LABELS = ['Questions', 'PRD', 'prd.json', 'Run', 'Review'];

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

export function WorkflowWizard({ projectId, isRunning, hasProvider, hasReviewProvider, onStartRun, onStopRun }: WorkflowWizardProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(isMobile);
  const [activeStep, setActiveStep] = useState(0);
  const [featureDesc, setFeatureDesc] = useState('');
  const [editorOpen, setEditorOpen] = useState<{ path: string; type: 'markdown' | 'json' } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleArchiveSuccess = useCallback((msg: string) => {
    setSuccessMessage(msg);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccessMessage(null), 4000);
  }, []);

  // Workflow status (polls faster while a skill is running)
  const { data: workflow } = useQuery({
    queryKey: ['workflow-status', projectId],
    queryFn: () => getWorkflowStatus(projectId),
    refetchInterval: (query) => {
      const running = query.state.data?.skillStatus?.running;
      return running ? 3000 : 5000;
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
        className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-gray-800/50 transition-colors"
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

          {/* Success message (persists across step transitions) */}
          {successMessage && (
            <p className="text-xs text-green-400">{successMessage}</p>
          )}

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
                projectId={projectId}
                isRunning={isRunning}
                hasProvider={hasProvider}
                workflow={workflow}
                onStartRun={onStartRun}
                onStopRun={onStopRun}
              />
            )}
            {activeStep === 4 && (
              <ReviewStep
                projectId={projectId}
                hasReviewProvider={hasReviewProvider}
                workflow={workflow}
                onGoToRun={() => {
                  setActiveStep(3);
                  setUserOverride(true);
                }}
                onArchiveSuccess={handleArchiveSuccess}
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

      <div className="flex flex-col md:flex-row gap-2">
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
          <div className="space-y-1 max-h-[300px] overflow-y-auto md:max-h-none md:overflow-visible">
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
  const [selectedFile, setSelectedFile] = useSelectedFile(questionsFiles);

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
        <div className="flex flex-col md:flex-row md:items-center gap-2">
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
          <div className="space-y-1 max-h-[300px] overflow-y-auto md:max-h-none md:overflow-visible">
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
  const [selectedFile, setSelectedFile] = useSelectedFile(prdFiles);
  const hasPrdJson = workflow?.hasPrdJson ?? false;
  const prdJsonValid = workflow?.prdJsonValid ?? false;

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
        <div className="flex flex-col md:flex-row md:items-center gap-2">
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
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Valid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-400 border border-red-800">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Invalid
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// --- Step 4: Run ---

function RunStep({
  projectId,
  isRunning,
  hasProvider,
  workflow,
  onStartRun,
  onStopRun,
}: {
  projectId: number;
  isRunning: boolean;
  hasProvider: boolean;
  workflow: WorkflowStatus | undefined;
  onStartRun: () => Promise<unknown>;
  onStopRun: () => Promise<unknown>;
}) {
  const hasPrdJson = workflow?.hasPrdJson ?? false;
  const prdJsonValid = workflow?.prdJsonValid ?? false;
  const canRun = hasPrdJson && prdJsonValid && hasProvider && !isRunning;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);

  // Track when a run starts so the output log stays visible after it finishes
  useEffect(() => {
    if (isRunning) setHasStarted(true);
  }, [isRunning]);

  const handleStart = async () => {
    setPending(true);
    setError(null);
    try {
      await onStartRun();
      setHasStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setPending(false);
    }
  };

  const handleStop = async () => {
    setPending(true);
    setError(null);
    try {
      await onStopRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop run');
    } finally {
      setPending(false);
    }
  };

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

      {!hasProvider && (
        <p className="text-xs text-amber-400">
          No model provider assigned. Select a provider at the top of the page to start runs.
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {isRunning ? (
        <div className="flex items-center gap-3">
          <button
            onClick={handleStop}
            disabled={pending}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            {pending ? 'Stopping...' : 'Stop Run'}
          </button>
          <p className="text-xs text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Running
          </p>
        </div>
      ) : (
        <button
          onClick={handleStart}
          disabled={!canRun || pending}
          className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
        >
          {pending ? 'Starting...' : 'Start Run'}
        </button>
      )}

      {/* Inline run output log */}
      {(isRunning || hasStarted) && (
        <RunOutputLog projectId={projectId} running={isRunning} />
      )}
    </div>
  );
}

// --- Step 5: Review ---

function ReviewStep({
  projectId,
  hasReviewProvider,
  workflow,
  onGoToRun,
  onArchiveSuccess,
}: {
  projectId: number;
  hasReviewProvider: boolean;
  workflow: WorkflowStatus | undefined;
  onGoToRun: () => void;
  onArchiveSuccess: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const hasPrdJson = workflow?.hasPrdJson ?? false;
  const prdJsonValid = workflow?.prdJsonValid ?? false;
  const [baseBranch, setBaseBranch] = useState('main');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const { data: reviewStatus } = useQuery({
    queryKey: ['review-status', projectId],
    queryFn: () => getReviewStatus(projectId),
    refetchInterval: (query) => query.state.data?.running ? 2000 : 5000,
  });

  const isReviewRunning = reviewStatus?.running ?? false;
  const reviewDone = hasStarted && !isReviewRunning && (reviewStatus?.status === 'completed' || reviewStatus?.status === 'failed');

  useEffect(() => {
    if (isReviewRunning) setHasStarted(true);
  }, [isReviewRunning]);

  useEffect(() => {
    if (reviewStatus && !hasStarted) {
      const s = reviewStatus.status;
      if (s === 'completed' || s === 'failed') {
        setHasStarted(true);
      }
    }
  }, [reviewStatus, hasStarted]);

  const handleStart = async () => {
    setPending(true);
    setError(null);
    try {
      await startReview(projectId, baseBranch);
      setHasStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start review');
    } finally {
      setPending(false);
    }
  };

  const handleStop = async () => {
    setPending(true);
    setError(null);
    try {
      await stopReview(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop review');
    } finally {
      setPending(false);
    }
  };

  const handleDone = async () => {
    setActionPending(true);
    setError(null);
    try {
      await archiveProject(projectId);
      queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-status', projectId] });
      setHasStarted(false);
      onArchiveSuccess('Feature archived successfully! Workflow has been reset.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive project');
    } finally {
      setActionPending(false);
    }
  };

  const handleFixAndRerun = async () => {
    setActionPending(true);
    setError(null);
    try {
      await saveReviewFeedback(projectId);
      setHasStarted(false);
      onGoToRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save review feedback');
    } finally {
      setActionPending(false);
    }
  };

  const handleSkipArchive = async () => {
    setShowSkipConfirm(false);
    setActionPending(true);
    setError(null);
    try {
      await archiveProject(projectId);
      queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-status', projectId] });
      setHasStarted(false);
      onArchiveSuccess('Feature archived successfully! Workflow has been reset.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive project');
    } finally {
      setActionPending(false);
    }
  };

  const canStart = hasPrdJson && prdJsonValid && hasReviewProvider && !isReviewRunning && baseBranch.trim().length > 0;

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium text-gray-200 mb-1">Code Review</h4>
        <p className="text-xs text-gray-500">
          Run an AI-powered review of changes on the current branch against the base branch.
        </p>
      </div>

      {!hasReviewProvider && (
        <p className="text-xs text-amber-400">
          No review provider configured. Select a review provider at the top of the page to enable reviews.
        </p>
      )}

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

      <div className="flex flex-col md:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs text-gray-400 shrink-0">Base branch</label>
          <input
            type="text"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            disabled={isReviewRunning}
            placeholder="main"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-ralph-500 disabled:opacity-50"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {isReviewRunning ? (
        <div className="flex items-center gap-3">
          <button
            onClick={handleStop}
            disabled={pending}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            {pending ? 'Stopping...' : 'Stop Review'}
          </button>
          <p className="text-xs text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Reviewing
          </p>
        </div>
      ) : (
        <button
          onClick={handleStart}
          disabled={!canStart || pending}
          className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
        >
          {pending ? 'Starting...' : 'Start Review'}
        </button>
      )}

      {(isReviewRunning || hasStarted) && (
        <ReviewOutputLog projectId={projectId} running={isReviewRunning} reviewStatus={reviewStatus ?? null} />
      )}

      {reviewDone && (
        <>
          <TriagePanel projectId={projectId} onGoToRun={onGoToRun} />
          <div className="flex items-center gap-3 pt-2 border-t border-gray-700">
            <button
              onClick={handleDone}
              disabled={actionPending}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {actionPending ? 'Archiving...' : 'Done'}
            </button>
            <button
              onClick={handleFixAndRerun}
              disabled={actionPending}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {actionPending ? 'Saving feedback...' : 'Fix & Re-run'}
            </button>
          </div>
        </>
      )}

      {hasPrdJson && prdJsonValid && !isReviewRunning && (
        <div className="pt-2 border-t border-gray-700">
          {showSkipConfirm ? (
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-300">Archive this feature without reviewing?</p>
              <button
                onClick={handleSkipArchive}
                disabled={actionPending}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-xs font-medium"
              >
                {actionPending ? 'Archiving...' : 'Yes, archive'}
              </button>
              <button
                onClick={() => setShowSkipConfirm(false)}
                disabled={actionPending}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSkipConfirm(true)}
              disabled={actionPending}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium text-gray-300"
            >
              Skip &amp; Archive
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewOutputLog({
  projectId,
  running,
  reviewStatus,
}: {
  projectId: number;
  running: boolean;
  reviewStatus: ReviewStatus | null;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState('');
  const sinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevRunningRef = useRef(running);

  useEffect(() => {
    if (running && !prevRunningRef.current) {
      setLines([]);
      setSavedContent(null);
      sinceRef.current = 0;
    }
    prevRunningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!running || !reviewStatus?.startedAt) return;
    const start = new Date(reviewStatus.startedAt).getTime();
    const tick = () => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, reviewStatus?.startedAt]);

  const status = reviewStatus?.status;
  const isDone = status === 'completed' || status === 'failed';
  const noActiveRun = !running && !isDone;

  // Load saved review from disk when no active in-memory run
  useEffect(() => {
    if (!noActiveRun) return;
    getSavedReview(projectId)
      .then(({ content }) => { if (content) setSavedContent(content); })
      .catch(() => {});
  }, [noActiveRun, projectId]);

  useEffect(() => {
    let active = true;
    let finalFetched = false;

    const fetchOutput = async () => {
      try {
        const data = await getReviewOutput(projectId, sinceRef.current);
        if (!active) return;
        if (data.lines.length > 0) {
          setLines(prev => [...prev, ...data.lines]);
          sinceRef.current = data.total;
        }
      } catch {
        // ignore fetch errors
      }
    };

    fetchOutput();

    if (running) {
      const id = setInterval(fetchOutput, 1000);
      return () => { active = false; clearInterval(id); };
    }

    if (isDone && !finalFetched) {
      finalFetched = true;
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

  if (lines.length === 0 && !running && !isDone && !savedContent) return null;

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';
  const showingSaved = lines.length === 0 && !running && !isDone && !!savedContent;

  return (
    <div className="bg-gray-950 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          Review Output
          {running && (
            <span className="text-ralph-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-ralph-400 animate-pulse" />
              Running
            </span>
          )}
          {isCompleted && <span className="text-green-400">Completed</span>}
          {isFailed && <span className="text-red-400">Failed{reviewStatus?.exitCode != null ? ` (exit ${reviewStatus.exitCode})` : ''}</span>}
          {showingSaved && <span className="text-gray-500">Saved</span>}
        </div>
        {elapsed && (
          <span className={isDone ? 'text-gray-600' : 'text-gray-400'}>{elapsed}</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="h-36 md:h-48 overflow-auto p-3 font-mono text-xs text-gray-400"
      >
        {showingSaved ? (
          <div className="whitespace-pre-wrap">{savedContent}</div>
        ) : (
          <>
            {lines.map((line, i) => (
              <div key={i} className={`whitespace-pre-wrap ${line.startsWith('Error') ? 'text-red-400' : ''}`}>
                {line}
              </div>
            ))}
            {lines.length === 0 && running && (
              <span className="text-gray-600 flex items-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-gray-600 border-t-ralph-400 rounded-full animate-spin" />
                Waiting for output...
              </span>
            )}
            {lines.length === 0 && !running && (
              <span className="text-gray-600">No output captured.</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Triage Panel ---

function TriagePanel({ projectId, onGoToRun }: { projectId: number; onGoToRun: () => void }) {
  const queryClient = useQueryClient();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const { findings: result } = await analyzeFindings(projectId);
      setFindings(result);
      const initial: Record<string, boolean> = {};
      for (const f of result) {
        initial[f.id] = f.severity === 'required';
      }
      setChecked(initial);
      setLoaded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      if (msg.includes('review-output') || msg.includes('No review output')) {
        setError('No review output found. Run a review first.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (id: string) => {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const required = findings.filter(f => f.severity === 'required');
  const niceToHave = findings.filter(f => f.severity === 'nice-to-have');

  if (!loaded) {
    return (
      <div className="space-y-2">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          {loading && <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />}
          {loading ? 'Analyzing...' : 'Analyze Findings'}
        </button>
      </div>
    );
  }

  const renderFinding = (f: Finding) => (
    <div key={f.id} className="bg-gray-800 rounded-lg p-3">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked[f.id] ?? false}
          onChange={() => toggleCheck(f.id)}
          className="mt-1 accent-ralph-500"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => toggleExpand(f.id)}
              className="text-sm text-gray-200 text-left hover:text-white"
            >
              {f.title}
            </button>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
              f.severity === 'required'
                ? 'bg-red-900/50 text-red-400'
                : 'bg-yellow-900/50 text-yellow-400'
            }`}>
              {f.severity === 'required' ? 'Required' : 'Nice to have'}
            </span>
          </div>
          {expanded[f.id] && (
            <p className="text-xs text-gray-400 mt-1.5 whitespace-pre-wrap">{f.description}</p>
          )}
        </div>
        <button
          onClick={() => toggleExpand(f.id)}
          className="text-gray-500 hover:text-gray-300 text-xs shrink-0"
        >
          {expanded[f.id] ? '▲' : '▼'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-gray-200">
          Findings ({findings.length})
        </h5>
        <span className="text-xs text-gray-500">{checkedCount} selected</span>
      </div>

      {required.length > 0 && (
        <div className="space-y-1.5">
          <h6 className="text-xs text-red-400 font-medium">Required ({required.length})</h6>
          {required.map(renderFinding)}
        </div>
      )}

      {niceToHave.length > 0 && (
        <div className="space-y-1.5">
          <h6 className="text-xs text-yellow-400 font-medium">Nice to have ({niceToHave.length})</h6>
          {niceToHave.map(renderFinding)}
        </div>
      )}

      {findings.length === 0 && (
        <p className="text-xs text-gray-500">No findings extracted from the review.</p>
      )}

      {showConfirm ? (
        <div className="bg-gray-800 rounded-lg p-3 space-y-2">
          <p className="text-sm text-gray-200">
            Archive the current run and generate a fix PRD from {checkedCount} selected finding{checkedCount !== 1 ? 's' : ''}?
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setGenerating(true);
                setError(null);
                try {
                  const selected = findings.filter(f => checked[f.id]);
                  await generateFixPrd(projectId, selected);
                  queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] });
                  queryClient.invalidateQueries({ queryKey: ['project-status', projectId] });
                  onGoToRun();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to generate fix PRD');
                } finally {
                  setGenerating(false);
                }
              }}
              disabled={generating}
              className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              {generating && <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />}
              {generating ? 'Generating...' : 'Confirm'}
            </button>
            <button
              onClick={() => { setShowConfirm(false); setError(null); }}
              disabled={generating}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
          disabled={checkedCount === 0}
          className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
        >
          Generate Fix PRD ({checkedCount})
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
        className="h-36 md:h-48 overflow-auto p-3 font-mono text-xs text-gray-400"
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

function RunOutputLog({ projectId, running }: { projectId: number; running: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevRunningRef = useRef(running);
  const sinceRef = useRef(0);

  // Clear output when projectId changes
  useEffect(() => {
    setLines([]);
    sinceRef.current = 0;
  }, [projectId]);

  // Use useQuery for polling run output
  const { data, refetch } = useQuery({
    queryKey: ['run-output', projectId],
    queryFn: () => getRunOutput(projectId, sinceRef.current),
    refetchInterval: running ? 3000 : false,
  });

  // Reset when a new run starts or final refetch when stops
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      setLines([]);
      sinceRef.current = 0;
    }
    // Final refetch when run stops
    if (!running && prevRunningRef.current) {
      refetch();
    }
    prevRunningRef.current = running;
  }, [running, refetch]);

  // Update lines from query data
  useEffect(() => {
    if (data?.lines) {
      if (data.lines.length > 0) {
        setLines(prev => [...prev, ...data.lines]);
        sinceRef.current = data.total;
      }
    }
  }, [data]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="bg-gray-950 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-800 flex items-center gap-2">
        Run Output
        {running && (
          <span className="text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live
          </span>
        )}
        {!running && lines.length > 0 && (
          <span className="text-gray-600">Finished</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="h-36 md:h-48 overflow-auto p-3 font-mono text-xs text-gray-400"
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
        {lines.length === 0 && !running && (
          <span className="text-gray-600">No output captured.</span>
        )}
      </div>
    </div>
  );
}
