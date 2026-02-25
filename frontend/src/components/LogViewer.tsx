import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRunOutput } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';

export function LogViewer({ projectId, running }: { projectId: number; running: boolean }) {
  const isMobile = useIsMobile();
  const [since, setSince] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(isMobile);
  const prevRunningRef = useRef(running);

  // Auto-expand when a run is actively in progress (even on mobile)
  useEffect(() => {
    if (running) setCollapsed(false);
  }, [running]);

  // Reset log when navigating to a different project
  useEffect(() => {
    setLines([]);
    setSince(0);
  }, [projectId]);

  // Reset log when a new run starts (running transitions false → true)
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      setLines([]);
      setSince(0);
    }
    prevRunningRef.current = running;
  }, [running]);

  useQuery({
    queryKey: ['run-output', projectId, since],
    queryFn: async () => {
      const data = await getRunOutput(projectId, since);
      if (data.lines.length > 0) {
        setLines(prev => [...prev, ...data.lines]);
        setSince(data.total);
      }
      return data;
    },
    refetchInterval: running ? 1000 : false,
    enabled: running || lines.length > 0,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  if (lines.length === 0 && !running) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2 min-h-[44px] md:min-h-0 text-sm text-gray-300 hover:bg-gray-800"
      >
        <span>Run Output {running && <span className="text-green-400 ml-2">● Live</span>}</span>
        <span>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div
          ref={scrollRef}
          className="h-64 overflow-auto p-4 font-mono text-xs text-gray-400 bg-gray-950"
        >
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">{line}</div>
          ))}
          {lines.length === 0 && <span className="text-gray-600">Waiting for output...</span>}
        </div>
      )}
    </div>
  );
}
