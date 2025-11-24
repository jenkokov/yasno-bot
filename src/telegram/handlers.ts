/**
 * Telegram command handlers
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TelegramUpdate } from '../types';
import { MESSAGES, ADMIN_CHAT_ID } from '../config/constants';
import { subscribeUser, unsubscribeUser, getUserSubscription, getAllSubscribers } from '../database/subscriptions';
import { getCachedData } from '../database/cache';
import { sendMessage, sendBulkMessages, answerCallback, sendMessageWithKeyboard } from './api';
import { buildZoneKeyboard } from './keyboards';
import { formatScheduleMessage } from '../yasno/formatter';
import { fetchYasnoData } from '../yasno/api';

/**
 * Main handler for incoming Telegram updates
 */
export async function handleTelegramUpdate(
	update: TelegramUpdate,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	// Handle text commands
	if (update.message?.text) {
		const chatId = update.message.chat.id;
		const command = update.message.text;

		await handleCommand(command, chatId, supabase, token);
	}

	// Handle button callbacks
	if (update.callback_query) {
		await handleCallbackQuery(update.callback_query, supabase, token);
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
	// Handle broadcast command with message text
	if (command.startsWith('/broadcast ')) {
		const message = command.substring('/broadcast '.length);
		await handleBroadcastCommand(chatId, message, supabase, token);
		return;
	}

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
	const keyboard = buildZoneKeyboard();
	await sendMessageWithKeyboard(chatId, MESSAGES.SELECT_ZONE, keyboard, token);
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
		await unsubscribeUser(supabase, chatId);
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
 * Handle /broadcast command - admin only, send message to all subscribers
 */
async function handleBroadcastCommand(
	chatId: number,
	message: string,
	supabase: SupabaseClient,
	token: string
): Promise<void> {
	// Only allow admin to broadcast
	if (chatId !== ADMIN_CHAT_ID) {
		console.log(`Unauthorized broadcast attempt from chat_id: ${chatId}`);
		return;
	}

	try {
		await sendMessage(chatId, '📢 Розсилаємо повідомлення...', token);

		// Get all active subscribers
		const subscribers = await getAllSubscribers(supabase);

		if (subscribers.length === 0) {
			await sendMessage(chatId, 'ℹ️ Немає підписників для розсилки', token);
			return;
		}

		// Get unique chat IDs
		const uniqueChatIds = [...new Set(subscribers.map(s => s.chat_id))];

		// Send using bulk method with rate limiting
		const { successful, failed } = await sendBulkMessages(uniqueChatIds, message, token);

		await sendMessage(
			chatId,
			`✅ Розсилка завершена!\n\n` +
			`📤 Надіслано: ${successful}\n` +
			`❌ Помилки: ${failed}\n` +
			`👥 Всього підписників: ${uniqueChatIds.length}`,
			token
		);
	} catch (error) {
		console.error('Error in broadcast command:', error);
		await sendMessage(
			chatId,
			`❌ Помилка розсилки: ${error instanceof Error ? error.message : 'Невідома помилка'}`,
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
		const zone = await getUserSubscription(supabase, chatId);

		if (!zone) {
			await sendMessage(chatId, MESSAGES.NOT_SUBSCRIBED, token);
			return;
		}

		// Get cached schedule data
		const cachedData = await getCachedData(supabase);

		if (cachedData && cachedData[zone]) {
			const msg = formatScheduleMessage(zone, cachedData[zone]);
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
		const success = await subscribeUser(supabase, chatId, zone);

		if (!success) {
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
