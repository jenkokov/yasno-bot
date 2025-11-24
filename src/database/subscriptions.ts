/**
 * Subscription database operations
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SubscriberInfo, ZoneSubscribers } from '../types';
import { ensureUser, getUserId } from './users';

/**
 * Subscribe a user to a zone (upsert)
 */
export async function subscribeUser(
	supabase: SupabaseClient,
	chatId: number,
	zone: string
): Promise<boolean> {
	try {
		// Ensure user exists and get their ID
		const userId = await ensureUser(supabase, chatId);
		if (!userId) {
			return false;
		}

		// Upsert subscription
		const { error } = await supabase
			.from('subscriptions')
			.upsert({
				user_id: userId,
				zone: zone,
			}, {
				onConflict: 'user_id'
			});

		if (error) {
			console.error('Error subscribing user:', error);
			return false;
		}

		return true;
	} catch (error) {
		console.error('Error in subscribeUser:', error);
		return false;
	}
}

/**
 * Unsubscribe a user (delete their subscription, but keep user record)
 */
export async function unsubscribeUser(supabase: SupabaseClient, chatId: number): Promise<boolean> {
	try {
		const userId = await getUserId(supabase, chatId);
		if (!userId) {
			return false;
		}

		const { error } = await supabase
			.from('subscriptions')
			.delete()
			.eq('user_id', userId);

		if (error) {
			console.error('Error unsubscribing user:', error);
			return false;
		}

		return true;
	} catch (error) {
		console.error('Error in unsubscribeUser:', error);
		return false;
	}
}

/**
 * Get a user's current subscription zone
 */
export async function getUserSubscription(
	supabase: SupabaseClient,
	chatId: number
): Promise<string | null> {
	try {
		const userId = await getUserId(supabase, chatId);
		if (!userId) {
			return null;
		}

		const { data } = await supabase
			.from('subscriptions')
			.select('zone')
			.eq('user_id', userId)
			.single();

		return data?.zone ?? null;
	} catch (error) {
		console.error('Error getting user subscription:', error);
		return null;
	}
}

/**
 * Get all subscribers for a specific zone
 */
export async function getZoneSubscribers(
	supabase: SupabaseClient,
	zone: string
): Promise<number[]> {
	try {
		// Get user_ids for this zone
		const { data: subscriptions, error: subError } = await supabase
			.from('subscriptions')
			.select('user_id')
			.eq('zone', zone);

		if (subError) {
			console.error('Error fetching zone subscriptions:', subError);
			return [];
		}

		if (!subscriptions || subscriptions.length === 0) {
			return [];
		}

		const userIds = subscriptions.map(s => s.user_id);

		// Get chat_ids for these users
		const { data: users, error: userError } = await supabase
			.from('users')
			.select('chat_id')
			.in('id', userIds);

		if (userError) {
			console.error('Error fetching users:', userError);
			return [];
		}

		return users?.map(u => u.chat_id) ?? [];
	} catch (error) {
		console.error('Error in getZoneSubscribers:', error);
		return [];
	}
}

/**
 * Get all subscribers grouped by zone (for bulk notifications)
 */
export async function getAllSubscribersGroupedByZone(
	supabase: SupabaseClient
): Promise<ZoneSubscribers> {
	try {
		// Get all subscriptions
		const { data: subscriptions, error: subError } = await supabase
			.from('subscriptions')
			.select('zone, user_id');

		if (subError) {
			console.error('Error fetching subscriptions:', subError);
			return {};
		}

		if (!subscriptions || subscriptions.length === 0) {
			return {};
		}

		// Get all unique user_ids
		const userIds = [...new Set(subscriptions.map(s => s.user_id))];

		// Get all users
		const { data: users, error: userError } = await supabase
			.from('users')
			.select('id, chat_id')
			.in('id', userIds);

		if (userError) {
			console.error('Error fetching users:', userError);
			return {};
		}

		// Create a map of user_id -> chat_id
		const userMap = new Map<number, number>();
		for (const user of users || []) {
			userMap.set(user.id, user.chat_id);
		}

		// Group by zone
		const grouped: ZoneSubscribers = {};
		for (const sub of subscriptions) {
			const chatId = userMap.get(sub.user_id);
			if (!chatId) continue;

			if (!grouped[sub.zone]) {
				grouped[sub.zone] = [];
			}
			grouped[sub.zone].push(chatId);
		}

		return grouped;
	} catch (error) {
		console.error('Error in getAllSubscribersGroupedByZone:', error);
		return {};
	}
}

/**
 * Get all active subscribers (for backward compatibility)
 */
export async function getAllSubscribers(supabase: SupabaseClient): Promise<SubscriberInfo[]> {
	try {
		// Get all subscriptions
		const { data: subscriptions, error: subError } = await supabase
			.from('subscriptions')
			.select('zone, user_id');

		if (subError) {
			console.error('Error fetching all subscriptions:', subError);
			return [];
		}

		if (!subscriptions || subscriptions.length === 0) {
			return [];
		}

		// Get all unique user_ids
		const userIds = [...new Set(subscriptions.map(s => s.user_id))];

		// Get all users
		const { data: users, error: userError } = await supabase
			.from('users')
			.select('id, chat_id')
			.in('id', userIds);

		if (userError) {
			console.error('Error fetching users:', userError);
			return [];
		}

		// Create a map of user_id -> chat_id
		const userMap = new Map<number, number>();
		for (const user of users || []) {
			userMap.set(user.id, user.chat_id);
		}

		// Map to SubscriberInfo
		const result: SubscriberInfo[] = [];
		for (const sub of subscriptions) {
			const chatId = userMap.get(sub.user_id);
			if (chatId) {
				result.push({ chat_id: chatId, zone: sub.zone });
			}
		}

		return result;
	} catch (error) {
		console.error('Error in getAllSubscribers:', error);
		return [];
	}
}
