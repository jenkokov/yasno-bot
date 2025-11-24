/**
 * Yasno API integration
 */

import type { YasnoResponse } from '../types';
import { YASNO_API, YASNO_API_HEADERS } from '../config/constants';

/**
 * Fetch schedule data from Yasno API
 * Uses browser-like headers to avoid WAF blocking
 */
export async function fetchYasnoData(): Promise<YasnoResponse | null> {
	try {
		const response = await fetch(YASNO_API, {
			headers: YASNO_API_HEADERS
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`Yasno API returned status ${response.status}: ${errorText.substring(0, 500)}`);
			return null;
		}

		return await response.json() as YasnoResponse;
	} catch (error) {
		console.error('Failed to fetch Yasno data:', error);
		return null;
	}
}

/**
 * Fetch Yasno data with retry logic
 * Retries once after a random delay if first attempt fails
 */
export async function fetchYasnoDataWithRetry(): Promise<YasnoResponse | null> {
	let data = await fetchYasnoData();

	// Retry once after 3-5 seconds if first attempt failed
	if (!data) {
		const retryDelay = 3000 + Math.floor(Math.random() * 2000); // 3-5 seconds
		console.log(`First fetch attempt failed, retrying in ${retryDelay}ms...`);
		await new Promise(resolve => setTimeout(resolve, retryDelay));
		data = await fetchYasnoData();
	}

	return data;
}
