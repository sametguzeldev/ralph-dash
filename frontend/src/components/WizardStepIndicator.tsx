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
  const activeLabel = steps[activeStep]?.label ?? '';
  const showSeparator = activeLabel.length > 0;

  return (
    <>
      {/* Mobile: simplified "Step N of 4 — Label" */}
      <div className="md:hidden text-sm text-gray-300">
        <span className="font-medium text-ralph-300">Step {activeStep + 1} of {steps.length}</span>
        {showSeparator && <><span className="text-gray-500"> — </span><span>{activeLabel}</span></>}
      </div>

      {/* Desktop: full horizontal step indicator */}
      <div className="hidden md:flex items-center gap-1">
        {steps.map((step, i) => {
          const isActive = i === activeStep;
          const isComplete = step.status === 'complete';

          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div className={`w-8 h-px mx-1 ${
                  isComplete || (i <= activeStep) ? 'bg-ralph-500/50' : 'bg-gray-700'
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
