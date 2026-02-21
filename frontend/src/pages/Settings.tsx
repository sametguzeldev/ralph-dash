import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings } from '../lib/api';

export function Settings() {
  const queryClient = useQueryClient();
  const [ralphPath, setRalphPath] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  useEffect(() => {
    if (data?.ralphPath) setRalphPath(data.ralphPath);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (path: string) => updateSettings(path),
    onSuccess: (result) => {
      setMessage({ type: 'success', text: `Saved! Ralph path: ${result.ralphPath}` });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message });
    },
  });

  const handleSave = () => {
    setMessage(null);
    mutation.mutate(ralphPath);
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Ralph Installation Path
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Path to the Ralph repository (e.g., ~/PersonalProjects/ralph)
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={ralphPath}
            onChange={e => setRalphPath(e.target.value)}
            placeholder="~/PersonalProjects/ralph"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
          />
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>

        {message && (
          <p className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}

        <div className="mt-6 border-t border-gray-800 pt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Files copied to projects</h3>
          <ul className="text-xs text-gray-500 space-y-1">
            <li className="font-mono">.claude/skills/prd/SKILL.md</li>
            <li className="font-mono">.claude/skills/prd-questions/SKILL.md</li>
            <li className="font-mono">.claude/skills/ralph/SKILL.md</li>
            <li className="font-mono">scripts/ralph/ralph-cc.sh</li>
            <li className="font-mono">scripts/ralph/CLAUDE.md</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
