/**
 * Yasno API integration
 */

import type { YasnoResponse } from '../types';
import { YASNO_API, YASNO_API_HEADERS } from '../config/constants';
import { fetchProxies, selectRandomProxies } from './proxy';

/**
 * Browser-like user agents for rotation
 */
const USER_AGENTS = [
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
] as const;

/**
 * Get random user agent for request variety
 */
function getRandomUserAgent(): string {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch schedule data from Yasno API with a specific proxy
 * Uses browser-like headers to avoid WAF blocking
 *
 * NOTE: Cloudflare Workers have limited proxy support. We implement a basic approach
 * where the proxy is used by making the request through the proxy as an HTTP endpoint.
 * This may not work with all proxy providers. Future improvement: use a proxy service
 * that provides an HTTP API endpoint compatible with CF Workers.
 *
 * @param proxyUrl Optional proxy URL (http://user:pass@host:port)
 */
export async function fetchYasnoData(proxyUrl?: string): Promise<YasnoResponse | null> {
	try {
		const headers = {
			...YASNO_API_HEADERS,
			'User-Agent': getRandomUserAgent(),
		};

		// For now, proxies are noted but requests go direct
		// Cloudflare Workers' fetch API doesn't support standard HTTP proxy configuration
		// Alternative approaches to consider:
		// 1. Use a proxy service with an HTTP API endpoint
		// 2. Route through Cloudflare's egress IPs
		// 3. Use a custom proxy middleware service
		if (proxyUrl) {
			console.log(`Proxy provided but CF Workers has limited proxy support: ${proxyUrl.split('@')[1]}`);
		}

		const response = await fetch(YASNO_API, { headers });

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
 * Fetch Yasno data with proxy retry logic
 * Tries up to 3 times with different random proxies
 * @param webshareKey Webshare.io API key
 */
export async function fetchYasnoDataWithRetry(webshareKey: string): Promise<YasnoResponse | null> {
	// Fetch available proxies
	console.log('Fetching proxies from Webshare.io...');
	const proxies = await fetchProxies(webshareKey);

	if (proxies.length === 0) {
		console.error('No proxies available, falling back to direct request');
		return await fetchYasnoData();
	}

	console.log(`Fetched ${proxies.length} proxies from Webshare.io`);

	// Select 3 random different proxies for retry attempts
	const selectedProxies = selectRandomProxies(proxies, 3);

	// Try each proxy in sequence
	for (let i = 0; i < selectedProxies.length; i++) {
		const proxyUrl = selectedProxies[i];
		console.log(`Attempt ${i + 1}/3: Fetching via proxy ${proxyUrl.split('@')[1]}...`);

		const data = await fetchYasnoData(proxyUrl);

		if (data) {
			console.log(`Success on attempt ${i + 1}`);
			return data;
		}

		// Don't wait after the last attempt
		if (i < selectedProxies.length - 1) {
			const retryDelay = 1000 + Math.floor(Math.random() * 1000); // 1-2 seconds
			console.log(`Attempt ${i + 1} failed, retrying in ${retryDelay}ms...`);
			await new Promise(resolve => setTimeout(resolve, retryDelay));
		}
	}

	console.error('All proxy attempts failed');
	return null;
}
