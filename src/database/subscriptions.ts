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
		const { data, error } = await supabase
			.from('subscriptions')
			.select('user_id, users!inner(chat_id)')
			.eq('zone', zone);

		if (error) {
			console.error('Error fetching zone subscribers:', error);
			return [];
		}

		// Extract chat_ids from the joined user data
		return data?.map((sub: any) => sub.users.chat_id) ?? [];
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
		const { data, error } = await supabase
			.from('subscriptions')
			.select('zone, user_id, users!inner(chat_id)');

		if (error) {
			console.error('Error fetching subscribers:', error);
			return {};
		}

		// Group by zone
		const grouped: ZoneSubscribers = {};
		for (const sub of data || []) {
			const zone = sub.zone;
			const chatId = (sub.users as any).chat_id;

			if (!grouped[zone]) {
				grouped[zone] = [];
			}
			grouped[zone].push(chatId);
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
		const { data, error } = await supabase
			.from('subscriptions')
			.select('zone, user_id, users!inner(chat_id)');

		if (error) {
			console.error('Error fetching all subscribers:', error);
			return [];
		}

		return data?.map((sub: any) => ({
			chat_id: sub.users.chat_id,
			zone: sub.zone
		})) ?? [];
	} catch (error) {
		console.error('Error in getAllSubscribers:', error);
		return [];
	}
}
