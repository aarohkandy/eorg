import express from 'express';
import { supabase } from '../lib/supabase.js';
import { encrypt } from '../lib/crypto.js';
import { testConnection } from '../lib/imap.js';
import { AppError, buildConnectFailure, buildErrorResponse, pushTrace } from '../lib/errors.js';

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
  const trace = [];

  try {
    pushTrace(trace, 'API', 'info', 'auth_connect_received', 'Connect request received.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const appPassword = String(req.body?.appPassword || '').trim();

    if (!isValidEmail(email) || !appPassword) {
      pushTrace(trace, 'API', 'error', 'auth_input_invalid', 'Email and App Password are required.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'Valid email and App Password are required.', 400, { trace });
    }

    pushTrace(trace, 'API', 'success', 'auth_input_valid', 'Email and App Password look valid.');
    const test = await testConnection(email, appPassword, trace);
    if (!test.success) {
      pushTrace(trace, 'API', 'error', 'auth_connect_failed', 'Gmail rejected the connection attempt.', {
        code: test.code,
        details: test.error
      });
      throw buildConnectFailure(test.code, test.error, test.trace || trace);
    }

    pushTrace(trace, 'API', 'success', 'auth_verified', 'Gmail connection verified.');
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
      pushTrace(trace, 'API', 'error', 'auth_user_store_failed', 'Could not save the connected user.', {
        code: 'BACKEND_UNAVAILABLE',
        details: error.message
      });
      throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
    }

    console.log(`[Auth] User connected: ${maskEmail(email)} (userId: ${data.id})`);
    pushTrace(trace, 'API', 'success', 'auth_user_saved', 'Connected account saved successfully.');
    return res.status(200).json({
      success: true,
      userId: data.id,
      email: data.email,
      trace
    });
  } catch (error) {
    pushTrace(trace, 'API', 'error', 'auth_request_failed', 'Connect request failed.', {
      code: error?.code || 'BACKEND_UNAVAILABLE',
      details: error?.message || 'Unexpected backend error'
    });
    const payload = buildErrorResponse(error, trace);
    return res.status(payload.status).json(payload.body);
  }
});

router.delete('/disconnect', async (req, res) => {
  const trace = [];

  try {
    pushTrace(trace, 'API', 'info', 'auth_disconnect_received', 'Disconnect request received.');
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      pushTrace(trace, 'API', 'error', 'auth_disconnect_invalid', 'A connected user ID is required to disconnect.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'userId is required to disconnect.', 400, { trace });
    }

    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    if (lookupError) {
      pushTrace(trace, 'API', 'error', 'auth_disconnect_lookup_failed', 'Could not load the connected user.', {
        code: 'BACKEND_UNAVAILABLE',
        details: lookupError.message
      });
      throw new AppError('BACKEND_UNAVAILABLE', lookupError.message, 500, { trace });
    }

    if (!existing) {
      pushTrace(trace, 'API', 'error', 'auth_disconnect_missing_user', 'Connected user was not found.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'User not found for disconnect.', 404, { trace });
    }

    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) {
      pushTrace(trace, 'API', 'error', 'auth_disconnect_delete_failed', 'Could not disconnect the current user.', {
        code: 'BACKEND_UNAVAILABLE',
        details: error.message
      });
      throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
    }

    console.log(`[Auth] User disconnected: ${maskEmail(existing.email)}`);
    pushTrace(trace, 'API', 'success', 'auth_disconnected', 'Connected account removed successfully.');
    return res.status(200).json({ success: true, trace });
  } catch (error) {
    pushTrace(trace, 'API', 'error', 'auth_disconnect_failed', 'Disconnect request failed.', {
      code: error?.code || 'BACKEND_UNAVAILABLE',
      details: error?.message || 'Unexpected backend error'
    });
    const payload = buildErrorResponse(error, trace);
    return res.status(payload.status).json(payload.body);
  }
});

export default router;
