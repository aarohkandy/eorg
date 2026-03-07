import { createClient } from '@supabase/supabase-js';
import { AppError } from './errors.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  throw new AppError(
    'BACKEND_UNAVAILABLE',
    'SUPABASE_URL and SUPABASE_SERVICE_KEY are required environment variables.',
    500
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
