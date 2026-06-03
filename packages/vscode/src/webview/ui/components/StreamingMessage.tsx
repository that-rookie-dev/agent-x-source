import { useMemo, useRef, useEffect, memo } from 'react';
import { renderMarkdown } from '../markdown';

interface StreamingMessageProps {
  content: string;
}

export const StreamingMessage = memo(function StreamingMessage({ content }: StreamingMessageProps) {
  const cursorRef = useRef<HTMLSpanElement>(null);

  const htmlContent = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (cursorRef.current) {
      cursorRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [content]);

  return (
    <div className="message-bubble message-assistant message-streaming">
      <div className="message-content markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      <span ref={cursorRef} className="streaming-cursor" />
    </div>
  );
});
