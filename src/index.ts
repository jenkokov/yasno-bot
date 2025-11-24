/**
 * Yasno Bot - Cloudflare Worker Entry Point
 *
 * A Telegram bot that monitors Ukrainian power outage schedules from Yasno
 * and sends automatic notifications when schedules change.
 *
 * Architecture:
 * - Modular design with clear separation of concerns
 * - Database layer separated (users, subscriptions, cache)
 * - Telegram API and handlers isolated
 * - Yasno API, change detection, and formatting isolated
 * - Service layer for scheduled tasks
 */

import type { Env, TelegramUpdate } from './types';
import { createSupabaseClient } from './database/client';
import { handleTelegramUpdate } from './telegram/handlers';
import { checkScheduleUpdates } from './services/scheduler';

/**
 * Main entry point for HTTP requests (Telegram webhook)
 */
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

/**
 * Handle scheduled cron jobs (every 10 minutes per wrangler.jsonc)
 */
async function scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
	const supabase = createSupabaseClient(env);
	await checkScheduleUpdates(supabase, env.TELEGRAM_TOKEN);
}

// Export as Cloudflare Worker
export default {
	fetch,
	scheduled,
};
