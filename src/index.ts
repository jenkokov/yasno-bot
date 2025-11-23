import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ==========================================
// TYPE DEFINITIONS
// ==========================================

interface Env {
	TELEGRAM_TOKEN: string;
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
}

/**
 * Telegram webhook update structure
 */
interface TelegramUpdate {
	message?: {
		chat: { id: number };
		text?: string;
	};
	callback_query?: {
		id: string;
		message: { chat: { id: number } };
		data: string;
	};
}

/**
 * Yasno API data structures
 */
interface Slot {
	start: number;
	end: number;
	type: 'Definite' | 'NotPlanned';
}

interface DaySchedule {
	date: string;
	status: string;
	slots: Slot[];
}

interface ZoneData {
	today: DaySchedule;
	tomorrow: DaySchedule;
	updatedOn?: string;
}

interface YasnoResponse {
	[key: string]: ZoneData;
}

// ==========================================
// CONSTANTS
// ==========================================

const YASNO_API = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages';

const SCHEDULE_STATUS = {
	APPLIES: 'ScheduleApplies',
	WAITING: 'WaitingForSchedule',
} as const;

const SLOT_TYPE = {
	OUTAGE: 'Definite',
	POWER: 'NotPlanned',
} as const;

const ZONES = ['1', '2', '3', '4', '5', '6'] as const;

const MESSAGES = {
	UNSUBSCRIBED: 'Ви відписалися від оновлень.',
	NOT_SUBSCRIBED: 'Ви не підписані на жодну групу. Використайте /start або /subscribe для підписки.',
	FETCHING_SCHEDULE: (zone: string) => `Завантажуємо поточний розклад для групи ${zone}...`,
	SUBSCRIBED: (zone: string) => `✅ Підписано на групу ${zone}. Завантажуємо поточний розклад...`,
	ERROR_FETCHING: 'Не вдалося завантажити дані розкладу. Спробуйте пізніше.',
	ERROR_SUBSCRIPTION: 'Помилка збереження підписки. Спробуйте ще раз.',
	SELECT_ZONE: 'Будь ласка, оберіть вашу групу Yasно:',
} as const;

// ==========================================
// WORKER ENTRY POINTS
// ==========================================

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'POST') {
			try {
				const update = await request.json() as TelegramUpdate;
				await handleTelegramUpdate(update, env);
			} catch (e) {
				console.error('Error handling Telegram update:', e);
			}
			return new Response('OK');
		}
		return new Response('Send POST request to trigger webhook');
	},

	/**
	 * Handle scheduled cron jobs (every 5 minutes)
	 */
	async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		await checkScheduleUpdates(env);
	},
};

// ==========================================
// TELEGRAM UPDATE HANDLING
// ==========================================

/**
 * Main handler for incoming Telegram updates
 */
async function handleTelegramUpdate(update: TelegramUpdate, env: Env): Promise<void> {
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

	// Handle text commands
	if (update.message?.text) {
		const chatId = update.message.chat.id;
		const command = update.message.text;

		await handleCommand(command, chatId, supabase, env.TELEGRAM_TOKEN);
	}

	// Handle button callbacks
	if (update.callback_query) {
		await handleCallbackQuery(update.callback_query, supabase, env.TELEGRAM_TOKEN);
	}
}

/**
 * Route commands to appropriate handlers
 */
async function handleCommand(
	command: string,
	chatId: number,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	switch (command) {
		case '/start':
		case '/subscribe':
			await handleStartCommand(chatId, token);
			break;
		case '/stop':
			await handleStopCommand(chatId, supabase, token);
			break;
		case '/now':
			await handleNowCommand(chatId, supabase, token);
			break;
		default:
			// Ignore unknown commands
			break;
	}
}

/**
 * Handle /start and /subscribe commands - show zone selector
 */
async function handleStartCommand(chatId: number, token: string): Promise<void> {
	await sendZoneSelector(chatId, token);
}

/**
 * Handle /stop command - unsubscribe user
 */
async function handleStopCommand(
	chatId: number,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	try {
		await supabase.from('subscribers').delete().eq('chat_id', chatId);
		await sendMessage(chatId, MESSAGES.UNSUBSCRIBED, token);
	} catch (error) {
		console.error('Error unsubscribing user:', error);
	}
}

/**
 * Handle /now command - fetch and display current schedule
 */
async function handleNowCommand(
	chatId: number,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	try {
		// Get user's subscribed zone
		const { data: subscriber } = await supabase
			.from('subscribers')
			.select('zone')
			.eq('chat_id', chatId)
			.single();

		if (!subscriber) {
			await sendMessage(chatId, MESSAGES.NOT_SUBSCRIBED, token);
			return;
		}

		// Fetch and send current schedule
		await sendMessage(chatId, MESSAGES.FETCHING_SCHEDULE(subscriber.zone), token);
		const currentData = await fetchYasnoData();

		if (currentData && currentData[subscriber.zone]) {
			const msg = formatScheduleMessage(subscriber.zone, currentData[subscriber.zone]);
			await sendMessage(chatId, msg, token);
		} else {
			await sendMessage(chatId, MESSAGES.ERROR_FETCHING, token);
		}
	} catch (error) {
		console.error('Error handling /now command:', error);
		await sendMessage(chatId, MESSAGES.ERROR_FETCHING, token);
	}
}

/**
 * Handle a callback query (zone selection button clicks)
 */
async function handleCallbackQuery(
	callbackQuery: NonNullable<TelegramUpdate['callback_query']>,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	const chatId = callbackQuery.message.chat.id;
	const data = callbackQuery.data;

	if (!data.startsWith('zone_')) {
		return;
	}

	const zone = data.replace('zone_', '');

	try {
		const { error } = await supabase.from('subscribers').upsert({
			chat_id: chatId,
			zone: zone
		});

		if (error) {
			console.error('Error saving subscription to database:', error);
			await sendMessage(chatId, MESSAGES.ERROR_SUBSCRIPTION, token);
			return;
		}

		// Acknowledge the button click
		await answerCallback(callbackQuery.id, `Підписано на групу ${zone}`, token);

		// Send current schedule
		await sendMessage(chatId, MESSAGES.SUBSCRIBED(zone), token);
		const currentData = await fetchYasnoData();

		if (currentData && currentData[zone]) {
			const msg = formatScheduleMessage(zone, currentData[zone]);
			await sendMessage(chatId, msg, token);
		}
	} catch (error) {
		console.error('Error handling zone selection:', error);
		await sendMessage(chatId, MESSAGES.ERROR_SUBSCRIPTION, token);
	}
}

// ==========================================
// SCHEDULE UPDATE CHECKING
// ==========================================

/**
 * Check for schedule updates and notify subscribers
 */
async function checkScheduleUpdates(env: Env): Promise<void> {
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

	try {
		// Fetch fresh data from Yasno API
		const freshData = await fetchYasnoData();
		if (!freshData) {
			console.log('Failed to fetch data from Yasno API');
			return;
		}

		// Fetch cached data from database
		const cachedData = await getCachedData(supabase);

		// Detect which zones have changed
		const changedZones = detectChangedZones(freshData, cachedData);

		if (changedZones.length === 0) {
			console.log('No schedule changes detected');
			return;
		}

		console.log(`Schedule changes detected in zones: ${changedZones.join(', ')}`);

		// Notify subscribers of changed zones
		await notifySubscribers(changedZones, freshData, supabase, env.TELEGRAM_TOKEN);

		// Update cache with fresh data
		await updateCache(supabase, freshData);
	} catch (error) {
		console.error('Error checking schedule updates:', error);
	}
}

/**
 * Fetch cached schedule data from the database
 */
async function getCachedData(supabase: SupabaseClient): Promise<YasnoResponse> {
	const { data: cacheRow } = await supabase
		.from('schedule_cache')
		.select('raw_data')
		.eq('id', 1)
		.single();

	return (cacheRow?.raw_data || {}) as YasnoResponse;
}

/**
 * Detect which zones have changed by comparing fresh and cached data
 */
function detectChangedZones(freshData: YasnoResponse, cachedData: YasnoResponse): string[] {
	const changedZones: string[] = [];
	const zones = Object.keys(freshData);

	for (const zone of zones) {
		const freshZone = freshData[zone];
		const cachedZone = cachedData[zone];

		if (hasZoneChanged(freshZone, cachedZone)) {
			changedZones.push(zone);
		}
	}

	return changedZones;
}

/**
 * Check if a zone's schedule has changed
 */
function hasZoneChanged(freshZone: ZoneData, cachedZone?: ZoneData): boolean {
	if (!cachedZone) {
		return true; // First time seeing this zone
	}

	// Compare timestamps if available (most reliable)
	if (freshZone.updatedOn && cachedZone.updatedOn) {
		return freshZone.updatedOn !== cachedZone.updatedOn;
	}

	// Fallback: compare schedule data only
	const freshSchedule = { today: freshZone.today, tomorrow: freshZone.tomorrow };
	const cachedSchedule = { today: cachedZone.today, tomorrow: cachedZone.tomorrow };
	return JSON.stringify(freshSchedule) !== JSON.stringify(cachedSchedule);
}

/**
 * Notify all subscribers of changed zones
 */
async function notifySubscribers(
	changedZones: string[],
	freshData: YasnoResponse,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	for (const zone of changedZones) {
		const { data: subscribers } = await supabase
			.from('subscribers')
			.select('chat_id')
			.eq('zone', zone);

		if (!subscribers || subscribers.length === 0) {
			continue;
		}

		const message = formatScheduleMessage(zone, freshData[zone], true);

		// Send notifications in parallel
		await Promise.all(
			subscribers.map(sub => sendMessage(sub.chat_id, message, token))
		);
	}
}

/**
 * Update cached schedule data in database
 */
async function updateCache(supabase: SupabaseClient, freshData: YasnoResponse): Promise<void> {
	await supabase
		.from('schedule_cache')
		.update({ raw_data: freshData, updated_at: new Date() })
		.eq('id', 1);
}

// ==========================================
// YASNO API
// ==========================================

/**
 * Fetch schedule data from Yasno API
 */
async function fetchYasnoData(): Promise<YasnoResponse | null> {
	try {
		const response = await fetch(YASNO_API);
		if (!response.ok) {
			console.error(`Yasno API returned status ${response.status}`);
			return null;
		}
		return await response.json() as YasnoResponse;
	} catch (error) {
		console.error('Failed to fetch Yasno data:', error);
		return null;
	}
}

// ==========================================
// MESSAGE FORMATTING
// ==========================================

/**
 * Convert minutes since midnight to HH:MM format
 */
function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
	const mins = (minutes % 60).toString().padStart(2, '0');
	return `${hours}:${mins}`;
}

/**
 * Calculate and format duration between two time points
 */
function getDuration(startMinutes: number, endMinutes: number): string {
	const diffMinutes = endMinutes - startMinutes;
	const hours = Math.floor(diffMinutes / 60);
	const mins = diffMinutes % 60;
	return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

/**
 * Format total minutes into hours and minute string
 */
function formatTotalTime(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

/**
 * Format a single day's schedule (today or tomorrow)
 */
function formatDay(dayData: DaySchedule, label: string): string {
	const dateObj = new Date(dayData.date);
	const dateStr = dateObj.toLocaleDateString('uk-UA', {
		timeZone: 'Europe/Kyiv',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		weekday: 'short'
	});

	// Status emoji based on schedule certainty
	const statusEmoji = dayData.status === SCHEDULE_STATUS.APPLIES ? '✅' : '⏳';

	let output = `📅 *${label}* (${dateStr}) ${statusEmoji}\n\n`;

	// Separate slots by type
	const outages = dayData.slots.filter(slot => slot.type === SLOT_TYPE.OUTAGE);
	const power = dayData.slots.filter(slot => slot.type === SLOT_TYPE.POWER);

	// Calculate total times
	const totalOutageMinutes = outages.reduce((sum, slot) => sum + (slot.end - slot.start), 0);
	const totalPowerMinutes = power.reduce((sum, slot) => sum + (slot.end - slot.start), 0);

	// Format outages section
	if (outages.length > 0) {
		output += `🔴 *Відключення* (${formatTotalTime(totalOutageMinutes)} всього):\n`;
		outages.forEach(slot => {
			const start = formatMinutes(slot.start);
			const end = formatMinutes(slot.end);
			const duration = getDuration(slot.start, slot.end);
			output += `  • ${start}–${end} (${duration})\n`;
		});
	} else {
		output += `🔴 *Відключення* (0h всього):\n  • Немає відключень\n`;
	}

	// Format power section
	output += `🟢 *Електропостачання* (${formatTotalTime(totalPowerMinutes)} всього):\n`;
	power.forEach(slot => {
		const start = formatMinutes(slot.start);
		const end = formatMinutes(slot.end);
		const duration = getDuration(slot.start, slot.end);
		output += `  • ${start}–${end} (${duration})\n`;
	});

	return output;
}

/**
 * Format complete schedule message for a zone
 */
function formatScheduleMessage(zone: string, data: ZoneData, isUpdate = false): string {
	const header = isUpdate
		? `⚡️ *Розклад оновлено*\nГрупа: *${zone}*\n\n`
		: `⚡️ *Поточний розклад*\nГрупа: *${zone}*\n\n`;

	const footer = formatUpdateTimestamp(data.updatedOn);

	return header +
		formatDay(data.today, 'Сьогодні') +
		'\n' + formatDay(data.tomorrow, 'Завтра') +
		footer;
}

/**
 * Format the update timestamp footer
 */
function formatUpdateTimestamp(updatedOn?: string): string {
	if (!updatedOn) {
		return '';
	}

	const updatedDate = new Date(updatedOn);
	const updatedStr = updatedDate.toLocaleString('uk-UA', {
		timeZone: 'Europe/Kyiv',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	return `\n⏱ Оновлено: ${updatedStr}`;
}

// ==========================================
// TELEGRAM API HELPERS
// ==========================================

/**
 * Send a text message to a Telegram chat
 */
async function sendMessage(chatId: number | string, text: string, token: string): Promise<void> {
	try {
		const url = `https://api.telegram.org/bot${token}/sendMessage`;
		await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: text,
				parse_mode: 'Markdown'
			})
		});
	} catch (error) {
		console.error(`Failed to send message to chat ${chatId}:`, error);
	}
}

/**
 * Answer a callback query (acknowledge button click)
 */
async function answerCallback(callbackId: string, text: string, token: string): Promise<void> {
	try {
		const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
		await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				callback_query_id: callbackId,
				text: text
			})
		});
	} catch (error) {
		console.error('Failed to answer callback query:', error);
	}
}

/**
 * Send zone selector keyboard to user
 */
async function sendZoneSelector(chatId: number, token: string): Promise<void> {
	try {
		const keyboard = buildZoneKeyboard();
		const url = `https://api.telegram.org/bot${token}/sendMessage`;

		await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: MESSAGES.SELECT_ZONE,
				reply_markup: { inline_keyboard: keyboard }
			})
		});
	} catch (error) {
		console.error('Failed to send zone selector:', error);
	}
}

/**
 * Build inline keyboard with zone buttons (1.1, 1.2, 2.1, etc.)
 */
function buildZoneKeyboard(): Array<Array<{ text: string; callback_data: string }>> {
	const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

	// Create rows with 4 buttons each (X.1, X.2, Y.1, Y.2)
	for (let i = 0; i < ZONES.length; i += 2) {
		const row = [];

		// Add buttons for the current group
		row.push({ text: `${ZONES[i]}.1`, callback_data: `zone_${ZONES[i]}.1` });
		row.push({ text: `${ZONES[i]}.2`, callback_data: `zone_${ZONES[i]}.2` });

		// Add buttons for next group if exists
		if (i + 1 < ZONES.length) {
			row.push({ text: `${ZONES[i + 1]}.1`, callback_data: `zone_${ZONES[i + 1]}.1` });
			row.push({ text: `${ZONES[i + 1]}.2`, callback_data: `zone_${ZONES[i + 1]}.2` });
		}

		keyboard.push(row);
	}

	return keyboard;
}
