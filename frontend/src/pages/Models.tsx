import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProvider,
  saveProviderToken,
  saveCodexChatGptAuth,
  deleteProviderToken,
  saveProviderModel,
  deleteProviderModel,
  saveProviderPreferences,
  type ProviderResponse,
} from '../lib/api';

const PROVIDER_TABS = [
  { key: 'claude', label: 'Claude' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'codex', label: 'Codex' },
] as const;

function formatVariantLabel(variant: string): string {
  if (variant.includes('opus')) return 'Opus';
  if (variant.includes('sonnet')) return 'Sonnet';
  if (variant.includes('haiku')) return 'Haiku';
  return variant;
}

/** Configuration for a provider's authentication section */
interface AuthSectionConfig {
  /** Additional fields to show before the token input */
  extraFields?: React.ReactNode;
  /** Token input placeholder text */
  tokenPlaceholder?: string;
  /** Help text shown below the label */
  helpText?: React.ReactNode;
}

/** Configuration for a provider's model section */
interface ModelSectionConfig {
  /** Whether this provider has a model dropdown with variants */
  hasModelDropdown?: boolean;
  /** Whether this provider allows custom model input */
  hasCustomModel?: boolean;
  /** Whether to show a "reset to default" button (vs just "remove") */
  resetToDefault?: boolean;
  /** Custom model input placeholder */
  customModelPlaceholder?: string;
  /** Function to format model variant labels */
  formatLabel?: (variant: string) => string;
  /** Key to use for reading model from config (default: 'model') */
  modelKey?: string;
}

/** Configuration for a provider's preferences section */
interface PreferencesSectionConfig {
  /** Whether this provider has preferences */
  hasPreferences?: boolean;
  /** Preference checkbox label */
  preferenceLabel?: string;
  /** Preference help text */
  preferenceHelpText?: string;
  /** Preference key in config */
  preferenceKey?: string;
}

/** Full configuration for a provider tab */
interface ProviderTabConfig {
  /** Provider name (API key) */
  providerName: string;
  /** Authentication section config */
  auth: AuthSectionConfig;
  /** Model section config */
  model: ModelSectionConfig;
  /** Preferences section config */
  preferences?: PreferencesSectionConfig;
}

function ProviderTab({ provider, config }: { provider: ProviderResponse; config: ProviderTabConfig }) {
  const queryClient = useQueryClient();
  const config_data = provider.config as Record<string, unknown>;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['provider', config.providerName] });

  // Token state
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Extra auth fields (e.g., envVarName for OpenCode)
  const [extraFieldValue, setExtraFieldValue] = useState('');
  const hasExtraField = !!config.auth.extraFields;

  // Model state
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [modelMessage, setModelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Preferences state
  const [preferenceEnabled, setPreferenceEnabled] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const hasPreferences = config.preferences?.hasPreferences;

  // Initialize state from provider config
  useEffect(() => {
    if (hasPreferences) {
      const prefs = config_data.preferences as Record<string, unknown> | undefined;
      const prefKey = config.preferences?.preferenceKey || 'autoMemoryEnabled';
      setPreferenceEnabled(prefs?.[prefKey] !== false);
    }
  }, [provider, hasPreferences, config.preferences?.preferenceKey]);

  useEffect(() => {
    if (hasExtraField) {
      const envVarName = typeof config_data.envVarName === 'string' ? config_data.envVarName : '';
      setExtraFieldValue(envVarName);
    }
  }, [provider, hasExtraField]);

  // Token mutations
  const tokenMutation = useMutation({
    mutationFn: (tokenValue: string) => {
      if (hasExtraField && extraFieldValue) {
        return saveProviderToken(config.providerName, tokenValue, extraFieldValue);
      }
      return saveProviderToken(config.providerName, tokenValue);
    },
    onSuccess: (result) => {
      const typeLabel = result.tokenType === 'oauth' ? 'OAuth Token' : 'API Key';
      setTokenMessage({ type: 'success', text: `Saved! Token type: ${typeLabel}` });
      setToken('');
      setShowToken(false);
      invalidate();
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProviderToken(config.providerName),
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
    mutationFn: (modelValue: string) => saveProviderModel(config.providerName, modelValue),
    onSuccess: (result) => {
      setModelMessage({ type: 'success', text: `Saved! Model: ${result.model}` });
      invalidate();
    },
    onError: (err: Error) => {
      setModelMessage({ type: 'error', text: err.message });
    },
  });

  const modelDeleteMutation = useMutation({
    mutationFn: () => deleteProviderModel(config.providerName),
    onSuccess: () => {
      const msg = config.model.resetToDefault
        ? 'Model preference removed (using default)'
        : 'Model removed';
      setModelMessage({ type: 'success', text: msg });
      setModel('');
      setCustomModel('');
      invalidate();
    },
    onError: (err: Error) => {
      setModelMessage({ type: 'error', text: err.message });
    },
  });

  // Preferences mutation
  const preferencesMutation = useMutation({
    mutationFn: (prefs: Record<string, unknown>) => saveProviderPreferences(config.providerName, prefs),
    onSuccess: () => {
      invalidate();
    },
    onError: (err: Error, prefs: Record<string, unknown>) => {
      const prefKey = config.preferences?.preferenceKey || 'autoMemoryEnabled';
      setPreferenceEnabled(!(prefs[prefKey] as boolean));
      setPreferenceMessage({ type: 'error', text: err.message });
    },
  });

  const handleSaveToken = () => {
    setTokenMessage(null);
    tokenMutation.mutate(token);
  };

  const handleRemoveToken = () => {
    setTokenMessage(null);
    deleteMutation.mutate();
  };

  const handleSaveModel = () => {
    setModelMessage(null);
    const modelValue = config.model.hasCustomModel && model === 'custom' ? customModel.trim() : model;
    if (!modelValue) {
      setModelMessage({ type: 'error', text: 'Please select or enter a model' });
      return;
    }
    modelSaveMutation.mutate(modelValue);
  };

  const handleRemoveModel = () => {
    setModelMessage(null);
    modelDeleteMutation.mutate();
  };

  const modelKey = config.model.modelKey || 'model';
  const currentModel = config_data[modelKey] as string | undefined;
  const modelVariants = (config_data.modelVariants as string[] | undefined) ?? [];
  const formatLabel = config.model.formatLabel || formatVariantLabel;

  return (
    <div className="space-y-6">
      {/* Authentication Section */}
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
        {config.auth.helpText}

        {provider.is_configured ? (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <span className="text-sm text-gray-400">
              Token is stored securely.
              {hasExtraField && extraFieldValue && (
                <> Env var: <span className="font-mono text-gray-200">{extraFieldValue}</span></>
              )}
            </span>
            <button
              onClick={handleRemoveToken}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {deleteMutation.isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {hasExtraField && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Environment Variable Name</label>
                <input
                  type="text"
                  value={extraFieldValue}
                  onChange={e => setExtraFieldValue(e.target.value)}
                  placeholder="e.g., OPENAI_API_KEY"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500 font-mono"
                />
              </div>
            )}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder={config.auth.tokenPlaceholder}
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
                disabled={tokenMutation.isPending || !token.trim()}
                className="px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {tokenMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {tokenMessage && (
          <p className={`mt-3 text-sm ${tokenMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {tokenMessage.text}
          </p>
        )}
      </div>

      {/* Model Selection Section */}
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
          Choose which model to use for skill runs and Ralph iterations.
        </p>

        {currentModel ? (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <span className="text-sm text-gray-400">Current model: <span className="font-mono text-gray-200">{currentModel}</span></span>
            <button
              onClick={handleRemoveModel}
              disabled={modelDeleteMutation.isPending}
              className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {modelDeleteMutation.isPending ? 'Removing...' : (config.model.resetToDefault ? 'Reset to Default' : 'Remove')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {config.model.hasModelDropdown ? (
              <select
                value={model}
                onChange={e => { setModel(e.target.value); setModelMessage(null); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
              >
                <option value="">Select a model...</option>
                {modelVariants.map((v: string) => (
                  <option key={v} value={v}>{formatLabel(v)}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={model}
                onChange={e => { setModel(e.target.value); setModelMessage(null); }}
                placeholder="e.g., gpt-4o"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500 font-mono"
              />
            )}
            {config.model.hasCustomModel && model === 'custom' && (
              <input
                type="text"
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder={config.model.customModelPlaceholder}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500 font-mono"
              />
            )}
            <button
              onClick={handleSaveModel}
              disabled={modelSaveMutation.isPending || (!model || (config.model.hasCustomModel && model === 'custom' && !customModel.trim()))}
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

      {/* Preferences Section (optional) */}
      {hasPreferences && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <label className="block text-sm font-medium text-gray-300 mb-4">
            Preferences
          </label>
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={preferenceEnabled}
              onChange={e => {
                const next = e.target.checked;
                setPreferenceEnabled(next);
                setPreferenceMessage(null);
                const prefKey = config.preferences?.preferenceKey || 'autoMemoryEnabled';
                const prefs = { ...(config_data.preferences as Record<string, unknown> || {}), [prefKey]: next };
                preferencesMutation.mutate(prefs);
              }}
              className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-ralph-600 focus:ring-ralph-500 focus:ring-offset-gray-900 cursor-pointer"
            />
            <div>
              <span className="text-sm font-medium text-gray-300 group-hover:text-gray-100 transition-colors">
                {config.preferences?.preferenceLabel || 'Enable preference'}
              </span>
              <p className="text-xs text-gray-500 mt-0.5">
                {config.preferences?.preferenceHelpText || 'Preference description'}
              </p>
            </div>
          </label>
          {preferenceMessage && (
            <p className={`mt-2 text-sm ${preferenceMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {preferenceMessage.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const CLAUDE_CONFIG: ProviderTabConfig = {
  providerName: 'claude',
  auth: {
    tokenPlaceholder: 'sk-ant-oat01-... or sk-ant-api03-...',
    helpText: (
      <p className="text-xs text-gray-500 mb-4">
        Run <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">claude setup-token</code> locally to get an OAuth token, or use an API key from{' '}
        <span className="text-gray-400">console.anthropic.com</span>.
      </p>
    ),
  },
  model: {
    hasModelDropdown: true,
    hasCustomModel: true,
    resetToDefault: true,
    customModelPlaceholder: 'e.g., claude-sonnet-4-6',
    modelKey: 'claudeModel',
  },
  preferences: {
    hasPreferences: true,
    preferenceLabel: 'Enable auto memory',
    preferenceHelpText: 'When enabled, Claude will remember project patterns and learnings across sessions',
    preferenceKey: 'autoMemoryEnabled',
  },
};

const OPENCODE_CONFIG: ProviderTabConfig = {
  providerName: 'opencode',
  auth: {
    extraFields: true,
    helpText: (
      <p className="text-xs text-gray-500 mb-4">
        Enter the environment variable name and API key for your OpenCode-compatible provider.
      </p>
    ),
  },
  model: {
    hasCustomModel: false,
    customModelPlaceholder: 'e.g., gpt-4o',
  },
};

function CodexProviderTab({ provider }: { provider: ProviderResponse }) {
  const queryClient = useQueryClient();
  const config_data = provider.config as Record<string, unknown>;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['provider', 'codex'] });

  const currentTokenType = config_data.tokenType as string | undefined;

  // Auth state
  const [authMode, setAuthMode] = useState<'api-key' | 'chatgpt'>('chatgpt');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Model state
  const [model, setModel] = useState('');
  const [modelMessage, setModelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const currentModel = config_data.model as string | undefined;
  const modelVariants = (config_data.modelVariants as string[] | undefined) ?? [];

  const chatGptMutation = useMutation({
    mutationFn: () => saveCodexChatGptAuth(),
    onSuccess: () => {
      setTokenMessage({ type: 'success', text: 'ChatGPT auth activated via ~/.codex/auth.json' });
      invalidate();
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const apiKeyMutation = useMutation({
    mutationFn: (t: string) => saveProviderToken('codex', t),
    onSuccess: () => {
      setTokenMessage({ type: 'success', text: 'API key saved' });
      setToken('');
      setShowToken(false);
      invalidate();
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProviderToken('codex'),
    onSuccess: () => {
      setTokenMessage({ type: 'success', text: 'Auth removed' });
      invalidate();
    },
    onError: (err: Error) => {
      setTokenMessage({ type: 'error', text: err.message });
    },
  });

  const modelSaveMutation = useMutation({
    mutationFn: (m: string) => saveProviderModel('codex', m),
    onSuccess: (result) => {
      setModelMessage({ type: 'success', text: `Saved! Model: ${result.model}` });
      invalidate();
    },
    onError: (err: Error) => {
      setModelMessage({ type: 'error', text: err.message });
    },
  });

  const modelDeleteMutation = useMutation({
    mutationFn: () => deleteProviderModel('codex'),
    onSuccess: () => {
      setModelMessage({ type: 'success', text: 'Model preference removed (using default)' });
      setModel('');
      invalidate();
    },
    onError: (err: Error) => {
      setModelMessage({ type: 'error', text: err.message });
    },
  });

  return (
    <div className="space-y-6">
      {/* Authentication Section */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-300">Authentication</label>
          {provider.is_configured && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Configured
            </span>
          )}
        </div>

        {provider.is_configured ? (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <span className="text-sm text-gray-400">
              {currentTokenType === 'chatgpt'
                ? 'Using ChatGPT auth via ~/.codex/auth.json'
                : 'API key stored securely'}
            </span>
            <button
              onClick={() => { setTokenMessage(null); deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {deleteMutation.isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Auth mode toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setAuthMode('chatgpt'); setTokenMessage(null); }}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${authMode === 'chatgpt' ? 'border-ralph-500 bg-ralph-500/10 text-ralph-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}
              >
                ChatGPT
              </button>
              <button
                onClick={() => { setAuthMode('api-key'); setTokenMessage(null); }}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors ${authMode === 'api-key' ? 'border-ralph-500 bg-ralph-500/10 text-ralph-300' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}
              >
                API Key
              </button>
            </div>

            {authMode === 'chatgpt' ? (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Uses your existing ChatGPT session from <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">~/.codex/auth.json</code>. Run <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">codex</code> in a terminal first to authenticate.
                </p>
                <button
                  onClick={() => { setTokenMessage(null); chatGptMutation.mutate(); }}
                  disabled={chatGptMutation.isPending}
                  className="px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                >
                  {chatGptMutation.isPending ? 'Verifying...' : 'Use ChatGPT Auth'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Enter your OpenAI API key. It will be injected as both <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">CODEX_API_KEY</code> and <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">OPENAI_API_KEY</code>.
                </p>
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      placeholder="sk-..."
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
                    onClick={() => { setTokenMessage(null); apiKeyMutation.mutate(token); }}
                    disabled={apiKeyMutation.isPending || !token.trim()}
                    className="px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                  >
                    {apiKeyMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tokenMessage && (
          <p className={`mt-3 text-sm ${tokenMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {tokenMessage.text}
          </p>
        )}
      </div>

      {/* Model Selection Section */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <label className="block text-sm font-medium text-gray-300">Model Selection</label>
          {currentModel && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              {currentModel}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">Choose which model to use for skill runs and Ralph iterations.</p>

        {currentModel ? (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <span className="text-sm text-gray-400">Current model: <span className="font-mono text-gray-200">{currentModel}</span></span>
            <button
              onClick={() => { setModelMessage(null); modelDeleteMutation.mutate(); }}
              disabled={modelDeleteMutation.isPending}
              className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {modelDeleteMutation.isPending ? 'Removing...' : 'Reset to Default'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <select
              value={model}
              onChange={e => { setModel(e.target.value); setModelMessage(null); }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
            >
              <option value="">Select a model...</option>
              {modelVariants.map((v: string) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <button
              onClick={() => { setModelMessage(null); if (model) modelSaveMutation.mutate(model); }}
              disabled={modelSaveMutation.isPending || !model}
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
        <>
          {activeTab === 'claude' && <ProviderTab key="claude" provider={provider} config={CLAUDE_CONFIG} />}
          {activeTab === 'opencode' && <ProviderTab key="opencode" provider={provider} config={OPENCODE_CONFIG} />}
          {activeTab === 'codex' && <CodexProviderTab key="codex" provider={provider} />}
        </>
      ) : (
        <div className="text-sm text-red-400">Failed to load provider configuration.</div>
      )}
    </div>
  );
}
