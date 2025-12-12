const MARKET_TIME_ZONE = "America/New_York";
const MARKET_OPEN_MINUTE = 9 * 60 + 30; // 09:30 ET
const MARKET_CLOSE_MINUTE = 16 * 60; // 16:00 ET
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

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
	const tradingDay = isTradingDay(parts.weekday);
	const isOpen = tradingDay && minutes >= MARKET_OPEN_MINUTE && minutes < MARKET_CLOSE_MINUTE;
	const minutesSinceOpen = isOpen ? minutes - MARKET_OPEN_MINUTE : 0;
	const minutesUntilClose = isOpen ? MARKET_CLOSE_MINUTE - minutes : 0;
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

export const getQuoteTtlMs = (date = new Date()) => {
	const session = getMarketSession(date);

	if (session.isOpen) {
		return FIFTEEN_MINUTES_MS;
	}

	return Math.max(session.msUntilNextOpen, FIFTEEN_MINUTES_MS);
};

const resolveNextOpenLocalDate = (
	parts: DateParts,
	minutes: number,
	tradingDay: boolean,
	isOpen: boolean
) => {
	if (tradingDay && !isOpen && minutes < MARKET_OPEN_MINUTE) {
		return {
			year: parts.year,
			month: parts.month,
			day: parts.day
		};
	}

	let dayOffset = isOpen || !tradingDay ? 1 : 0;
	let candidateWeekday = normalizeWeekday(parts.weekday + dayOffset);

	while (!isTradingDay(candidateWeekday)) {
		dayOffset += 1;
		candidateWeekday = normalizeWeekday(parts.weekday + dayOffset);
	}

	return addDays(parts, dayOffset);
};

const normalizeWeekday = (value: number) => {
	const normalized = value % 7;
	return normalized < 0 ? normalized + 7 : normalized;
};

const addDays = (parts: DateParts, offset: number) => {
	const anchor = Date.UTC(parts.year, parts.month - 1, parts.day + offset);
	const date = new Date(anchor);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate()
	};
};

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
