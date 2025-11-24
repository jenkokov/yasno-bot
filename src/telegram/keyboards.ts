/**
 * Telegram inline keyboard builders
 */

import { ZONES } from '../config/constants';

/**
 * Build inline keyboard with zone buttons (1.1, 1.2, 2.1, 2.2, etc.)
 * Organized in rows with 4 buttons each
 */
export function buildZoneKeyboard(): Array<Array<{ text: string; callback_data: string }>> {
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
