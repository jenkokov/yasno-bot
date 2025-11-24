/**
 * Supabase client initialization
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types';

/**
 * Create a Supabase client instance
 */
export function createSupabaseClient(env: Env): SupabaseClient {
	if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
		console.error('Missing required environment variables: SUPABASE_URL or SUPABASE_KEY');
		throw new Error('Missing SUPABASE_URL or SUPABASE_KEY');
	}

	return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}
