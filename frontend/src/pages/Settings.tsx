import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, saveClaudeToken, deleteClaudeToken } from '../lib/api';

export function Settings() {
  const queryClient = useQueryClient();
  const [ralphPath, setRalphPath] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Claude token state
  const [claudeToken, setClaudeToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const tokenMutation = useMutation({
    mutationFn: (token: string) => saveClaudeToken(token),
    onSuccess: (result) => {
      const typeLabel = result.tokenType === 'oauth' ? 'OAuth Token' : 'API Key';
      setTokenMessage({ type: 'success', text: `Saved! Token type: ${typeLabel}` });
      setClaudeToken('');
      setShowToken(false);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteClaudeToken(),
    onSuccess: () => {
      setTokenMessage({ type: 'success', text: 'Token removed' });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const handleSave = () => {
    setMessage(null);
    mutation.mutate(ralphPath);
  };

  const handleSaveToken = () => {
    setTokenMessage(null);
    tokenMutation.mutate(claudeToken);
  };

  const handleRemoveToken = () => {
    setTokenMessage(null);
    deleteMutation.mutate();
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

      {/* Claude Authentication — only shown for Docker users */}
      {data?.isDocker && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mt-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-300">
              Claude Authentication
            </label>
            {data.claudeConfigured && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Configured
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Run <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">claude setup-token</code> locally to get an OAuth token, or use an API key from{' '}
            <span className="text-gray-400">console.anthropic.com</span>.
          </p>

          {data.claudeConfigured ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">Token is stored securely.</span>
              <button
                onClick={handleRemoveToken}
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
              >
                {deleteMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={claudeToken}
                  onChange={e => setClaudeToken(e.target.value)}
                  placeholder="sk-ant-oat01-... or sk-ant-api03-..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 pr-16 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
              <button
                onClick={handleSaveToken}
                disabled={tokenMutation.isPending || !claudeToken.trim()}
                className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {tokenMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}

          {tokenMessage && (
            <p className={`mt-3 text-sm ${tokenMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {tokenMessage.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
