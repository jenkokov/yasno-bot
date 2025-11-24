/**
 * Configuration constants for the Yasno Bot
 */

export const YASNO_API = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages';

export const SCHEDULE_STATUS = {
	APPLIES: 'ScheduleApplies',
	WAITING: 'WaitingForSchedule',
} as const;

export const SLOT_TYPE = {
	OUTAGE: 'Definite',
	POWER: 'NotPlanned',
} as const;

export const ZONES = ['1', '2', '3', '4', '5', '6'] as const;

export const ADMIN_CHAT_ID = 67306153;

export const MESSAGES = {
	UNSUBSCRIBED: 'Ви відписалися від оновлень.',
	NOT_SUBSCRIBED: 'Ви не підписані на жодну групу. Використайте /start або /subscribe для підписки.',
	ERROR_FETCHING: 'Не вдалося завантажити дані розкладу. Спробуйте пізніше.',
	ERROR_SUBSCRIPTION: 'Помилка збереження підписки. Спробуйте ще раз.',
	SELECT_ZONE: 'Будь ласка, оберіть вашу групу Yasно:',
} as const;

/**
 * Telegram API rate limits
 * See: https://core.telegram.org/bots/faq#broadcasting-to-users
 */
export const TELEGRAM_RATE_LIMITS = {
	MESSAGES_PER_SECOND: 30,
	CHUNK_SIZE: 30,
	CHUNK_DELAY_MS: 1000,
} as const;

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
export function getRandomUserAgent(): string {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Browser-like headers for Yasno API requests
 * Helps avoid WAF blocking
 */
export const YASNO_API_HEADERS = {
	'Accept': 'application/json, text/plain, */*',
	'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
	'Accept-Encoding': 'gzip, deflate, br',
	'Referer': 'https://app.yasno.ua/',
	'Origin': 'https://app.yasno.ua',
	'Sec-Fetch-Dest': 'empty',
	'Sec-Fetch-Mode': 'cors',
	'Sec-Fetch-Site': 'same-origin',
} as const;
