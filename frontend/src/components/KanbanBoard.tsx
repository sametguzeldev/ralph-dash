import { useState } from 'react';
import type { UserStoryWithStatus } from '../lib/api';

const COLUMNS: { key: UserStoryWithStatus['status']; label: string; color: string }[] = [
  { key: 'pending', label: 'Pending', color: 'border-gray-600' },
  { key: 'in_progress', label: 'In Progress', color: 'border-yellow-500' },
  { key: 'done', label: 'Done', color: 'border-green-500' },
];

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-500/20 text-red-300',
  2: 'bg-orange-500/20 text-orange-300',
  3: 'bg-yellow-500/20 text-yellow-300',
  4: 'bg-blue-500/20 text-blue-300',
  5: 'bg-gray-500/20 text-gray-300',
};

function TaskCard({ story }: { story: UserStoryWithStatus }) {
  const [expanded, setExpanded] = useState(false);
  const priorityClass = PRIORITY_COLORS[story.priority] || PRIORITY_COLORS[5]!;

  return (
    <div
      className="bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-750 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-mono text-ralph-400">{story.id}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${priorityClass}`}>
          P{story.priority}
        </span>
      </div>
      <h4 className="text-sm font-medium text-gray-200">{story.title}</h4>

      {expanded && (
        <div className="mt-3 space-y-2 overflow-hidden">
          <p className="text-xs text-gray-400 break-words">{story.description}</p>
          <div>
            <p className="text-xs font-medium text-gray-300 mb-1">Acceptance Criteria:</p>
            <ul className="space-y-1">
              {story.acceptanceCriteria.map((ac, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-400 break-words min-w-0">
                  <span className={story.passes ? 'text-green-400' : 'text-gray-600'}>
                    {story.passes ? '✓' : '○'}
                  </span>
                  {ac}
                </li>
              ))}
            </ul>
          </div>
          {story.notes && (
            <p className="text-xs text-gray-500 italic">{story.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({ stories }: { stories: UserStoryWithStatus[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {COLUMNS.map(col => {
        const colStories = stories
          .filter(s => s.status === col.key)
          .sort((a, b) => a.priority - b.priority);

        return (
          <div key={col.key} className={`border-t-2 ${col.color} pt-3`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-300">{col.label}</h3>
              <span className="text-xs text-gray-500">{colStories.length}</span>
            </div>
            <div className="space-y-2 max-h-[50vh] md:max-h-none overflow-y-auto">
              {colStories.map(story => (
                <TaskCard key={story.id} story={story} />
              ))}
              {colStories.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-4">No stories</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
