import { useState, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import SearchIcon from '@mui/icons-material/Search';
import { cortexApi, type CortexNode } from '../api';
import { categoryStyle } from '../palette';
import { glassPanel, MONO } from './hudStyles';

export interface SearchBoxProps {
  onPick: (node: CortexNode) => void;
}

export function SearchBox({ onPick }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CortexNode[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      cortexApi.search(query.trim())
        .then((r) => { setResults(r.results); setOpen(true); })
        .catch(() => {});
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <Box sx={{ position: 'absolute', top: 16, right: 16, width: 320, pointerEvents: 'auto' }}>
      <Box sx={{ ...glassPanel, display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, gap: 1 }}>
        <SearchIcon sx={{ fontSize: 16, color: 'rgba(148,163,216,0.7)' }} />
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search memories…"
          sx={{ flex: 1, fontFamily: MONO, fontSize: '0.72rem', color: '#e6ecff', '& input::placeholder': { color: 'rgba(148,163,216,0.55)', opacity: 1 } }}
        />
      </Box>
      {open && results.length > 0 && (
        <Box sx={{ ...glassPanel, mt: 0.75, maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
          {results.map((node) => {
            const style = categoryStyle(node.category);
            return (
              <Box
                key={node.id}
                onClick={() => { onPick(node); setOpen(false); setQuery(''); }}
                sx={{
                  px: 1.5, py: 0.75, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 0.25,
                  '&:hover': { bgcolor: 'rgba(125,145,255,0.09)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: style.css, boxShadow: `0 0 6px ${style.css}`, flexShrink: 0 }} />
                  <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.68rem', color: '#e6ecff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {node.label}
                  </Box>
                </Box>
                <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.58rem', color: 'rgba(148,163,216,0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pl: 1.75 }}>
                  {node.contentPreview}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
