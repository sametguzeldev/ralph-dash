import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getArchives, getArchiveDetail, type ArchiveSummary } from '../lib/api';
import { KanbanBoard } from './KanbanBoard';
import { ProgressTimeline } from './ProgressTimeline';

function ArchiveRow({ projectId, archive }: { projectId: number; archive: ArchiveSummary }) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['archive-detail', projectId, archive.folder],
    queryFn: () => getArchiveDetail(projectId, archive.folder),
    enabled: expanded,
  });

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 font-mono">{archive.date}</span>
          <span className="text-sm text-gray-200">{archive.featureName}</span>
          <span className="text-xs font-mono bg-ralph-600/20 text-ralph-300 px-2 py-0.5 rounded">
            {archive.branchName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {archive.doneStories}/{archive.totalStories} done
          </span>
          <span className="text-gray-500">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4 space-y-4 bg-gray-900/50">
          {isLoading ? (
            <div className="animate-pulse h-32 bg-gray-800 rounded-lg" />
          ) : isError ? (
            <p className="text-sm text-red-400">Failed to load archive data.</p>
          ) : data?.prd ? (
            <>
              {data.prd.description && (
                <p className="text-xs text-gray-400">{data.prd.description}</p>
              )}
              <KanbanBoard stories={data.prd.userStories} />
              {data.progress && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">Progress</h4>
                  <ProgressTimeline progress={data.progress} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">No data found in this archive</p>
          )}
        </div>
      )}
    </div>
  );
}

export function RunHistory({ projectId }: { projectId: number }) {
  const [collapsed, setCollapsed] = useState(true);

  const { data: archives, isError } = useQuery({
    queryKey: ['archives', projectId],
    queryFn: () => getArchives(projectId),
  });

  const count = archives?.length ?? 0;

  if (isError && count === 0) return <p className="text-sm text-red-400 px-1">Failed to load run history.</p>;
  if (count === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/30 transition-colors"
      >
        <h3 className="text-lg font-semibold">
          History{' '}
          <span className="text-sm font-normal text-gray-500">
            ({count} past run{count !== 1 ? 's' : ''})
          </span>
        </h3>
        <span className="text-gray-500">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-2">
          {archives?.map(archive => (
            <ArchiveRow key={archive.folder} projectId={projectId} archive={archive} />
          ))}
        </div>
      )}
    </div>
  );
}
