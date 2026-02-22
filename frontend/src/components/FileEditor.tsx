import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getWorkflowFile, saveWorkflowFile, validatePrdJson, type PrdJsonValidation } from '../lib/api';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

interface FileEditorProps {
  projectId: number;
  filePath: string;
  fileType: 'markdown' | 'json';
  onClose: () => void;
  onSaved?: () => void;
}

export function FileEditor({ projectId, filePath, fileType, onClose, onSaved }: FileEditorProps) {
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const savedContentRef = useRef('');
  const [validation, setValidation] = useState<PrdJsonValidation | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-file', projectId, filePath],
    queryFn: () => getWorkflowFile(projectId, filePath),
  });

  const saveMutation = useMutation({
    mutationFn: (content: string) => saveWorkflowFile(projectId, filePath, content),
    onSuccess: () => {
      const content = viewRef.current?.state.doc.toString() || '';
      savedContentRef.current = content;
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['workflow-status', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-status', projectId] });
      onSaved?.();
    },
    onError: (err: Error) => setError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: (content: string) => validatePrdJson(projectId, content),
    onSuccess: (data) => setValidation(data),
    onError: (err: Error) => setError(err.message),
  });

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current || !data) return;

    const extensions = [
      basicSetup,
      oneDark,
      fileType === 'json' ? json() : markdown(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          setHasChanges(update.state.doc.toString() !== savedContentRef.current);
        }
      }),
    ];

    const state = EditorState.create({
      doc: data.content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    savedContentRef.current = data.content;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(() => {
    const content = viewRef.current?.state.doc.toString();
    if (content !== undefined) {
      setError('');
      saveMutation.mutate(content);
    }
  }, [saveMutation]);

  const handleValidate = useCallback(() => {
    const content = viewRef.current?.state.doc.toString();
    if (content !== undefined) {
      setError('');
      setValidation(null);
      validateMutation.mutate(content);
    }
  }, [validateMutation]);

  const handleClose = useCallback(() => {
    if (!hasChanges || window.confirm('You have unsaved changes. Close anyway?')) {
      onClose();
    }
  }, [hasChanges, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, handleSave]);

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <div className="fixed inset-0 bg-black/80 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-gray-200">{fileName}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            fileType === 'json' ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'
          }`}>
            {fileType === 'json' ? 'JSON' : 'Markdown'}
          </span>
          {hasChanges && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
        </div>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-200 text-xl leading-none"
        >
          &times;
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading file...
          </div>
        ) : (
          <div ref={editorRef} className="h-full overflow-auto [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto" />
        )}
      </div>

      {/* Validation results */}
      {validation && (
        <div className={`px-4 py-2 text-sm border-t ${
          validation.valid
            ? 'bg-green-500/10 border-green-500/30 text-green-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {validation.valid ? (
            <span>Valid prd.json — {validation.storyCount} stories</span>
          ) : (
            <div>
              <span className="font-medium">Validation errors:</span>
              <ul className="mt-1 ml-4 list-disc">
                {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-sm bg-red-500/10 border-t border-red-500/30 text-red-400">
          {error}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-t border-gray-700">
        <span className="text-xs text-gray-500 font-mono">{filePath}</span>
        <div className="flex items-center gap-2">
          {fileType === 'json' && (
            <button
              onClick={handleValidate}
              disabled={validateMutation.isPending}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors"
            >
              {validateMutation.isPending ? 'Validating...' : 'Validate'}
            </button>
          )}
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !hasChanges}
            className="px-4 py-1.5 text-sm bg-ralph-600 hover:bg-ralph-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
