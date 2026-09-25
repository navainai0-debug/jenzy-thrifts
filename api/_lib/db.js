// Server-side Supabase client using the SERVICE ROLE key.
// This key is secret: it only lives in Vercel environment variables,
// never in the website files.
import { createClient } from '@supabase/supabase-js';
import { configError } from './http.js';

const DEFAULT_SUPABASE_URL = 'https://zurvhjraxenbnvmwdurz.supabase.co';

let client = null;

export function getDb() {
    if (globalThis.__JENZY_TEST_DB__) return globalThis.__JENZY_TEST_DB__;
    if (client) return client;

    const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
        throw configError(
            'Server not configured: add SUPABASE_SERVICE_ROLE_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.'
        );
    }
    client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return client;
}

export const BUCKET = 'product-images';
