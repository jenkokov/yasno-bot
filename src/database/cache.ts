/**
 * Schedule cache and history database operations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { YasnoResponse } from '../types';

/**
 * Get cached schedule data from the database
 */
export async function getCachedData(supabase: SupabaseClient): Promise<YasnoResponse> {
	const { data: cacheRow } = await supabase
		.from('schedule_cache')
		.select('raw_data')
		.eq('id', 1)
		.single();

	return (cacheRow?.raw_data || {}) as YasnoResponse;
}

/**
 * Update cached schedule data in database
 */
export async function updateCache(supabase: SupabaseClient, freshData: YasnoResponse): Promise<void> {
	await supabase
		.from('schedule_cache')
		.update({ raw_data: freshData, updated_at: new Date() })
		.eq('id', 1);
}

/**
 * Save API response to history table for debugging
 */
export async function saveToHistory(
	supabase: SupabaseClient,
	freshData: YasnoResponse,
	changedZones: string[],
	notes?: string
): Promise<void> {
	try {
		await supabase.from('schedule_history').insert({
			raw_data: freshData,
			changed_zones: changedZones.length > 0 ? changedZones : null,
			notes: notes || null
		});
	} catch (error) {
		console.error('Error saving to history:', error);
	}
}
