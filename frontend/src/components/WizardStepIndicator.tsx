interface Step {
  label: string;
  status: 'pending' | 'active' | 'complete';
}

interface WizardStepIndicatorProps {
  steps: Step[];
  activeStep: number;
  onStepClick: (index: number) => void;
}

export function WizardStepIndicator({ steps, activeStep, onStepClick }: WizardStepIndicatorProps) {
  const isEmpty = steps.length === 0;
  const clampedStep = isEmpty ? 0 : Math.min(activeStep, steps.length - 1);
  const activeLabel = steps[clampedStep]?.label ?? '';
  const showSeparator = activeLabel.length > 0;

  // Guard against empty steps array
  if (isEmpty) {
    return null;
  }

  return (
    <>
      {/* Mobile: prev/next nav with current step label */}
      <div className="md:hidden flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onStepClick(clampedStep - 1)}
          disabled={clampedStep === 0}
          className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          ‹ Prev
        </button>
        <span className="text-sm text-gray-300 text-center">
          <span className="font-medium text-ralph-300">Step {clampedStep + 1} of {steps.length}</span>
          {showSeparator && <><span className="text-gray-500"> — </span><span>{activeLabel}</span></>}
        </span>
        <button
          type="button"
          onClick={() => onStepClick(clampedStep + 1)}
          disabled={clampedStep === steps.length - 1}
          className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          Next ›
        </button>
      </div>

      {/* Desktop: full horizontal step indicator */}
      <div className="hidden md:flex items-center gap-1">
        {steps.map((step, i) => {
          const isActive = i === clampedStep;
          const isComplete = step.status === 'complete';

          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div className={`w-8 h-px mx-1 ${
                  isComplete || (i <= clampedStep) ? 'bg-ralph-500/50' : 'bg-gray-700'
                }`} />
              )}
              <button
                type="button"
                onClick={() => onStepClick(i)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-ralph-600/20 text-ralph-300'
                    : isComplete
                      ? 'bg-green-600/10 text-green-400 hover:bg-green-600/20'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-medium ${
                  isActive
                    ? 'bg-ralph-600 text-white'
                    : isComplete
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-400'
                }`}>
                  {isComplete ? '✓' : i + 1}
                </span>
                <span>{step.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
