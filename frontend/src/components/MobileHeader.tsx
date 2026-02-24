interface MobileHeaderProps {
  onToggle: () => void;
}

export function MobileHeader({ onToggle }: MobileHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex items-center h-14 bg-gray-900 border-b border-gray-800 px-3 md:hidden">
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-11 h-11 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        aria-label="Toggle navigation"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span className="ml-2 text-lg font-bold text-ralph-400">RalphDash</span>
    </header>
  );
}
