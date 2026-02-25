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
import { useIsMobile } from '../hooks/useIsMobile';

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

  const isMobile = useIsMobile();
  const [syncMsg, setSyncMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(isMobile);

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
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={() => navigate('/projects')}
            className="text-xs text-gray-500 hover:text-gray-300 mb-2 block min-h-[44px] md:min-h-0 flex items-center"
          >
            &larr; Back to projects
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold">{data.project.name}</h2>
            {isRunning && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Running
              </span>
            )}
          </div>
          {data.branch && (
            <span className="text-xs font-mono bg-ralph-600/20 text-ralph-300 px-2 py-0.5 rounded mt-1 inline-block break-all">
              {data.branch}
            </span>
          )}
          {data.prd?.description && (
            <p className="text-sm text-gray-400 mt-2">{data.prd.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto md:flex-shrink-0">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex-1 md:flex-initial px-4 py-3 md:py-2 border border-red-600 text-red-400 hover:bg-red-600/10 rounded-lg text-sm font-medium transition-colors"
          >
            Delete Project
          </button>
          <div className="relative flex-1 md:flex-initial">
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="w-full px-4 py-3 md:py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
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
        </div>
      </div>

      {/* Workflow Wizard */}
      <WorkflowWizard
        projectId={projectId}
        isRunning={isRunning}
        onStartRun={() => startMutation.mutateAsync()}
        onStopRun={() => stopMutation.mutateAsync()}
      />

      {/* Kanban Board */}
      {data.prd && <KanbanBoard stories={data.prd.userStories} />}

      {/* Log Viewer */}
      <LogViewer projectId={projectId} running={isRunning} />

      {/* Progress Timeline */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setTimelineCollapsed(!timelineCollapsed)}
          className="w-full flex items-center justify-between px-5 py-4 min-h-[44px] md:min-h-0 hover:bg-gray-800/30 transition-colors"
        >
          <h3 className="text-lg font-semibold">Progress Timeline</h3>
          <span className="text-gray-500">{timelineCollapsed ? '▸' : '▾'}</span>
        </button>
        {!timelineCollapsed && (
          <div className="px-5 pb-5">
            <ProgressTimeline progress={data.progress} />
          </div>
        )}
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
