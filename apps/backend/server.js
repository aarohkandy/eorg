import 'dotenv/config';
import express from 'express';
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/messages.js';
import healthRoutes from './routes/health.js';
import { supabase } from './lib/supabase.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin.startsWith('chrome-extension://') || origin === '') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  return next();
});

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

app.use((err, _req, res, _next) => {
  console.error(`[Backend ERROR] ${err.message}`);
  return res.status(500).json({
    success: false,
    code: 'BACKEND_UNAVAILABLE',
    error: err.message || 'Unexpected backend error'
  });
});

function startKeepAliveTimers() {
  const selfUrl = process.env.SELF_URL;

  if (selfUrl) {
    setInterval(async () => {
      try {
        const response = await fetch(`${selfUrl}/health`);
        if (!response.ok) {
          throw new Error(`status=${response.status}`);
        }
        console.log(`[KeepAlive] Self-ping successful at ${new Date().toLocaleTimeString()}`);
      } catch (error) {
        console.error(`[KeepAlive] Self-ping failed: ${error.message}`);
      }
    }, 14 * 60 * 1000);
  }

  setInterval(async () => {
    try {
      await supabase.from('users').select('id').limit(1);
      console.log('[KeepAlive] Supabase ping successful');
    } catch (error) {
      console.error(`[KeepAlive] Supabase ping failed: ${error.message}`);
    }
  }, 5 * 24 * 60 * 60 * 1000);
}

app.listen(port, () => {
  console.log(`[Backend] Server listening on port ${port}`);
  startKeepAliveTimers();
});
