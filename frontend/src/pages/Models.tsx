import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProvider,
  saveProviderToken,
  deleteProviderToken,
  saveProviderModel,
  deleteProviderModel,
  saveProviderPreferences,
  type ProviderResponse,
} from '../lib/api';

const PROVIDER_TABS = [{ key: 'claude', label: 'Claude' }] as const;

function formatVariantLabel(variant: string): string {
  if (variant.includes('opus')) return 'Opus';
  if (variant.includes('sonnet')) return 'Sonnet';
  if (variant.includes('haiku')) return 'Haiku';
  return variant;
}

function ClaudeTab({ provider }: { provider: ProviderResponse }) {
  const queryClient = useQueryClient();
  const config = provider.config as Record<string, unknown>;

  // Authentication state
  const [claudeToken, setClaudeToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Model state
  const [claudeModel, setClaudeModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [modelMessage, setModelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-memory state
  const preferences = (config.preferences ?? {}) as Record<string, unknown>;
  const [autoMemoryEnabled, setAutoMemoryEnabled] = useState(preferences.autoMemoryEnabled !== false);
  const [autoMemoryMessage, setAutoMemoryMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const prefs = (provider.config as Record<string, unknown>).preferences as Record<string, unknown> | undefined;
    setAutoMemoryEnabled(prefs?.autoMemoryEnabled !== false);
  }, [provider]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['provider', 'claude'] });

  // Token mutations
  const tokenMutation = useMutation({
    mutationFn: (token: string) => saveProviderToken('claude', token),
    onSuccess: (result) => {
      const typeLabel = result.tokenType === 'oauth' ? 'OAuth Token' : 'API Key';
      setTokenMessage({ type: 'success', text: `Saved! Token type: ${typeLabel}` });
      setClaudeToken('');
      setShowToken(false);
      invalidate();
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProviderToken('claude'),
    onSuccess: () => {
      setTokenMessage({ type: 'success', text: 'Token removed' });
      invalidate();
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  // Model mutations
  const modelSaveMutation = useMutation({
    mutationFn: (model: string) => saveProviderModel('claude', model),
    onSuccess: (result) => {
      setModelMessage({ type: 'success', text: `Saved! Model: ${result.model}` });
      invalidate();
    },
    onError: (err: Error) => {
      setModelMessage({ type: 'error', text: err.message });
    },
  });

  const modelDeleteMutation = useMutation({
    mutationFn: () => deleteProviderModel('claude'),
    onSuccess: () => {
      setModelMessage({ type: 'success', text: 'Model preference removed (using default)' });
      setClaudeModel('');
      setCustomModel('');
      invalidate();
    },
    onError: (err: Error) => {
      setModelMessage({ type: 'error', text: err.message });
    },
  });

  // Preferences mutation
  const preferencesMutation = useMutation({
    mutationFn: (prefs: Record<string, unknown>) => saveProviderPreferences('claude', prefs),
    onSuccess: () => {
      invalidate();
    },
    onError: (err: Error, prefs: Record<string, unknown>) => {
      setAutoMemoryEnabled(!(prefs.autoMemoryEnabled as boolean));
      setAutoMemoryMessage({ type: 'error', text: err.message });
    },
  });

  const handleSaveToken = () => {
    setTokenMessage(null);
    tokenMutation.mutate(claudeToken);
  };

  const handleRemoveToken = () => {
    setTokenMessage(null);
    deleteMutation.mutate();
  };

  const handleSaveModel = () => {
    setModelMessage(null);
    const model = claudeModel === 'custom' ? customModel.trim() : claudeModel;
    if (!model) {
      setModelMessage({ type: 'error', text: 'Please select or enter a model' });
      return;
    }
    modelSaveMutation.mutate(model);
  };

  const handleRemoveModel = () => {
    setModelMessage(null);
    modelDeleteMutation.mutate();
  };

  const currentModel = config.claudeModel as string | undefined;

  return (
    <div className="space-y-6">
      {/* Authentication */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-300">
            Authentication
          </label>
          {provider.is_configured && (
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

        {provider.is_configured ? (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <span className="text-sm text-gray-400">Token is stored securely.</span>
            <button
              onClick={handleRemoveToken}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {deleteMutation.isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type={showToken ? 'text' : 'password'}
                value={claudeToken}
                onChange={e => setClaudeToken(e.target.value)}
                placeholder="sk-ant-oat01-... or sk-ant-api03-..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] pr-16 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 min-h-[44px] transition-colors"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={handleSaveToken}
              disabled={tokenMutation.isPending || !claudeToken.trim()}
              className="px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
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

      {/* Model Selection */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-300">
            Model Selection
          </label>
          {currentModel && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              {currentModel}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Choose which Claude model to use for skill runs and Ralph iterations. Leave as default to use Claude Code's default model.
        </p>

        {currentModel ? (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <span className="text-sm text-gray-400">Current model: <span className="font-mono text-gray-200">{currentModel}</span></span>
            <button
              onClick={handleRemoveModel}
              disabled={modelDeleteMutation.isPending}
              className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {modelDeleteMutation.isPending ? 'Removing...' : 'Reset to Default'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <select
              value={claudeModel}
              onChange={e => { setClaudeModel(e.target.value); setModelMessage(null); }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
            >
              <option value="">Select a model...</option>
              {((config.modelVariants as string[] | undefined) ?? []).map((v: string) => (
                <option key={v} value={v}>{formatVariantLabel(v)}</option>
              ))}
              <option value="custom">Custom model ID...</option>
            </select>
            {claudeModel === 'custom' && (
              <input
                type="text"
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder="e.g., claude-sonnet-4-6"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500 font-mono"
              />
            )}
            <button
              onClick={handleSaveModel}
              disabled={modelSaveMutation.isPending || (!claudeModel || (claudeModel === 'custom' && !customModel.trim()))}
              className="px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {modelSaveMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}

        {modelMessage && (
          <p className={`mt-3 text-sm ${modelMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {modelMessage.text}
          </p>
        )}
      </div>

      {/* Preferences */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <label className="block text-sm font-medium text-gray-300 mb-4">
          Preferences
        </label>
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={autoMemoryEnabled}
            onChange={e => {
              const next = e.target.checked;
              setAutoMemoryEnabled(next);
              setAutoMemoryMessage(null);
              preferencesMutation.mutate({ ...preferences, autoMemoryEnabled: next });
            }}
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-ralph-600 focus:ring-ralph-500 focus:ring-offset-gray-900 cursor-pointer"
          />
          <div>
            <span className="text-sm font-medium text-gray-300 group-hover:text-gray-100 transition-colors">
              Enable auto memory
            </span>
            <p className="text-xs text-gray-500 mt-0.5">
              When enabled, Claude will remember project patterns and learnings across sessions
            </p>
          </div>
        </label>
        {autoMemoryMessage && (
          <p className={`mt-2 text-sm ${autoMemoryMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {autoMemoryMessage.text}
          </p>
        )}
      </div>
    </div>
  );
}

export function Models() {
  const [activeTab, setActiveTab] = useState<string>(PROVIDER_TABS[0].key);

  const { data: provider, isLoading } = useQuery({
    queryKey: ['provider', activeTab],
    queryFn: () => getProvider(activeTab),
  });

  return (
    <div className="md:max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Models</h2>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {PROVIDER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-ralph-500 text-ralph-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : provider ? (
        activeTab === 'claude' && <ClaudeTab provider={provider} />
      ) : (
        <div className="text-sm text-red-400">Failed to load provider configuration.</div>
      )}
    </div>
  );
}
