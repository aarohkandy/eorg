import express from 'express';
import { getBuildInfo } from '../lib/build-info.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const build = getBuildInfo();
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    ...build
  });
});

export default router;
