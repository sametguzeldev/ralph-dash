import { useState } from 'react';
import type { ProgressData } from '../lib/api';

function TimelineEntry({ entry }: { entry: ProgressData['entries'][number] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative pl-6 pb-4">
      <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full bg-ralph-500 border-2 border-gray-900" />
      <div
        className="cursor-pointer hover:bg-gray-800/50 rounded-lg p-2 -ml-2 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500">{entry.date}</span>
          <span className="text-xs font-mono text-ralph-400">{entry.storyId}</span>
        </div>

        {expanded ? (
          <div className="space-y-2">
            <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans">{entry.content}</pre>
            {entry.learnings.length > 0 && (
              <div className="mt-2 bg-ralph-600/10 rounded p-2">
                <p className="text-xs font-medium text-ralph-300 mb-1">Learnings:</p>
                <ul className="text-xs text-gray-400 space-y-1">
                  {entry.learnings.map((l, i) => (
                    <li key={i}>- {l}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 truncate">
            {entry.content.split('\n')[0]}
          </p>
        )}
      </div>
    </div>
  );
}

export function ProgressTimeline({ progress }: { progress: ProgressData | null }) {
  if (!progress) {
    return <p className="text-sm text-gray-500">No progress log found</p>;
  }

  return (
    <div>
      {progress.codebasePatterns.length > 0 && (
        <div className="bg-ralph-600/10 border border-ralph-600/20 rounded-xl p-4 mb-4">
          <h4 className="text-sm font-medium text-ralph-300 mb-2">Codebase Patterns</h4>
          <ul className="text-xs text-gray-400 space-y-1">
            {progress.codebasePatterns.map((p, i) => (
              <li key={i}>- {p}</li>
            ))}
          </ul>
        </div>
      )}

      {progress.startedAt && (
        <p className="text-xs text-gray-500 mb-4">Started: {progress.startedAt}</p>
      )}

      <div className="border-l border-gray-800 ml-1.5">
        {progress.entries.length === 0 ? (
          <p className="text-xs text-gray-600 pl-6">No entries yet</p>
        ) : (
          [...progress.entries].reverse().map((entry, i) => (
            <TimelineEntry key={i} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
