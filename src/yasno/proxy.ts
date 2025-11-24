/**
 * Webshare.io proxy management
 */

interface WebshareProxy {
	proxy_address: string;
	port: number;
	username: string;
	password: string;
}

interface WebshareResponse {
	results: WebshareProxy[];
}

/**
 * Fetch available proxies from Webshare.io
 * @param apiKey Webshare API key
 * @returns Array of proxy URLs in format: http://username:password@host:port
 */
export async function fetchProxies(apiKey: string): Promise<string[]> {
	try {
		const response = await fetch('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100', {
			headers: {
				'Authorization': `Token ${apiKey}`,
			},
		});

		if (!response.ok) {
			console.error(`Webshare API returned status ${response.status}`);
			return [];
		}

		const data = await response.json() as WebshareResponse;

		// Convert to proxy URLs
		return data.results.map(proxy =>
			`http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`
		);
	} catch (error) {
		console.error('Failed to fetch proxies from Webshare:', error);
		return [];
	}
}

/**
 * Select a random proxy from the list
 * @param proxies Array of proxy URLs
 * @returns Random proxy URL or null if list is empty
 */
export function selectRandomProxy(proxies: string[]): string | null {
	if (proxies.length === 0) {
		return null;
	}
	return proxies[Math.floor(Math.random() * proxies.length)];
}

/**
 * Select N different random proxies from the list
 * @param proxies Array of proxy URLs
 * @param count Number of proxies to select
 * @returns Array of unique random proxy URLs
 */
export function selectRandomProxies(proxies: string[], count: number): string[] {
	if (proxies.length === 0) {
		return [];
	}

	// If requesting more proxies than available, return all
	if (count >= proxies.length) {
		return [...proxies];
	}

	// Fisher-Yates shuffle to get random unique proxies
	const shuffled = [...proxies];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}

	return shuffled.slice(0, count);
}
