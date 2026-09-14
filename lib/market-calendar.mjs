const MARKET_CONFIG = {
  IN: {
    timeZone: "Asia/Kolkata",
    openMinutes: 9 * 60 + 15,
    closeMinutes: 15 * 60 + 30,
    holidays: new Set([
      // NSE/BSE equity-market holidays published for calendar year 2026.
      "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26",
      "2026-03-31", "2026-04-03", "2026-04-14", "2026-05-01",
      "2026-05-28", "2026-06-26", "2026-09-14", "2026-10-02",
      "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25",
    ]),
  },
  US: {
    timeZone: "America/New_York",
    openMinutes: 9 * 60 + 30,
    closeMinutes: 16 * 60,
    holidays: new Set([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
      "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
      "2026-11-26", "2026-12-25",
      "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
      "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06",
      "2027-11-25", "2027-12-24",
      "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29",
      "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23",
      "2028-12-25",
    ]),
  },
};

const NSE_HOLIDAY_URL = "https://www.nseindia.com/api/holiday-master?type=trading";
const MONTHS = new Map([
  ["Jan", "01"], ["Feb", "02"], ["Mar", "03"], ["Apr", "04"],
  ["May", "05"], ["Jun", "06"], ["Jul", "07"], ["Aug", "08"],
  ["Sep", "09"], ["Oct", "10"], ["Nov", "11"], ["Dec", "12"],
]);
let nseCalendarRefreshPromise = null;
let nseCalendarLastAttempt = 0;
let nseCalendarLastRefreshSucceeded = false;

function normalizeNseDate(value) {
  const [day, month, year] = String(value).split("-");
  const monthNumber = MONTHS.get(month);
  return day && monthNumber && /^\d{4}$/.test(year)
    ? `${year}-${monthNumber}-${day.padStart(2, "0")}`
    : null;
}

export async function refreshMarketHolidays(market = "IN", force = false) {
  if (market !== "IN") return false;
  const now = Date.now();
  if (!force && now - nseCalendarLastAttempt < 6 * 60 * 60 * 1000) {
    return nseCalendarLastRefreshSucceeded;
  }
  if (nseCalendarRefreshPromise) return nseCalendarRefreshPromise;
  nseCalendarLastAttempt = now;
  nseCalendarRefreshPromise = (async () => {
    try {
      const response = await fetch(NSE_HOLIDAY_URL, {
        headers: {
          accept: "application/json",
          "user-agent": "InvestoGenie/1.0 market-calendar",
        },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return false;
      const payload = await response.json();
      const holidays = Array.isArray(payload?.CM) ? payload.CM : [];
      let added = 0;
      for (const holiday of holidays) {
        const normalized = normalizeNseDate(holiday?.tradingDate);
        if (normalized) {
          MARKET_CONFIG.IN.holidays.add(normalized);
          added += 1;
        }
      }
      nseCalendarLastRefreshSucceeded = added > 0;
      return nseCalendarLastRefreshSucceeded;
    } catch {
      nseCalendarLastRefreshSucceeded = false;
      return false;
    }
  })().finally(() => {
    nseCalendarRefreshPromise = null;
  });
  return nseCalendarRefreshPromise;
}

function configFor(market) {
  const config = MARKET_CONFIG[market];
  if (!config) throw new Error(`Unsupported market: ${market}`);
  return config;
}

export function zonedMarketClock(market, at = new Date()) {
  const config = configFor(market);
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at).map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday),
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isTradingDay(market, dateIso) {
  const config = configFor(market);
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !config.holidays.has(dateIso);
}

export function previousTradingDay(market, dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (!isTradingDay(market, date.toISOString().slice(0, 10)));
  return date.toISOString().slice(0, 10);
}

export function latestExpectedSessionDate(market, at = new Date(), publicationMinutes) {
  const config = configFor(market);
  const clock = zonedMarketClock(market, at);
  const cutoff = publicationMinutes ?? config.closeMinutes;
  if (isTradingDay(market, clock.date) && clock.minutes >= cutoff) return clock.date;
  return previousTradingDay(market, clock.date);
}

export function tradingSessionLag(market, observedDate, expectedDate) {
  if (!observedDate || !expectedDate || observedDate >= expectedDate) return 0;
  const cursor = new Date(`${observedDate}T00:00:00Z`);
  let lag = 0;
  while (cursor.toISOString().slice(0, 10) < expectedDate && lag < 5000) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isTradingDay(market, cursor.toISOString().slice(0, 10))) lag += 1;
  }
  return lag;
}

export function isMarketOpenNow(market, at = new Date()) {
  const config = configFor(market);
  const clock = zonedMarketClock(market, at);
  return isTradingDay(market, clock.date)
    && clock.minutes >= config.openMinutes
    && clock.minutes <= config.closeMinutes;
}

export function isMarketHoliday(market, at = new Date()) {
  const clock = zonedMarketClock(market, at);
  const date = new Date(`${clock.date}T00:00:00Z`);
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !isTradingDay(market, clock.date);
}
