/**
 * Scheduled task service - handles cron job logic
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { YasnoResponse } from '../types';
import { fetchYasnoDataWithRetry } from '../yasno/api';
import { detectChangedZones } from '../yasno/changes';
import { formatScheduleMessage } from '../yasno/formatter';
import { getCachedData, updateCache, saveToHistory } from '../database/cache';
import { getAllSubscribersGroupedByZone } from '../database/subscriptions';
import { sendBulkMessages } from '../telegram/api';

/**
 * Check for schedule updates and notify subscribers
 * This is the main cron job handler
 */
export async function checkScheduleUpdates(
	supabase: SupabaseClient,
	telegramToken: string,
	webshareKey: string
): Promise<void> {
	// Add random delay (0-15 seconds) to avoid predictable request patterns
	const randomDelay = Math.floor(Math.random() * 15000);
	console.log(`Initial random delay: ${randomDelay}ms to avoid predictable patterns`);
	await new Promise(resolve => setTimeout(resolve, randomDelay));

	try {
		// Fetch fresh data from Yasno API with retry logic
		const freshData = await fetchYasnoDataWithRetry(webshareKey);

		if (!freshData) {
			const timestamp = new Date().toISOString();
			console.log(`Failed to fetch data from Yasno API at ${timestamp}`);
			await saveToHistory(supabase, {}, [], `API fetch failed at ${timestamp} (after retry)`);
			return;
		}

		// Fetch cached data from database
		const cachedData = await getCachedData(supabase);

		// Detect which zones have changed
		const changedZones = detectChangedZones(freshData, cachedData);

		// Always save to history for debugging (even if no changes)
		await saveToHistory(
			supabase,
			freshData,
			changedZones,
			changedZones.length === 0 ? 'No changes detected' : `Changes in zones: ${changedZones.join(', ')}`
		);

		if (changedZones.length === 0) {
			console.log('No schedule changes detected');
			return;
		}

		console.log(`Schedule changes detected in zones: ${changedZones.join(', ')}`);

		// Notify subscribers of changed zones using bulk sending
		await notifySubscribersOfChanges(changedZones, freshData, supabase, telegramToken);

		// Update cache with fresh data
		await updateCache(supabase, freshData);
	} catch (error) {
		console.error('Error checking schedule updates:', error);
		// Try to save error details to history
		try {
			await saveToHistory(
				supabase,
				{},
				[],
				`Error in checkScheduleUpdates: ${error instanceof Error ? error.message : String(error)}`
			);
		} catch (historyError) {
			console.error('Failed to save error to history:', historyError);
		}
	}
}

/**
 * Notify all subscribers of changed zones using efficient bulk sending
 * Groups subscribers by zone and sends in batches
 */
async function notifySubscribersOfChanges(
	changedZones: string[],
	freshData: YasnoResponse,
	supabase: SupabaseClient,
	telegramToken: string
): Promise<void> {
	// Get all subscribers grouped by zone
	const subscribersByZone = await getAllSubscribersGroupedByZone(supabase);

	// Process each changed zone
	for (const zone of changedZones) {
		const chatIds = subscribersByZone[zone];

		if (!chatIds || chatIds.length === 0) {
			console.log(`No subscribers for zone ${zone}`);
			continue;
		}

		console.log(`Notifying ${chatIds.length} subscribers for zone ${zone}`);

		// Format the message once for all subscribers
		const message = formatScheduleMessage(zone, freshData[zone], true);

		// Send to all subscribers using bulk sending with rate limiting
		const { successful, failed } = await sendBulkMessages(chatIds, message, telegramToken);

		console.log(`Zone ${zone}: ${successful} sent, ${failed} failed out of ${chatIds.length} total`);
	}
}
