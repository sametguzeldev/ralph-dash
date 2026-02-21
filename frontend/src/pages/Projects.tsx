import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getProjects, createProject, type ProjectSummary } from '../lib/api';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';

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
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteModal(true);
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
            onClick={handleDeleteClick}
            className="text-red-500 hover:text-red-400 transition-colors"
            title="Delete project"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {showDeleteModal && (
        <DeleteConfirmModal
          projectName={project.name}
          projectId={project.id}
          isRunning={project.running}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            setShowDeleteModal(false);
            queryClient.invalidateQueries({ queryKey: ['projects'] });
          }}
        />
      )}

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
