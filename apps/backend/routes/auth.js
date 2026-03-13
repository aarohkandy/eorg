import express from 'express';
import { supabase } from '../lib/supabase.js';
import { encrypt } from '../lib/crypto.js';
import { testConnection } from '../lib/imap.js';
import { AppError, buildConnectFailure, buildErrorResponse } from '../lib/errors.js';

const router = express.Router();

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return '***';
  return `${value.slice(0, 1)}***${value.slice(at - 1)}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

router.post('/connect', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const appPassword = String(req.body?.appPassword || '').trim();

    if (!isValidEmail(email) || !appPassword) {
      throw new AppError('NOT_CONNECTED', 'Valid email and App Password are required.', 400);
    }

    const test = await testConnection(email, appPassword);
    if (!test.success) {
      throw buildConnectFailure(test.code, test.error);
    }

    const encryptedPassword = encrypt(appPassword);

    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          email,
          encrypted_password: encryptedPassword,
          last_sync: null
        },
        { onConflict: 'email' }
      )
      .select('id, email')
      .single();

    if (error) {
      throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
    }

    console.log(`[Auth] User connected: ${maskEmail(email)} (userId: ${data.id})`);
    return res.status(200).json({
      success: true,
      userId: data.id,
      email: data.email
    });
  } catch (error) {
    const payload = buildErrorResponse(error);
    return res.status(payload.status).json(payload.body);
  }
});

router.delete('/disconnect', async (req, res) => {
  try {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      throw new AppError('NOT_CONNECTED', 'userId is required to disconnect.', 400);
    }

    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    if (lookupError) {
      throw new AppError('BACKEND_UNAVAILABLE', lookupError.message, 500);
    }

    if (!existing) {
      throw new AppError('NOT_CONNECTED', 'User not found for disconnect.', 404);
    }

    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) {
      throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
    }

    console.log(`[Auth] User disconnected: ${maskEmail(existing.email)}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    const payload = buildErrorResponse(error);
    return res.status(payload.status).json(payload.body);
  }
});

export default router;
