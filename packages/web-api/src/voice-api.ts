import { Router } from 'express';
import { createVoiceRoutesRouter } from './voice/routes.js';

export { getVoiceSidecarManager, voiceDataDir } from './voice/shared.js';

const router: import('express').Router = Router();
router.use(createVoiceRoutesRouter());

export default router;
