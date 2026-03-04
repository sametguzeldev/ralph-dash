import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, saveGitConfig, deleteGitConfig, getModels } from '../lib/api';

export function Settings() {
  const queryClient = useQueryClient();
  const [ralphPath, setRalphPath] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // Git config state
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [gitMessage, setGitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: getModels,
  });

  useEffect(() => {
    if (data?.ralphPath) setRalphPath(data.ralphPath);
    if (data?.selectedProviders) setSelectedProviders(data.selectedProviders);
    if (data?.selectedSkills) setSelectedSkills(data.selectedSkills);
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => updateSettings({ ralphPath, selectedProviders, selectedSkills }),
    onSuccess: () => {
      setMessage({ type: 'success', text: 'Settings saved successfully' });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message });
    },
  });

  const gitSaveMutation = useMutation({
    mutationFn: ({ name, email }: { name: string; email: string }) => saveGitConfig(name, email),
    onSuccess: (result) => {
      setGitMessage({ type: 'success', text: `Saved! Git identity: ${result.name} <${result.email}>` });
      setGitName('');
      setGitEmail('');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      setGitMessage({ type: 'error', text: err.message });
    },
  });

  const gitDeleteMutation = useMutation({
    mutationFn: () => deleteGitConfig(),
    onSuccess: () => {
      setGitMessage({ type: 'success', text: 'Git identity removed' });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => {
      setGitMessage({ type: 'error', text: err.message });
    },
  });

  const handleSaveGit = () => {
    setGitMessage(null);
    const trimmedName = gitName.trim();
    const trimmedEmail = gitEmail.trim();
    if (!trimmedName && !trimmedEmail) {
      setGitMessage({ type: 'error', text: 'Both name and email are required' });
      return;
    }
    if (!trimmedName) {
      setGitMessage({ type: 'error', text: 'Git User Name is required' });
      return;
    }
    if (!trimmedEmail) {
      setGitMessage({ type: 'error', text: 'Git User Email is required' });
      return;
    }
    if (!/^[^@]+@[^@]+$/.test(trimmedEmail)) {
      setGitMessage({ type: 'error', text: 'Email must contain @ with text on both sides' });
      return;
    }
    gitSaveMutation.mutate({ name: trimmedName, email: trimmedEmail });
  };

  const handleRemoveGit = () => {
    setGitMessage(null);
    gitDeleteMutation.mutate();
  };

  const handleProviderToggle = (providerName: string) => {
    setProviderError(null);
    setSelectedProviders(prev => {
      if (prev.includes(providerName)) {
        const next = prev.filter(p => p !== providerName);
        if (next.length === 0) {
          setProviderError('At least one provider must be selected');
          return prev;
        }
        return next;
      }
      return [...prev, providerName];
    });
  };

  const ALL_SKILLS = ['prd', 'prd-questions', 'ralph'] as const;
  const allSkillsSelected = ALL_SKILLS.every(s => selectedSkills.includes(s));

  const handleMasterSkillToggle = () => {
    if (allSkillsSelected) {
      setSelectedSkills([]);
    } else {
      setSelectedSkills([...ALL_SKILLS]);
    }
  };

  const handleSkillToggle = (skill: string) => {
    setSelectedSkills(prev =>
      prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
    );
  };

  const handleSave = () => {
    setMessage(null);
    if (selectedProviders.length === 0) {
      setMessage({ type: 'error', text: 'At least one provider must be selected' });
      return;
    }
    mutation.mutate();
  };

  const filePreview = useMemo(() => {
    const paths = new Set<string>();

    for (const provName of selectedProviders) {
      const skillsDir = provName === 'codex' ? '.agents/skills' : '.claude/skills';
      for (const skill of selectedSkills) {
        paths.add(`${skillsDir}/${skill}/SKILL.md`);
      }
    }

    if (selectedProviders.includes('claude')) {
      paths.add('scripts/ralph/CLAUDE.md');
    }

    for (const provName of selectedProviders) {
      const provider = models?.find(m => m.name === provName);
      if (provider?.runner_script) {
        paths.add(`scripts/ralph/${provider.runner_script}`);
      }
    }

    return [...paths].sort();
  }, [selectedProviders, selectedSkills, models]);

  return (
    <div className="md:max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Ralph Installation Path
        </label>
        <p className="text-xs text-gray-500 mb-3">
          Path to the Ralph repository (e.g., ~/PersonalProjects/ralph)
        </p>
        <input
          type="text"
          value={ralphPath}
          onChange={e => setRalphPath(e.target.value)}
          placeholder="~/PersonalProjects/ralph"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
        />

        <div className="mt-6 border-t border-gray-800 pt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Active Providers</h3>
          <p className="text-xs text-gray-500 mb-3">
            Select which providers are available for projects. At least one must be selected.
          </p>
          <div className="space-y-2">
            {models?.map(provider => (
              <label key={provider.name} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selectedProviders.includes(provider.name)}
                  onChange={() => handleProviderToggle(provider.name)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-ralph-600 focus:ring-ralph-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-sm text-gray-300 group-hover:text-gray-100 capitalize">
                  {provider.name}
                </span>
              </label>
            ))}
          </div>
          {providerError && (
            <p className="mt-2 text-sm text-red-400">{providerError}</p>
          )}
        </div>

        <div className="mt-6 border-t border-gray-800 pt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Skills</h3>
          <p className="text-xs text-gray-500 mb-3">
            Select which skills to include when syncing files to projects. Skills are optional.
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={allSkillsSelected}
                onChange={handleMasterSkillToggle}
                ref={el => {
                  if (el) el.indeterminate = selectedSkills.length > 0 && !allSkillsSelected;
                }}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-ralph-600 focus:ring-ralph-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-sm text-gray-300 group-hover:text-gray-100 font-medium">
                All Skills
              </span>
            </label>
            {ALL_SKILLS.map(skill => (
              <label key={skill} className="flex items-center gap-3 cursor-pointer group ml-6">
                <input
                  type="checkbox"
                  checked={selectedSkills.includes(skill)}
                  onChange={() => handleSkillToggle(skill)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-ralph-600 focus:ring-ralph-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-sm text-gray-300 group-hover:text-gray-100">
                  {skill}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-gray-800 pt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Files to Sync</h3>
          <p className="text-xs text-gray-500 mb-3">
            These files will be copied to each project when syncing.
          </p>
          {filePreview.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No files to sync with current selections.</p>
          ) : (
            <ul className="space-y-1">
              {filePreview.map(filePath => (
                <li key={filePath} className="text-xs text-gray-400 font-mono">
                  {filePath}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 border-t border-gray-800 pt-4">
          <button
            onClick={handleSave}
            disabled={mutation.isPending || selectedProviders.length === 0}
            className="w-full px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Saving...' : 'Save Settings'}
          </button>
          {message && (
            <p className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {message.text}
            </p>
          )}
        </div>
      </div>

      {/* Git Configuration — only shown for Docker users */}
      {data?.isDocker && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 mt-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-300">
              Git Configuration
            </label>
            {data.gitConfigured && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Configured as {data.gitUserName} &lt;{data.gitUserEmail}&gt;
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">
            In Docker, git does not have access to your host git identity. Set your name and email here so commits made by Ralph have the correct author.
          </p>

          {data.gitConfigured ? (
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <span className="text-sm text-gray-400">
                {data.gitUserName} &lt;{data.gitUserEmail}&gt;
              </span>
              <button
                onClick={handleRemoveGit}
                disabled={gitDeleteMutation.isPending}
                className="px-3 py-1.5 min-h-[44px] text-sm text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 rounded-lg transition-colors"
              >
                {gitDeleteMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={gitName}
                onChange={e => setGitName(e.target.value)}
                placeholder="Git User Name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
              />
              <input
                type="email"
                value={gitEmail}
                onChange={e => setGitEmail(e.target.value)}
                placeholder="Git User Email"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 min-h-[44px] text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-ralph-500 focus:ring-1 focus:ring-ralph-500"
              />
              <button
                onClick={handleSaveGit}
                disabled={gitSaveMutation.isPending}
                className="px-4 py-2 min-h-[44px] bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {gitSaveMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}

          {gitMessage && (
            <p className={`mt-3 text-sm ${gitMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {gitMessage.text}
            </p>
          )}
        </div>
      )}

    </div>
  );
}
