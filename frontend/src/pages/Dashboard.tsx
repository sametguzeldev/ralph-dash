import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProjectStatus, startRun, stopRun, syncProjectFiles } from '../lib/api';
import { KanbanBoard } from '../components/KanbanBoard';
import { ProgressTimeline } from '../components/ProgressTimeline';
import { LogViewer } from '../components/LogViewer';
import { RunHistory } from '../components/RunHistory';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { WorkflowWizard } from '../components/WorkflowWizard';

export function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectId = parseInt(id!, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['project-status', projectId],
    queryFn: () => getProjectStatus(projectId),
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: () => startRun(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-status', projectId] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => stopRun(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-status', projectId] }),
  });

  const [syncMsg, setSyncMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const syncMutation = useMutation({
    mutationFn: () => syncProjectFiles(projectId),
    onSuccess: () => {
      setSyncMsg({ type: 'success', text: 'Files synced!' });
      setTimeout(() => setSyncMsg(null), 3000);
    },
    onError: (err: Error) => {
      setSyncMsg({ type: 'error', text: err.message });
      setTimeout(() => setSyncMsg(null), 5000);
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-96 bg-gray-900 rounded-xl" />;
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p>Project not found</p>
        <button onClick={() => navigate('/projects')} className="text-ralph-400 mt-2">
          Back to projects
        </button>
      </div>
    );
  }

  const isRunning = data.runStatus === 'running';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/projects')}
            className="text-xs text-gray-500 hover:text-gray-300 mb-2 block"
          >
            &larr; Back to projects
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">{data.project.name}</h2>
            {isRunning && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Running
              </span>
            )}
          </div>
          {data.branch && (
            <span className="text-xs font-mono bg-ralph-600/20 text-ralph-300 px-2 py-0.5 rounded mt-1 inline-block">
              {data.branch}
            </span>
          )}
          {data.prd?.description && (
            <p className="text-sm text-gray-400 mt-2">{data.prd.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 border border-red-600 text-red-400 hover:bg-red-600/10 rounded-lg text-sm font-medium transition-colors"
          >
            Delete Project
          </button>
          <div className="relative">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              title="Re-copy skills & scripts from Ralph source"
            >
              {syncMutation.isPending ? 'Syncing...' : 'Sync Files'}
            </button>
            {syncMsg && (
              <span className={`absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs ${
                syncMsg.type === 'success' ? 'text-green-400' : 'text-red-400'
              }`}>
                {syncMsg.text}
              </span>
            )}
          </div>
          {isRunning ? (
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              Stop Run
            </button>
          ) : (
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || !data.prd}
              className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              Start Run
            </button>
          )}
        </div>
      </div>

      {/* Workflow Wizard */}
      <WorkflowWizard
        projectId={projectId}
        isRunning={isRunning}
        onStartRun={() => startMutation.mutate()}
      />

      {/* Kanban Board */}
      {data.prd && <KanbanBoard stories={data.prd.userStories} />}

      {/* Log Viewer */}
      <LogViewer projectId={projectId} running={isRunning} />

      {/* Progress Timeline */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-lg font-semibold mb-4">Progress Timeline</h3>
        <ProgressTimeline progress={data.progress} />
      </div>

      {/* Run History */}
      <RunHistory projectId={projectId} />

      {showDeleteModal && (
        <DeleteConfirmModal
          projectName={data.project.name}
          projectId={projectId}
          isRunning={isRunning}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => navigate('/projects')}
        />
      )}
    </div>
  );
}
