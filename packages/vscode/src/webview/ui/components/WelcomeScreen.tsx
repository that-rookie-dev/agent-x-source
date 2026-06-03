interface WelcomeScreenProps {
  onStartChat: (message: string) => void;
}

const QUICK_STARTS = [
  { label: 'Explain this codebase', prompt: 'Explain the structure of this codebase and its main components.' },
  { label: 'Find bugs', prompt: 'Review the current workspace for potential bugs or issues.' },
  { label: 'Write tests', prompt: 'Generate tests for the main source files in this project.' },
  { label: 'Refactor code', prompt: 'Suggest refactoring improvements for this codebase.' },
];

export function WelcomeScreen({ onStartChat }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-logo">
        <span className="codicon codicon-sparkle welcome-icon" />
      </div>
      <h1 className="welcome-title">Agent-X</h1>
      <p className="welcome-subtitle">AI-powered coding assistant</p>
      <div className="welcome-tips">
        <h3 className="welcome-tips-title">Quick Start</h3>
        <div className="welcome-tips-grid">
          {QUICK_STARTS.map((tip) => (
            <button key={tip.label} className="welcome-tip" onClick={() => onStartChat(tip.prompt)}>
              <span className="welcome-tip-label">{tip.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="welcome-hints">
        <p>Type a message below or use slash commands:</p>
        <div className="welcome-hint-list">
          <span className="welcome-hint"><code>/help</code> — Show help</span>
          <span className="welcome-hint"><code>/model</code> — Switch model</span>
          <span className="welcome-hint"><code>/plan</code> — Toggle plan mode</span>
        </div>
      </div>
    </div>
  );
}
