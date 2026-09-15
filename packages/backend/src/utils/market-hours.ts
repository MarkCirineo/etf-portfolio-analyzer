const MARKET_TIME_ZONE = "America/New_York";
const MARKET_OPEN_MINUTE = 9 * 60 + 30; // 09:30 ET
const MARKET_CLOSE_MINUTE = 16 * 60; // 16:00 ET
const EARLY_CLOSE_MINUTE = 13 * 60; // 13:00 ET (day after Thanksgiving, Christmas Eve)
const MAX_DAYS_TO_SCAN = 14;

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	timeZone: MARKET_TIME_ZONE,
	weekday: "short",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23"
});

type DateParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	weekday: number;
};

type CalendarDate = {
	year: number;
	month: number;
	day: number;
};

export type MarketSession = {
	isOpen: boolean;
	weekday: number;
	minutesSinceOpen: number;
	minutesUntilClose: number;
	nextOpen: Date;
	msUntilNextOpen: number;
};

export const isTradingDay = (weekday: number) => {
	return weekday >= 1 && weekday <= 5;
};

export const getMarketSession = (date = new Date()): MarketSession => {
	const parts = getEasternDateParts(date);
	const minutes = parts.hour * 60 + parts.minute;
	const tradingDay = isTradingDay(parts.weekday) && !isMarketHoliday(parts);
	const closeMinute = getCloseMinute(parts);
	const isOpen = tradingDay && minutes >= MARKET_OPEN_MINUTE && minutes < closeMinute;
	const minutesSinceOpen = isOpen ? minutes - MARKET_OPEN_MINUTE : 0;
	const minutesUntilClose = isOpen ? closeMinute - minutes : 0;
	const nextOpenLocalDate = resolveNextOpenLocalDate(parts, minutes, tradingDay, isOpen);
	const nextOpenUtc = toUtcFromEastern({
		...nextOpenLocalDate,
		hour: Math.floor(MARKET_OPEN_MINUTE / 60),
		minute: MARKET_OPEN_MINUTE % 60,
		second: 0
	});
	const msUntilNextOpen = Math.max(nextOpenUtc.getTime() - date.getTime(), 0);

	return {
		isOpen,
		weekday: parts.weekday,
		minutesSinceOpen,
		minutesUntilClose,
		nextOpen: nextOpenUtc,
		msUntilNextOpen
	};
};

/**
 * How long a quote fetched right now should be considered current. While the market is
 * open prices move, so refresh on an interval; once it closes nothing changes until the
 * next open, so a quote fetched after the close is good until then.
 */
export const getQuoteTtlMs = (openMarketTtlMs: number, date = new Date()) => {
	const session = getMarketSession(date);

	if (session.isOpen) {
		return openMarketTtlMs;
	}

	return Math.max(session.msUntilNextOpen, openMarketTtlMs);
};

const resolveNextOpenLocalDate = (
	parts: DateParts,
	minutes: number,
	tradingDay: boolean,
	isOpen: boolean
): CalendarDate => {
	if (tradingDay && !isOpen && minutes < MARKET_OPEN_MINUTE) {
		return {
			year: parts.year,
			month: parts.month,
			day: parts.day
		};
	}

	// Today is done (open now, already past the close, or not a trading day); walk forward
	// to the next weekday that is not a holiday.
	for (let offset = 1; offset <= MAX_DAYS_TO_SCAN; offset += 1) {
		const candidate = addDays(parts, offset);
		const weekday = normalizeWeekday(parts.weekday + offset);

		if (isTradingDay(weekday) && !isMarketHoliday(candidate)) {
			return candidate;
		}
	}

	return addDays(parts, 1);
};

const getCloseMinute = (parts: CalendarDate) => {
	return isEarlyCloseDay(parts) ? EARLY_CLOSE_MINUTE : MARKET_CLOSE_MINUTE;
};

const normalizeWeekday = (value: number) => {
	const normalized = value % 7;
	return normalized < 0 ? normalized + 7 : normalized;
};

const addDays = (parts: CalendarDate, offset: number): CalendarDate => {
	const anchor = Date.UTC(parts.year, parts.month - 1, parts.day + offset);
	const date = new Date(anchor);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate()
	};
};

// --- NYSE holiday calendar -------------------------------------------------------------
// Full-day closures follow fixed rules, so they are computed rather than maintained as a
// list. Unscheduled closures (days of mourning, weather) are not covered.

const holidayCache = new Map<number, Set<string>>();

const dateKey = ({ year, month, day }: CalendarDate) => `${year}-${month}-${day}`;

export const isMarketHoliday = (date: CalendarDate) => {
	return getHolidaysForYear(date.year).has(dateKey(date));
};

const isEarlyCloseDay = (date: CalendarDate) => {
	const thanksgiving = nthWeekdayOfMonth(date.year, 11, 4, 4);
	const dayAfterThanksgiving = addDays(thanksgiving, 1);

	if (dateKey(date) === dateKey(dayAfterThanksgiving)) {
		return true;
	}

	// Christmas Eve closes early when it falls on a weekday
	const christmasEve = { year: date.year, month: 12, day: 24 };
	return dateKey(date) === dateKey(christmasEve) && isTradingDay(weekdayOf(christmasEve));
};

const getHolidaysForYear = (year: number): Set<string> => {
	const cached = holidayCache.get(year);

	if (cached) {
		return cached;
	}

	const holidays: CalendarDate[] = [
		observedHoliday({ year, month: 1, day: 1 }, false), // New Year's Day
		nthWeekdayOfMonth(year, 1, 1, 3), // Martin Luther King Jr. Day
		nthWeekdayOfMonth(year, 2, 1, 3), // Presidents' Day
		addDays(easterSunday(year), -2), // Good Friday
		lastWeekdayOfMonth(year, 5, 1), // Memorial Day
		observedHoliday({ year, month: 6, day: 19 }, true), // Juneteenth
		observedHoliday({ year, month: 7, day: 4 }, true), // Independence Day
		nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day
		nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving
		observedHoliday({ year, month: 12, day: 25 }, true) // Christmas
	];

	// A New Year's Day on a Saturday is not observed on the Friday, but one on a Sunday is
	// observed on the Monday, which belongs to the following year's calendar.
	const nextNewYear = { year: year + 1, month: 1, day: 1 };
	if (weekdayOf(nextNewYear) === 0) {
		holidays.push(addDays(nextNewYear, 1));
	}

	const set = new Set(holidays.filter((holiday) => holiday.year === year).map(dateKey));
	holidayCache.set(year, set);

	return set;
};

/** Saturday holidays are observed on Friday (when allowed), Sunday holidays on Monday. */
const observedHoliday = (date: CalendarDate, observeSaturdayOnFriday: boolean): CalendarDate => {
	const weekday = weekdayOf(date);

	if (weekday === 6) {
		return observeSaturdayOnFriday ? addDays(date, -1) : date;
	}

	if (weekday === 0) {
		return addDays(date, 1);
	}

	return date;
};

const nthWeekdayOfMonth = (
	year: number,
	month: number,
	weekday: number,
	n: number
): CalendarDate => {
	const first = { year, month, day: 1 };
	const offset = normalizeWeekday(weekday - weekdayOf(first));
	return { year, month, day: 1 + offset + (n - 1) * 7 };
};

const lastWeekdayOfMonth = (year: number, month: number, weekday: number): CalendarDate => {
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const last = { year, month, day: lastDay };
	const offset = normalizeWeekday(weekdayOf(last) - weekday);
	return { year, month, day: lastDay - offset };
};

/** Anonymous Gregorian algorithm. */
const easterSunday = (year: number): CalendarDate => {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return { year, month, day };
};

const weekdayOf = ({ year, month, day }: CalendarDate) => {
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

// --- Eastern time conversion ------------------------------------------------------------

const getEasternDateParts = (date: Date): DateParts => {
	const parts = dateTimeFormatter.formatToParts(date);
	const lookup = new Map<string, string>();

	for (const part of parts) {
		if (part.type !== "literal") {
			lookup.set(part.type, part.value);
		}
	}

	const weekdayStr = lookup.get("weekday") ?? "Sun";

	return {
		year: Number(lookup.get("year")),
		month: Number(lookup.get("month")),
		day: Number(lookup.get("day")),
		hour: Number(lookup.get("hour")),
		minute: Number(lookup.get("minute")),
		second: Number(lookup.get("second")),
		weekday: weekdayToIndex(weekdayStr)
	};
};

const weekdayToIndex = (weekday: string) => {
	switch (weekday.toLowerCase()) {
		case "mon":
			return 1;
		case "tue":
			return 2;
		case "wed":
			return 3;
		case "thu":
			return 4;
		case "fri":
			return 5;
		case "sat":
			return 6;
		default:
			return 0;
	}
};

const toUtcFromEastern = (parts: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}): Date => {
	const utcGuess = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
	const guessDate = new Date(utcGuess);
	const offset = getTimezoneOffsetForDate(guessDate);
	return new Date(utcGuess - offset);
};

const getTimezoneOffsetForDate = (date: Date) => {
	const parts = dateTimeFormatter.formatToParts(date);
	const lookup = new Map<string, string>();

	for (const part of parts) {
		if (part.type !== "literal") {
			lookup.set(part.type, part.value);
		}
	}

	const asUtc = Date.UTC(
		Number(lookup.get("year")),
		Number(lookup.get("month")) - 1,
		Number(lookup.get("day")),
		Number(lookup.get("hour")),
		Number(lookup.get("minute")),
		Number(lookup.get("second"))
	);

	return asUtc - date.getTime();
};
