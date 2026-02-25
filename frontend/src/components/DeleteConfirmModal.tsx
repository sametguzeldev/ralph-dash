import { useState, useEffect } from 'react';
import { deleteProject } from '../lib/api';

interface DeleteConfirmModalProps {
  projectName: string;
  projectId: number;
  isRunning: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteConfirmModal({
  projectName,
  projectId,
  isRunning,
  onClose,
  onDeleted,
}: DeleteConfirmModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const isMatch = confirmText === projectName;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDelete = async () => {
    setError('');
    setIsDeleting(true);
    try {
      await deleteProject(projectId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deletion failed');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mx-4 w-full md:mx-auto md:max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Delete Project</h3>

        <p className="text-sm text-gray-300 mb-3 break-words">
          This will remove <span className="font-bold text-gray-100 break-all">{projectName}</span> from the dashboard. Files on disk will not be affected.
        </p>

        {isRunning && (
          <p className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-3">
            A run is currently active for this project. It will be stopped before deletion.
          </p>
        )}

        <label className="block text-sm text-gray-300 mb-1 break-words">
          Type <span className="font-mono font-bold text-gray-100 break-all">{projectName}</span> to confirm
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={`Type ${projectName} to confirm`}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 md:py-2 text-sm text-gray-100 mb-4 focus:outline-none focus:border-red-500 min-h-[44px]"
          autoFocus
        />

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={isDeleting} className="px-4 py-2 min-h-[44px] text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isMatch || isDeleting}
            className="px-4 py-2 min-h-[44px] bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
