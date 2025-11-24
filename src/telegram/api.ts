/**
 * Telegram Bot API helpers
 */

import { TELEGRAM_RATE_LIMITS } from '../config/constants';

/**
 * Send a text message to a Telegram chat
 */
export async function sendMessage(chatId: number | string, text: string, token: string): Promise<boolean> {
	try {
		const url = `https://api.telegram.org/bot${token}/sendMessage`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: text,
				parse_mode: 'Markdown'
			})
		});

		return response.ok;
	} catch (error) {
		console.error(`Failed to send message to chat ${chatId}:`, error);
		return false;
	}
}

/**
 * Send messages in bulk with rate limiting
 * Chunks messages and respects Telegram rate limits
 */
export async function sendBulkMessages(
	chatIds: number[],
	text: string,
	token: string
): Promise<{ successful: number; failed: number }> {
	let successful = 0;
	let failed = 0;

	// Process in chunks to respect rate limits
	for (let i = 0; i < chatIds.length; i += TELEGRAM_RATE_LIMITS.CHUNK_SIZE) {
		const chunk = chatIds.slice(i, i + TELEGRAM_RATE_LIMITS.CHUNK_SIZE);

		// Send all messages in this chunk in parallel
		const results = await Promise.allSettled(
			chunk.map(chatId => sendMessage(chatId, text, token))
		);

		// Count results
		for (const result of results) {
			if (result.status === 'fulfilled' && result.value) {
				successful++;
			} else {
				failed++;
			}
		}

		// Wait before next chunk (unless it's the last chunk)
		if (i + TELEGRAM_RATE_LIMITS.CHUNK_SIZE < chatIds.length) {
			await new Promise(resolve => setTimeout(resolve, TELEGRAM_RATE_LIMITS.CHUNK_DELAY_MS));
		}
	}

	return { successful, failed };
}

/**
 * Answer a callback query (acknowledge button click)
 */
export async function answerCallback(callbackId: string, text: string, token: string): Promise<void> {
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
 * Send a message with an inline keyboard
 */
export async function sendMessageWithKeyboard(
	chatId: number,
	text: string,
	keyboard: Array<Array<{ text: string; callback_data: string }>>,
	token: string
): Promise<void> {
	try {
		const url = `https://api.telegram.org/bot${token}/sendMessage`;

		await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: text,
				reply_markup: { inline_keyboard: keyboard }
			})
		});
	} catch (error) {
		console.error('Failed to send message with keyboard:', error);
	}
}
