import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../../theme';

const FAQ = [
  {
    q: 'What lives in Capabilities?',
    a: 'Prompt-recipe skills and generated tools created by Synthetic Intelligence. Packaged filesystem skills stay under Executable Skills. Crew tags are a third, separate layer.',
  },
  {
    q: 'Does this use external sandboxes?',
    a: 'No. Generated tools run in a local process sandbox (temp directory, timeout, no network).',
  },
  {
    q: 'Why is generation off by default?',
    a: 'syntheticIntelligence.enabled defaults to false. Turn it on in settings when you want observation. User-prompt create still works unless you disable that separately.',
  },
  {
    q: 'How do I approve a proposal?',
    a: 'Open Proposals, review source or the prompt recipe, run the sandbox for tools, then Approve. High-risk tools never auto-approve.',
  },
  {
    q: 'What does trial mean?',
    a: 'A generated tool can run for a limited window or use count with a [TRIAL - UNTRUSTED] prompt warning before full registration.',
  },
];

export function CapabilityHelp() {
  return (
    <Box aria-label="Capabilities help">
      <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.dim, mb: 1 }}>FAQ</Typography>
      {FAQ.map((item) => (
        <Box key={item.q} sx={{ mb: 1.25 }}>
          <Typography sx={{ fontSize: '0.75rem', fontFamily: MONO, color: colors.text.primary }}>{item.q}</Typography>
          <Typography sx={{ fontSize: '0.68rem', fontFamily: MONO, color: colors.text.secondary, mt: 0.35, lineHeight: 1.45 }}>
            {item.a}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
