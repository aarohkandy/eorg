import express from 'express';

const router = express.Router();

router.get('/', (_req, res) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;
