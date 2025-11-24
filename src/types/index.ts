/**
 * Type definitions for the Yasno Bot
 */

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
	TELEGRAM_TOKEN: string;
	SUPABASE_URL: string;
	SUPABASE_KEY: string;
}

/**
 * Telegram webhook update structure
 */
export interface TelegramUpdate {
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
export interface Slot {
	start: number;
	end: number;
	type: 'Definite' | 'NotPlanned';
}

export interface DaySchedule {
	date: string;
	status: string;
	slots: Slot[];
}

export interface ZoneData {
	today: DaySchedule;
	tomorrow: DaySchedule;
	updatedOn?: string;
}

export interface YasnoResponse {
	[key: string]: ZoneData;
}

/**
 * Database types
 */
export interface User {
	id: number;
	chat_id: number;
	created_at: Date;
	last_interaction_at: Date;
}

export interface Subscription {
	id: number;
	user_id: number;
	zone: string;
	subscribed_at: Date;
}

export interface SubscriberInfo {
	chat_id: number;
	zone: string;
}

/**
 * Grouped subscribers for bulk sending
 */
export interface ZoneSubscribers {
	[zone: string]: number[];
}
