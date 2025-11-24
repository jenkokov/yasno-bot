/**
 * Schedule message formatting
 */

import type { ZoneData, DaySchedule } from '../types';
import { SCHEDULE_STATUS, SLOT_TYPE } from '../config/constants';

/**
 * Format complete schedule message for a zone
 */
export function formatScheduleMessage(zone: string, data: ZoneData, isUpdate = false): string {
	const header = isUpdate
		? `⚡️ *Розклад оновлено*\nГрупа: *${zone}*\n\n`
		: `⚡️ *Поточний розклад*\nГрупа: *${zone}*\n\n`;

	const footer = formatUpdateTimestamp(data.updatedOn);

	return header +
		formatDay(data.today, 'Сьогодні') +
		'\n' + formatDay(data.tomorrow, 'Завтра') +
		footer;
}

/**
 * Format a single day's schedule (today or tomorrow)
 */
function formatDay(dayData: DaySchedule, label: string): string {
	const dateObj = new Date(dayData.date);
	const dateStr = dateObj.toLocaleDateString('uk-UA', {
		timeZone: 'Europe/Kyiv',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		weekday: 'short'
	});

	// Status emoji based on schedule certainty
	const statusEmoji = dayData.status === SCHEDULE_STATUS.APPLIES ? '✅' : '⏳';

	let output = `📅 *${label}* (${dateStr}) ${statusEmoji}\n\n`;

	// Separate slots by type
	const outages = dayData.slots.filter(slot => slot.type === SLOT_TYPE.OUTAGE);
	const power = dayData.slots.filter(slot => slot.type === SLOT_TYPE.POWER);

	// Calculate total times
	const totalOutageMinutes = outages.reduce((sum, slot) => sum + (slot.end - slot.start), 0);
	const totalPowerMinutes = power.reduce((sum, slot) => sum + (slot.end - slot.start), 0);

	// Format outages section
	if (outages.length > 0) {
		output += `🔴 *Відключення* (${formatTotalTime(totalOutageMinutes)} всього):\n`;
		outages.forEach(slot => {
			const start = formatMinutes(slot.start);
			const end = formatMinutes(slot.end);
			const duration = getDuration(slot.start, slot.end);
			output += `  • ${start}–${end} (${duration})\n`;
		});
	} else {
		output += `🔴 *Відключення* (0г всього):\n  • Немає відключень\n`;
	}

	// Format power section
	output += `🟢 *Електропостачання* (${formatTotalTime(totalPowerMinutes)} всього):\n`;
	power.forEach(slot => {
		const start = formatMinutes(slot.start);
		const end = formatMinutes(slot.end);
		const duration = getDuration(slot.start, slot.end);
		output += `  • ${start}–${end} (${duration})\n`;
	});

	return output;
}

/**
 * Convert minutes since midnight to HH:MM format
 */
function formatMinutes(minutes: number): string {
	const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
	const mins = (minutes % 60).toString().padStart(2, '0');
	return `${hours}:${mins}`;
}

/**
 * Calculate and format duration between two time points
 */
function getDuration(startMinutes: number, endMinutes: number): string {
	const diffMinutes = endMinutes - startMinutes;
	const hours = Math.floor(diffMinutes / 60);
	const mins = diffMinutes % 60;
	return mins > 0 ? `${hours}г${mins}хв` : `${hours}г`;
}

/**
 * Format total minutes into hours and minute string
 */
function formatTotalTime(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours}г${minutes}хв` : `${hours}г`;
}

/**
 * Format the update timestamp footer
 */
function formatUpdateTimestamp(updatedOn?: string): string {
	if (!updatedOn) {
		return '';
	}

	const updatedDate = new Date(updatedOn);
	const updatedStr = updatedDate.toLocaleString('uk-UA', {
		timeZone: 'Europe/Kyiv',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	return `\n⏱ Оновлено: ${updatedStr}`;
}
