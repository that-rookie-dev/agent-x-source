import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Chip from '@mui/material/Chip';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { scheduler, type SchedulerJob } from '../api';
import { colors } from '../theme';

export function SchedulerPanel() {
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const [instruction, setInstruction] = useState('');
  const [naturalCron, setNaturalCron] = useState('');

  const load = () => { scheduler.jobs().then(setJobs).catch(() => {}); };
  useEffect(load, []);

  const handleAdd = async () => {
    if (!name || !cron || !instruction) return;
    try {
      await scheduler.create(name, cron, instruction);
      setDialogOpen(false);
      setName(''); setCron(''); setInstruction(''); setNaturalCron('');
      load();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try { await scheduler.delete(id); load(); } catch { /* ignore */ }
  };

  const handleParseCron = async () => {
    if (!naturalCron) return;
    try {
      const result = await scheduler.parseCron(naturalCron);
      setCron(result.cron);
    } catch { /* ignore */ }
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">Scheduler</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)} sx={{ color: colors.accent.blue }}>
          New Job
        </Button>
      </Box>

      {jobs.map((job) => (
        <Box key={job.id} sx={{ p: 2, mb: 1.5, border: `1px solid ${colors.border.default}`, borderRadius: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="body1" sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{job.name}</Typography>
              <Typography variant="caption" sx={{ color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>{job.cron}</Typography>
            </Box>
            <IconButton size="small" onClick={() => handleDelete(job.id)} sx={{ color: colors.accent.red }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: colors.text.tertiary }}>{job.instruction}</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            {job.lastRun && <Chip size="small" label={`Last: ${new Date(job.lastRun).toLocaleString()}`} sx={{ fontSize: '0.55rem', height: 18 }} />}
            {job.nextRun && <Chip size="small" label={`Next: ${new Date(job.nextRun).toLocaleString()}`} sx={{ fontSize: '0.55rem', height: 18 }} />}
          </Box>
        </Box>
      ))}

      {jobs.length === 0 && (
        <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 4 }}>No scheduled jobs</Typography>
      )}

      {/* Add Job Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}` } }}>
        <DialogTitle>New Scheduled Job</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important', minWidth: 400 }}>
          <TextField label="Job Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField label="Natural language schedule" value={naturalCron} onChange={(e) => setNaturalCron(e.target.value)} sx={{ flex: 1 }} placeholder="e.g. every day at 9am" />
            <Button onClick={handleParseCron} size="small" sx={{ color: colors.accent.blue }}>Parse</Button>
          </Box>
          <TextField label="Cron Expression" value={cron} onChange={(e) => setCron(e.target.value)} fullWidth placeholder="*/5 * * * *" InputProps={{ sx: { fontFamily: "'JetBrains Mono', monospace" } }} />
          <TextField label="Instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} fullWidth multiline rows={3} placeholder="What should the agent do?" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>Create</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
