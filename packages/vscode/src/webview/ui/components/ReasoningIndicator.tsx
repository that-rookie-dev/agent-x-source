interface ReasoningIndicatorProps {
  text: string;
}

export function ReasoningIndicator({ text }: ReasoningIndicatorProps) {
  return (
    <div className="reasoning-indicator">
      <div className="reasoning-header">
        <span className="codicon codicon-lightbulb reasoning-icon" />
        <span className="reasoning-label">Thinking</span>
        <span className="reasoning-dots">
          <span className="reasoning-dot" />
          <span className="reasoning-dot" />
          <span className="reasoning-dot" />
        </span>
      </div>
      {text && <div className="reasoning-text">{text}</div>}
    </div>
  );
}
