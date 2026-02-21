import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getProjects, createProject, deleteProject, type ProjectSummary } from '../lib/api';

function AddProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => createProject(name, path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Add Project</h3>

        <label className="block text-sm text-gray-300 mb-1">Project Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="My Project"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 mb-4 focus:outline-none focus:border-ralph-500"
        />

        <label className="block text-sm text-gray-300 mb-1">Project Path</label>
        <input
          type="text"
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="~/Projects/my-project"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 mb-4 focus:outline-none focus:border-ralph-500"
        />

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || !path || mutation.isPending}
            className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            {mutation.isPending ? 'Adding...' : 'Add Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Remove "${project.name}" from dashboard?`)) {
      deleteMutation.mutate();
    }
  };

  return (
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      className="bg-gray-900 border border-gray-800 rounded-xl p-5 cursor-pointer hover:border-ralph-600/50 transition-colors group"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-gray-100 group-hover:text-ralph-300 transition-colors">
          {project.name}
        </h3>
        <div className="flex items-center gap-2">
          {project.running && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Running" />
          )}
          <button
            onClick={handleDelete}
            className="text-gray-600 hover:text-red-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove"
          >
            ×
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 font-mono truncate mb-3" title={project.path}>
        {project.path}
      </p>

      <div className="flex items-center justify-between">
        {project.branch && (
          <span className="text-xs bg-ralph-600/20 text-ralph-300 px-2 py-0.5 rounded font-mono">
            {project.branch}
          </span>
        )}
        {project.totalStories > 0 && (
          <span className="text-xs text-gray-500">
            {project.doneStories}/{project.totalStories} done
          </span>
        )}
      </div>

      {project.totalStories > 0 && (
        <div className="mt-3 w-full bg-gray-800 rounded-full h-1.5">
          <div
            className="bg-ralph-500 h-1.5 rounded-full transition-all"
            style={{ width: `${(project.doneStories / project.totalStories) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function Projects() {
  const [showModal, setShowModal] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    refetchInterval: 5000,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Projects</h2>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-ralph-600 hover:bg-ralph-700 rounded-lg text-sm font-medium transition-colors"
        >
          + Add Project
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse h-36" />
          ))}
        </div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No projects yet</p>
          <p className="text-sm">Add a project to start monitoring Ralph runs</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects?.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}

      {showModal && <AddProjectModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
