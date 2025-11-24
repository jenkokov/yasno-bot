/**
 * Schedule change detection logic
 */

import type { YasnoResponse, ZoneData, DaySchedule } from '../types';

/**
 * Detect which zones have changed by comparing fresh and cached data
 */
export function detectChangedZones(freshData: YasnoResponse, cachedData: YasnoResponse): string[] {
	const changedZones: string[] = [];
	const zones = Object.keys(freshData);

	for (const zone of zones) {
		const freshZone = freshData[zone];
		const cachedZone = cachedData[zone];

		if (hasZoneChanged(freshZone, cachedZone)) {
			changedZones.push(zone);
			// Log detailed change information
			console.log(getChangeDetails(zone, freshZone, cachedZone));
		}
	}

	return changedZones;
}

/**
 * Check if a zone's schedule has changed
 * Only compares meaningful data: slots and status (ignores dates and timestamps)
 */
function hasZoneChanged(freshZone: ZoneData, cachedZone?: ZoneData): boolean {
	if (!cachedZone) {
		return true; // First time seeing this zone
	}

	// Compare today's schedule data
	const todayChanged = !compareScheduleData(freshZone.today, cachedZone.today);

	// Compare tomorrow's schedule data
	const tomorrowChanged = !compareScheduleData(freshZone.tomorrow, cachedZone.tomorrow);

	return todayChanged || tomorrowChanged;
}

/**
 * Compare only the meaningful schedule data (slots and status)
 * Ignores date and timestamp fields
 */
function compareScheduleData(day1: DaySchedule, day2: DaySchedule): boolean {
	// Compare status
	if (day1.status !== day2.status) {
		return false; // Different
	}

	// Compare slots array
	if (day1.slots.length !== day2.slots.length) {
		return false; // Different number of slots
	}

	// Compare each slot
	for (let i = 0; i < day1.slots.length; i++) {
		const slot1 = day1.slots[i];
		const slot2 = day2.slots[i];

		if (slot1.start !== slot2.start || slot1.end !== slot2.end || slot1.type !== slot2.type) {
			return false; // Slot differs
		}
	}

	return true; // Same
}

/**
 * Get detailed information about what changed in a zone
 */
function getChangeDetails(zone: string, freshZone: ZoneData, cachedZone?: ZoneData): string {
	if (!cachedZone) {
		return `${zone}: First time seeing this zone`;
	}

	const details: string[] = [];

	// Check today
	if (!compareScheduleData(freshZone.today, cachedZone.today)) {
		if (freshZone.today.status !== cachedZone.today.status) {
			details.push(`today status: ${cachedZone.today.status} → ${freshZone.today.status}`);
		}
		if (freshZone.today.slots.length !== cachedZone.today.slots.length) {
			details.push(`today slots count: ${cachedZone.today.slots.length} → ${freshZone.today.slots.length}`);
		} else {
			details.push('today slots changed');
		}
	}

	// Check tomorrow
	if (!compareScheduleData(freshZone.tomorrow, cachedZone.tomorrow)) {
		if (freshZone.tomorrow.status !== cachedZone.tomorrow.status) {
			details.push(`tomorrow status: ${cachedZone.tomorrow.status} → ${freshZone.tomorrow.status}`);
		}
		if (freshZone.tomorrow.slots.length !== cachedZone.tomorrow.slots.length) {
			details.push(`tomorrow slots count: ${cachedZone.tomorrow.slots.length} → ${freshZone.tomorrow.slots.length}`);
		} else {
			details.push('tomorrow slots changed');
		}
	}

	// Check if updatedOn changed (for reference)
	if (freshZone.updatedOn !== cachedZone.updatedOn) {
		details.push(`updatedOn: ${cachedZone.updatedOn || 'null'} → ${freshZone.updatedOn || 'null'}`);
	}

	return `${zone}: ${details.join(', ')}`;
}
