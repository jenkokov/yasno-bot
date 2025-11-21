import { createClient } from '@supabase/supabase-js';

// --- Configuration ---
const YASNO_API = 'https://app.yasno.ua/api/blackout-service/public/shutdowns/regions/25/dsos/902/planned-outages';

// Define interfaces for the Yasno JSON structure
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

export default {
	async fetch(request: Request, env: any, ctx: any): Promise<Response> {
		// 1. Handle Telegram Webhooks
		if (request.method === 'POST') {
			try {
				const update = await request.json() as any;
				await handleTelegramUpdate(update, env);
			} catch (e) {
				console.error('Error handling update', e);
			}
			return new Response('OK');
		}
		return new Response('Send POST request to trigger webhook');
	},

	// 2. Handle Cron Jobs (Scheduled Checks)
	async scheduled(event: any, env: any, ctx: any) {
		await checkScheduleUpdates(env);
	},
};

// --- Core Logic ---

async function handleTelegramUpdate(update: any, env: any) {
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

	// Handle Commands (e.g. /start)
	if (update.message && update.message.text) {
		const chatId = update.message.chat.id;
		const text = update.message.text;

		if (text === '/start') {
			await sendZoneSelector(chatId, env.TELEGRAM_TOKEN);
		} else if (text === '/stop') {
			await supabase.from('subscribers').delete().eq('chat_id', chatId);
			await sendMessage(chatId, "You have unsubscribed from updates.", env.TELEGRAM_TOKEN);
		} else if (text === '/now') {
			// Get user's subscribed zone
			const { data: subscriber } = await supabase
				.from('subscribers')
				.select('zone')
				.eq('chat_id', chatId)
				.single();

			if (!subscriber) {
				await sendMessage(chatId, "You are not subscribed to any zone. Use /start to subscribe.", env.TELEGRAM_TOKEN);
			} else {
				// Fetch fresh schedule
				await sendMessage(chatId, `Fetching current schedule for Zone ${subscriber.zone}...`, env.TELEGRAM_TOKEN);
				const currentData = await fetchYasnoData();

				if (currentData && currentData[subscriber.zone]) {
					const msg = formatScheduleMessage(subscriber.zone, currentData[subscriber.zone]);
					await sendMessage(chatId, msg, env.TELEGRAM_TOKEN);
				} else {
					await sendMessage(chatId, "Unable to fetch schedule data. Please try again later.", env.TELEGRAM_TOKEN);
				}
			}
		}
	}

	// Handle Button Clicks (Callback Queries)
	if (update.callback_query) {
		const chatId = update.callback_query.message.chat.id;
		const data = update.callback_query.data; // e.g. "zone_1.1"

		if (data.startsWith('zone_')) {
			const zone = data.replace('zone_', '');

			// 1. Save to DB
			const { error } = await supabase.from('subscribers').upsert({
				chat_id: chatId,
				zone: zone
			});

			if (!error) {
				// 2. Ack the button click
				await answerCallback(update.callback_query.id, `Subscribed to Zone ${zone}`, env.TELEGRAM_TOKEN);

				// 3. Send immediate current schedule
				await sendMessage(chatId, `✅ Subscribed to Zone ${zone}. Fetching current schedule...`, env.TELEGRAM_TOKEN);
				const currentData = await fetchYasnoData();
				if (currentData && currentData[zone]) {
					const msg = formatScheduleMessage(zone, currentData[zone]);
					await sendMessage(chatId, msg, env.TELEGRAM_TOKEN);
				}
			} else {
				await sendMessage(chatId, "Error saving subscription. Please try again.", env.TELEGRAM_TOKEN);
			}
		}
	}
}

async function checkScheduleUpdates(env: any) {
	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

	// 1. Fetch fresh data
	const freshData = await fetchYasnoData();
	if (!freshData) return; // API might be down

	// 2. Fetch cached data
	const { data: cacheRow } = await supabase.from('schedule_cache').select('raw_data').eq('id', 1).single();
	const cachedData = cacheRow?.raw_data || {};

	// 3. Find changed zones
	const changedZones: string[] = [];
	const zones = Object.keys(freshData);

	for (const zone of zones) {
		// Use updatedOn timestamp to detect changes, or compare schedule data if missing
		const freshZone = freshData[zone];
		const cachedZone = cachedData[zone];

		if (!cachedZone) {
			// First time seeing this zone
			changedZones.push(zone);
		} else if (freshZone.updatedOn && cachedZone.updatedOn) {
			// Compare timestamps if available
			if (freshZone.updatedOn !== cachedZone.updatedOn) {
				changedZones.push(zone);
			}
		} else {
			// Fallback: compare only the schedule data (today + tomorrow), not updatedOn
			const freshSchedule = { today: freshZone.today, tomorrow: freshZone.tomorrow };
			const cachedSchedule = { today: cachedZone.today, tomorrow: cachedZone.tomorrow };
			if (JSON.stringify(freshSchedule) !== JSON.stringify(cachedSchedule)) {
				changedZones.push(zone);
			}
		}
	}

	if (changedZones.length === 0) {
		console.log("No changes detected.");
		return;
	}

	console.log(`Changes detected in zones: ${changedZones.join(', ')}`);

	// 4. Notify Users
	for (const zone of changedZones) {
		// Get subscribers for this zone
		const { data: subs } = await supabase.from('subscribers').select('chat_id').eq('zone', zone);

		if (subs && subs.length > 0) {
			const message = formatScheduleMessage(zone, freshData[zone], true); // true = isUpdate

			// Send in parallel
			await Promise.all(subs.map(sub => sendMessage(sub.chat_id, message, env.TELEGRAM_TOKEN)));
		}
	}

	// 5. Update Cache
	await supabase.from('schedule_cache').update({ raw_data: freshData, updated_at: new Date() }).eq('id', 1);
}

// --- Helpers: Yasno & Formatting ---

async function fetchYasnoData(): Promise<YasnoResponse | null> {
	try {
		const res = await fetch(YASNO_API);
		if (res.ok) return await res.json() as YasnoResponse;
		return null;
	} catch (e) {
		console.error("Yasno fetch failed", e);
		return null;
	}
}

function formatMinutes(minutes: number): string {
	const h = Math.floor(minutes / 60).toString().padStart(2, '0');
	const m = (minutes % 60).toString().padStart(2, '0');
	return `${h}:${m}`;
}

function getDuration(start: number, end: number): string {
	const diff = end - start;
	const h = Math.floor(diff / 60);
	const m = diff % 60;
	return `${h}h${m > 0 ? m + 'm' : ''}`;
}

function formatDay(dayData: DaySchedule, label: string): string {
	const dateObj = new Date(dayData.date);
	const dateStr = dateObj.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' });

	// Status Icons
	const statusIcon = dayData.status === 'ScheduleApplies' ? '❌' : '❓'; // Red X for definite schedule, "?" for waiting

	let output = `*${label} (${dateStr}), ${dayData.status}* ${statusIcon}:\n`;

	dayData.slots.forEach(slot => {
		// Yasno logic: Definite = Outage (Red), NotPlanned = Power On (Green)
		const icon = slot.type === 'Definite' ? '🔴' : '🟢';
		const start = formatMinutes(slot.start);
		const end = formatMinutes(slot.end);
		const duration = getDuration(slot.start, slot.end);

		output += `${icon} ${start} – ${end} (${duration})\n`;
	});

	return output;
}

function formatScheduleMessage(zone: string, data: ZoneData, isUpdate = false): string {
	const now = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
	const header = isUpdate
		? `⚡️ *Schedule Updated* at ${now}\nZone: *${zone}*\n`
		: `⚡️ *Current Schedule* for Zone *${zone}*\n`;

	return header +
		"\n" + formatDay(data.today, "Today") +
		"\n" + formatDay(data.tomorrow, "Tomorrow");
}

// --- Helpers: Telegram ---

async function sendMessage(chatId: number | string, text: string, token: string) {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
	});
}

async function answerCallback(callbackId: string, text: string, token: string) {
	const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ callback_query_id: callbackId, text: text })
	});
}

async function sendZoneSelector(chatId: number, token: string) {
	const groups = ['1', '2', '3', '4', '5', '6'];
	const keyboard = [];

	// Create rows of buttons
	for (let i = 0; i < groups.length; i+=2) {
		const row = [];
		// Add X.1 and X.2 for the current group
		row.push({ text: `${groups[i]}.1`, callback_data: `zone_${groups[i]}.1` });
		row.push({ text: `${groups[i]}.2`, callback_data: `zone_${groups[i]}.2` });
		if (groups[i+1]) {
			row.push({ text: `${groups[i+1]}.1`, callback_data: `zone_${groups[i+1]}.1` });
			row.push({ text: `${groups[i+1]}.2`, callback_data: `zone_${groups[i+1]}.2` });
		}
		keyboard.push(row);
	}

	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: "Please select your Yasno Zone:",
			reply_markup: { inline_keyboard: keyboard }
		})
	});
}
