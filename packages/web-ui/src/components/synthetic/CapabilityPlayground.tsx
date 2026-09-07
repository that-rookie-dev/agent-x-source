import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { capabilities, type CapabilityRecord, type CapabilityTestCaseRecord } from '../../api';
import { colors, MONO } from '../../theme';

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text || '{}');
    return true;
  } catch {
    return false;
  }
}

export function CapabilityPlayground({
  item,
  testCases,
  onSaved,
}: {
  item: CapabilityRecord;
  testCases: CapabilityTestCaseRecord[];
  onSaved: () => void;
}) {
  const [testArgs, setTestArgs] = useState('{}');
  const [testOut, setTestOut] = useState<string | null>(null);
  const [result, setResult] = useState<import('@agentx/shared').CapabilitySandboxResult | null>(null);
  const [caseName, setCaseName] = useState('case');
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  if (item.kind !== 'tool') {
    return <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, fontFamily: MONO }}>Skills are prompt recipes and do not run in the sandbox.</Typography>;
  }

  const valid = isValidJson(testArgs);

  const run = async (args: Record<string, unknown>) => {
    setRunning(true);
    try {
      const { result } = await capabilities.test(item.id, args);
      setResult(result);
      const text = JSON.stringify(result, null, 2);
      setTestOut(text);
    } catch (err) {
      setTestOut(err instanceof Error ? err.message : 'test failed');
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    const input = JSON.parse(testArgs || '{}') as Record<string, unknown>;
    if (editing) {
      await capabilities.renameTestCase(item.id, editing, editName || 'case', input);
      setEditing(null);
    } else {
      await capabilities.saveTestCase(item.id, caseName, input);
    }
    onSaved();
  };

  const remove = async (caseId: string) => {
    await capabilities.deleteTestCase(item.id, caseId);
    onSaved();
  };

  return (
    <Box>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, fontFamily: MONO, mb: 0.5 }}>INPUT JSON</Typography>
      <TextField
        size="small"
        fullWidth
        value={testArgs}
        onChange={(e) => setTestArgs(e.target.value)}
        inputProps={{ 'aria-label': 'Sandbox input JSON' }}
        sx={{ mb: 1, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.72rem' } }}
        error={!valid}
        helperText={valid ? '' : 'Invalid JSON'}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Button
          size="small"
          disabled={running || !valid}
          onClick={async () => {
            try {
              await run(JSON.parse(testArgs || '{}') as Record<string, unknown>);
            } catch (err) {
              setTestOut(err instanceof Error ? err.message : 'invalid json');
            }
          }}
          sx={{ fontFamily: MONO, textTransform: 'none' }}
        >
          {running ? 'Running…' : 'Run'}
        </Button>
        {editing ? (
          <TextField
            size="small"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            sx={{ width: 140, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }}
          />
        ) : (
          <TextField size="small" value={caseName} onChange={(e) => setCaseName(e.target.value)} sx={{ width: 140, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }} />
        )}
        <Button
          size="small"
          disabled={!valid}
          onClick={save}
          sx={{ fontFamily: MONO, textTransform: 'none' }}
        >
          {editing ? 'Update' : 'Save as test case'}
        </Button>
        {editing && (
          <Button size="small" onClick={() => setEditing(null)} sx={{ fontFamily: MONO, textTransform: 'none' }}>Cancel</Button>
        )}
        <Button
          size="small"
          onClick={async () => {
            const { results } = await capabilities.runAllTests(item.id);
            setTestOut(JSON.stringify(results, null, 2));
            setResult(null);
          }}
          sx={{ fontFamily: MONO, textTransform: 'none' }}
        >
          Run all
        </Button>
      </Box>
      {testCases.length > 0 && (
        <Box sx={{ mb: 1 }}>
          {testCases.map((tc) => (
            <Button
              key={tc.id}
              size="small"
              onClick={() => {
                setTestArgs(JSON.stringify(tc.input, null, 2));
                void capabilities.runTestCase(item.id, tc.id).then(({ result }) => {
                  setResult(result);
                  setTestOut(JSON.stringify(result, null, 2));
                });
              }}
              sx={{ fontFamily: MONO, textTransform: 'none', mr: 0.5, mb: 0.5, fontSize: '0.62rem' }}
            >
              {tc.name}
            </Button>
          ))}
          {testCases.map((tc) => (
            <Box key={`edit-${tc.id}`} component="span" sx={{ display: 'inline-flex', gap: 0.5, ml: 0.5 }}>
              <Button size="small" onClick={() => { setEditing(tc.id); setEditName(tc.name); setTestArgs(JSON.stringify(tc.input, null, 2)); }} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.55rem' }}>Edit</Button>
              <Button size="small" color="error" onClick={() => void remove(tc.id)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.55rem' }}>Delete</Button>
            </Box>
          ))}
        </Box>
      )}
      {result && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
          <Chip size="small" label={result.passed ? 'PASS' : 'FAIL'} color={result.passed ? 'success' : 'error'} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
          <Chip size="small" label={`${result.executionTimeMs}ms`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
          <Chip size="small" label={`exit ${result.exitCode}`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
          {result.detectedSideEffects.length > 0 && (
            <Chip size="small" label={`effects: ${result.detectedSideEffects.join(',')}`} sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
          )}
          {!result.passed && result.stderr?.toLowerCase().includes('timeout') && (
            <Chip size="small" label="Sandbox timed out" color="warning" sx={{ fontFamily: MONO, fontSize: '0.58rem' }} />
          )}
        </Box>
      )}
      {result?.stderr && (
        <Alert severity="error" sx={{ mb: 1, fontFamily: MONO, fontSize: '0.62rem' }}>
          <Typography component="pre" sx={{ fontFamily: MONO, fontSize: '0.62rem', whiteSpace: 'pre-wrap', m: 0 }}>{result.stderr}</Typography>
        </Alert>
      )}
      {testOut && (
        <Box sx={{ mt: 1, p: 1, border: `1px solid ${colors.border.subtle}`, borderRadius: 0.5 }} aria-label="Sandbox result">
          <Typography component="pre" sx={{ fontSize: '0.68rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap', m: 0 }}>
            {testOut}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
