import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Ensure a user exists in the database (create if not exists)
 * Updates last_interaction_at on each call
 */
export async function ensureUser(supabase: SupabaseClient, chatId: number): Promise<number | null> {
	try {
		const { data: existingUser, error: selectError } = await supabase
			.from('users')
			.select('id')
			.eq('chat_id', chatId)
			.single();

		if (selectError && selectError.code !== 'PGRST116') {
			// PGRST116 is "not found", which is expected. Other errors are problems.
			console.error('Error selecting user:', selectError);
		}

		if (existingUser) {
			// Update last interaction time
			await supabase
				.from('users')
				.update({ last_interaction_at: new Date() })
				.eq('id', existingUser.id);

			return existingUser.id;
		}

		const { data: newUser, error } = await supabase
			.from('users')
			.insert({ chat_id: chatId })
			.select('id')
			.single();

		if (error) {
			console.error('Error creating user:', error);
			return null;
		}

		return newUser?.id ?? null;
	} catch (error) {
		console.error('Error in ensureUser:', error);
		return null;
	}
}

export async function getUserId(supabase: SupabaseClient, chatId: number): Promise<number | null> {
	const { data } = await supabase
		.from('users')
		.select('id')
		.eq('chat_id', chatId)
		.single();

	return data?.id ?? null;
}

