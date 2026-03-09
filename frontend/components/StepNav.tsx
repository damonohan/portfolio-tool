"use client";

const STEPS = [
  "Upload",
  "Classify Notes",
  "Portfolio Builder",
  "Analysis",
  "Improvements",
];

export default function StepNav({
  current,
  maxStep,
  onStepClick,
  onReset,
}: {
  current: number;
  maxStep: number;
  onStepClick: (step: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-8 bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-4">
      <div className="flex items-center gap-1">
        {STEPS.map((label, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === current;
          const isDone = stepNum < current;
          const isReachable = stepNum !== current && stepNum <= maxStep;

          return (
            <div key={i} className="flex items-center">
              <button
                onClick={() => isReachable && onStepClick(stepNum)}
                disabled={!isReachable && !isActive}
                title={isReachable ? `Go to ${label}` : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors ${
                  isReachable ? "cursor-pointer hover:bg-slate-100" : "cursor-default"
                }`}
              >
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold flex-shrink-0 ${
                    isActive
                      ? "bg-blue-700 text-white"
                      : isDone
                      ? "bg-green-600 text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {isDone ? "✓" : stepNum}
                </div>
                <span
                  className={`text-sm font-medium ${
                    isActive
                      ? "text-blue-700"
                      : isDone
                      ? "text-green-700"
                      : isReachable
                      ? "text-slate-600"
                      : "text-slate-400"
                  }`}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div className="w-5 h-px bg-slate-300 mx-1 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={onReset}
        className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors ml-4 flex-shrink-0"
      >
        Reset Session
      </button>
    </div>
  );
}
