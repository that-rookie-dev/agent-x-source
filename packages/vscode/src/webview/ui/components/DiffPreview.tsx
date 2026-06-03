import { useState, useMemo } from 'react';
import type { DiffState } from '../App';

interface DiffPreviewProps {
  diff: DiffState;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export function DiffPreview({ diff }: DiffPreviewProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  const diffLines = useMemo(() => {
    const lines: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    for (const raw of diff.diff.split('\n')) {
      if (raw.startsWith('@@')) {
        lines.push({ type: 'header', content: raw });
        const m1 = raw.match(/-(\d+)/);
        const m2 = raw.match(/\+(\d+)/);
        oldLine = m1?.[1] ? parseInt(m1[1], 10) : 0;
        newLine = m2?.[1] ? parseInt(m2[1], 10) : 0;
      } else if (raw.startsWith('+')) {
        lines.push({ type: 'add', content: raw.slice(1), newLineNum: newLine++ });
      } else if (raw.startsWith('-')) {
        lines.push({ type: 'remove', content: raw.slice(1), oldLineNum: oldLine++ });
      } else {
        const text = raw.startsWith(' ') ? raw.slice(1) : raw;
        lines.push({ type: 'context', content: text, oldLineNum: oldLine++, newLineNum: newLine++ });
      }
    }
    return lines;
  }, [diff.diff]);

  const fileName = diff.filePath.split('/').pop() || diff.filePath;

  return (
    <div className="diff-preview">
      <div className="diff-header">
        <span className="codicon codicon-file" />
        <span className="diff-filename">{fileName}</span>
        <span className="diff-path">{diff.filePath}</span>
        <div className="diff-view-toggle">
          <button className={`diff-view-btn ${viewMode === 'unified' ? 'active' : ''}`} onClick={() => setViewMode('unified')}>Unified</button>
          <button className={`diff-view-btn ${viewMode === 'split' ? 'active' : ''}`} onClick={() => setViewMode('split')}>Split</button>
        </div>
      </div>
      <div className={`diff-content diff-${viewMode}`}>
        {viewMode === 'unified' ? (
          <table className="diff-table">
            <tbody>
              {diffLines.map((line, i) => (
                <tr key={i} className={`diff-line diff-line-${line.type}`}>
                  <td className="diff-line-num">{line.oldLineNum || ''}</td>
                  <td className="diff-line-num">{line.newLineNum || ''}</td>
                  <td className="diff-line-prefix">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</td>
                  <td className="diff-line-content">{line.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="diff-split">
            <div className="diff-split-old">
              <table className="diff-table">
                <tbody>
                  {diffLines.filter((l) => l.type !== 'add').map((line, i) => (
                    <tr key={i} className={`diff-line diff-line-${line.type}`}>
                      <td className="diff-line-num">{line.oldLineNum || ''}</td>
                      <td className="diff-line-content">{line.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="diff-split-new">
              <table className="diff-table">
                <tbody>
                  {diffLines.filter((l) => l.type !== 'remove').map((line, i) => (
                    <tr key={i} className={`diff-line diff-line-${line.type}`}>
                      <td className="diff-line-num">{line.newLineNum || ''}</td>
                      <td className="diff-line-content">{line.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
