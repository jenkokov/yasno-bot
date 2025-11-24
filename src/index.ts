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
		case '/test':
			await handleTestCommand(chatId, token);
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
 * Handle /test command - test API connectivity
 */
async function handleTestCommand(chatId: number, token: string): Promise<void> {
	try {
		await sendMessage(chatId, '🔍 Тестуємо з\'єднання з API Yasno...', token);

		const startTime = Date.now();
		const freshData = await fetchYasnoData();
		const duration = Date.now() - startTime;

		if (freshData) {
			const zones = Object.keys(freshData);
			const zoneList = zones.join(', ');
			const hasUpdatedOn = freshData[zones[0]]?.updatedOn;

			const report = `✅ API працює!\n\n` +
				`⏱ Час відповіді: ${duration}ms\n` +
				`📊 Отримано зон: ${zones.length}\n` +
				`🗂 Зони: ${zoneList}\n` +
				`📅 Має updatedOn: ${hasUpdatedOn ? 'Так' : 'Ні'}`;

			await sendMessage(chatId, report, token);
		} else {
			await sendMessage(
				chatId,
				`❌ API не відповідає\n\n` +
				`⏱ Час спроби: ${duration}ms\n\n` +
				`Перевірте логи Cloudflare Workers для деталей помилки.`,
				token
			);
		}
	} catch (error) {
		console.error('Error in test command:', error);
		await sendMessage(
			chatId,
			`❌ Помилка тестування: ${error instanceof Error ? error.message : 'Невідома помилка'}`,
			token
		);
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

		// Get cached schedule data
		const cachedData = await getCachedData(supabase);

		if (cachedData && cachedData[subscriber.zone]) {
			const msg = formatScheduleMessage(subscriber.zone, cachedData[subscriber.zone]);
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

		// Send current schedule from cache
		const cachedData = await getCachedData(supabase);

		if (cachedData && cachedData[zone]) {
			const msg = formatScheduleMessage(zone, cachedData[zone]);
			await sendMessage(chatId, msg, token);
		} else {
			await sendMessage(chatId, MESSAGES.ERROR_FETCHING, token);
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
		// Fetch fresh data from Yasno API with retry logic
		let freshData = await fetchYasnoData();

		// Retry once after 2 seconds if first attempt failed
		if (!freshData) {
			console.log('First fetch attempt failed, retrying in 2 seconds...');
			await new Promise(resolve => setTimeout(resolve, 2000));
			freshData = await fetchYasnoData();
		}

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

		// Notify subscribers of changed zones
		await notifySubscribers(changedZones, freshData, supabase, env.TELEGRAM_TOKEN);

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
 * Get detailed information about what changed in a zone
 */
function getChangeDetails(zone: string, freshZone: ZoneData, cachedZone?: ZoneData): string {
	if (!cachedZone) {
		return `${zone}: First time seeing this zone`;
	}

	const details: string[] = [];

	// Check today
	if (!compareScheduleData(freshZone.today, cachedZone.today)) {
		if (freshZone.today.status !== cachedZone.today.status) {
			details.push(`today status: ${cachedZone.today.status} → ${freshZone.today.status}`);
		}
		if (freshZone.today.slots.length !== cachedZone.today.slots.length) {
			details.push(`today slots count: ${cachedZone.today.slots.length} → ${freshZone.today.slots.length}`);
		} else {
			details.push('today slots changed');
		}
	}

	// Check tomorrow
	if (!compareScheduleData(freshZone.tomorrow, cachedZone.tomorrow)) {
		if (freshZone.tomorrow.status !== cachedZone.tomorrow.status) {
			details.push(`tomorrow status: ${cachedZone.tomorrow.status} → ${freshZone.tomorrow.status}`);
		}
		if (freshZone.tomorrow.slots.length !== cachedZone.tomorrow.slots.length) {
			details.push(`tomorrow slots count: ${cachedZone.tomorrow.slots.length} → ${freshZone.tomorrow.slots.length}`);
		} else {
			details.push('tomorrow slots changed');
		}
	}

	// Check if updatedOn changed (for reference, even though we don't use it for detection)
	if (freshZone.updatedOn !== cachedZone.updatedOn) {
		details.push(`updatedOn: ${cachedZone.updatedOn || 'null'} → ${freshZone.updatedOn || 'null'}`);
	}

	return `${zone}: ${details.join(', ')}`;
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
			// Log detailed change information
			console.log(getChangeDetails(zone, freshZone, cachedZone));
		}
	}

	return changedZones;
}

/**
 * Compare only the meaningful schedule data (slots and status), ignoring date and timestamp fields
 */
function compareScheduleData(day1: DaySchedule, day2: DaySchedule): boolean {
	// Compare status
	if (day1.status !== day2.status) {
		return false; // Different
	}

	// Compare slots array
	if (day1.slots.length !== day2.slots.length) {
		return false; // Different number of slots
	}

	// Compare each slot
	for (let i = 0; i < day1.slots.length; i++) {
		const slot1 = day1.slots[i];
		const slot2 = day2.slots[i];

		if (slot1.start !== slot2.start || slot1.end !== slot2.end || slot1.type !== slot2.type) {
			return false; // Slot differs
		}
	}

	return true; // Same
}

/**
 * Check if a zone's schedule has changed
 * Only compares meaningful data: slots and status (ignores dates and timestamps)
 */
function hasZoneChanged(freshZone: ZoneData, cachedZone?: ZoneData): boolean {
	if (!cachedZone) {
		return true; // First time seeing this zone
	}

	// Compare today's schedule data
	const todayChanged = !compareScheduleData(freshZone.today, cachedZone.today);

	// Compare tomorrow's schedule data
	const tomorrowChanged = !compareScheduleData(freshZone.tomorrow, cachedZone.tomorrow);

	return todayChanged || tomorrowChanged;
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

/**
 * Save API response to history table for debugging
 */
async function saveToHistory(
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

// ==========================================
// YASNO API
// ==========================================

/**
 * Fetch schedule data from Yasno API
 */
async function fetchYasnoData(): Promise<YasnoResponse | null> {
	try {
		const response = await fetch(YASNO_API, {
			headers: {
				'User-Agent': 'YasnoBot/1.0',
				'Accept': 'application/json'
			}
		});
		if (!response.ok) {
			const errorText = await response.text();
			console.error(`Yasno API returned status ${response.status}: ${errorText}`);
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
	return mins > 0 ? `${hours}г${mins}хв` : `${hours}г`;
}

/**
 * Format total minutes into hours and minute string
 */
function formatTotalTime(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours}г${minutes}хв` : `${hours}г`;
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
		output += `🔴 *Відключення* (0г всього):\n  • Немає відключень\n`;
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
