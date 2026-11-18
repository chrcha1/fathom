// The journal: one canvas per calendar day, kept in the browser.
//
// A day is named by its local date ("2026-11-11"), because "today" means the
// reader's own day. Every timestamp inside is stored in UTC and only turned
// into local time for display. Pure: nothing here touches storage itself.

import { LENSES } from './classify.js';
import { isValidForest } from './tree.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

// The local calendar day an instant falls on.
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isDayKey(key) {
  const match = typeof key === 'string' && DAY_KEY.exec(key);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// "today", "nov 10", or "nov 10, 2025" once the year is no longer this one.
export function dayLabel(key, todayKey) {
  if (key === todayKey) return 'today';
  const [, year, month, day] = DAY_KEY.exec(key);
  const label = `${MONTHS[Number(month) - 1]} ${Number(day)}`;
  return year === todayKey.slice(0, 4) ? label : `${label}, ${year}`;
}

export const emptyStore = () => ({ lens: 'anything', days: {} });

// Reads saved data back, keeping every day that is intact. Returns the store
// and a list of what had to be left out ("unreadable", or the day keys).
export function readStore(raw) {
  const store = emptyStore();
  if (raw == null) return { store, problems: [] };
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { store, problems: ['unreadable'] };
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { store, problems: ['unreadable'] };
  if (LENSES.includes(saved.lens)) store.lens = saved.lens;

  const problems = [];
  const days = saved.days && typeof saved.days === 'object' && !Array.isArray(saved.days) ? saved.days : null;
  if (!days) return { store, problems: 'days' in saved ? ['days'] : [] };
  for (const [key, day] of Object.entries(days)) {
    const intact = isDayKey(key) && day && typeof day === 'object' && isValidForest(day.forest);
    if (!intact) {
      problems.push(key);
      continue;
    }
    const updatedAt = typeof day.updatedAt === 'string' && !Number.isNaN(Date.parse(day.updatedAt)) ? day.updatedAt : null;
    store.days[key] = { forest: day.forest, updatedAt };
  }
  return { store, problems };
}

// The days that can be visited, oldest first: every saved day, today, and
// the day on screen (which may not have anything saved yet).
export function visitableDays(store, todayKey, viewing = todayKey) {
  return [...new Set([...Object.keys(store.days), todayKey, viewing])].sort();
}

// The day before and after `key` among the visitable ones (null at the ends).
export function neighbours(store, key, todayKey) {
  const days = visitableDays(store, todayKey, key);
  const at = days.indexOf(key);
  return { earlier: days[at - 1] ?? null, later: days[at + 1] ?? null };
}
