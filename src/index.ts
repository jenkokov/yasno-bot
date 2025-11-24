/**
 * A Telegram bot that monitors Ukrainian power outage schedules from Yasno
 * and sends automatic notifications when schedules change.
 */

import type { Env, TelegramUpdate } from './types';
import { createSupabaseClient } from './database/client';
import { handleTelegramUpdate } from './telegram/handlers';
import { checkScheduleUpdates } from './services/scheduler';


async function fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
	if (request.method === 'POST') {
		try {
			const update = await request.json() as TelegramUpdate;
			const supabase = createSupabaseClient(env);
			await handleTelegramUpdate(update, supabase, env.TELEGRAM_TOKEN);
		} catch (e) {
			console.error('Error handling Telegram update:', e);
		}
		return new Response('OK');
	}
	return new Response('Send POST request to trigger webhook');
}

async function scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
	const supabase = createSupabaseClient(env);
	await checkScheduleUpdates(supabase, env.TELEGRAM_TOKEN, env.WEBSHARE_KEY);
}

// Export as Cloudflare Worker
export default {
	fetch,
	scheduled,
};
