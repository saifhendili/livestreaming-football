import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';

export const DAY_PATHS = {
  yesterday: '/matches-yesterday/',
  today: '/matches-today/',
  tomorrow: '/matches-tomorrow/',
};
export const DAY_OFFSETS = { yesterday: -1, today: 0, tomorrow: 1 };

const STATUS_BY_CLASS = { live: 'live', finished: 'finished', 'not-started': 'upcoming' };
const UNKNOWN = 'غير معروف'; // the source's placeholder for "unknown"

const clean = (text) => text.replace(/\s+/g, ' ').trim();
const orNull = (text) => {
  const value = clean(text || '');
  return value && value !== UNKNOWN ? value : null;
};

export function dateForDay(day, timezone, now = DateTime.now()) {
  return now.setZone(timezone).plus({ days: DAY_OFFSETS[day] }).toISODate();
}

export function matchKey(date, homeName, awayName) {
  return crypto.createHash('sha1').update(`${date}|${homeName}|${awayName}`).digest('hex').slice(0, 16);
}

/**
 * Turn a day listing page into normalised match objects.
 * Pure function: no network, no database.
 */
export function parseListing(html, { baseUrl, date, timezone }) {
  const $ = cheerio.load(html);
  const matches = [];

  $('.AY_Match').each((_, el) => {
    const card = $(el);

    const teams = card
      .find('.MT_Team')
      .map((__, t) => {
        const team = $(t);
        const img = team.find('img').first();
        const logo = img.attr('data-src') || img.attr('src');
        return {
          name: clean(team.find('.TM_Name').text()),
          logo: logo && !logo.startsWith('data:') ? new URL(logo, baseUrl).href : null,
        };
      })
      .get();
    const href = card.children('a').first().attr('href');
    if (teams.length < 2 || !teams[0].name || !teams[1].name || !href) return;

    const status = classStatus(card.attr('class'), clean(card.find('.MT_Stat').text()));
    const time = clean(card.find('.MT_Time').text()) || null;
    const goals = card
      .find('.MT_Result .RS-goals')
      .map((__, g) => Number.parseInt($(g).text(), 10))
      .get();
    const [channel, commentator, league] = card
      .find('.MT_Info li span')
      .map((__, s) => $(s).text())
      .get();
    // "Europe, Champions League" -> region + competition
    const [region, ...rest] = (orNull(league) || '').split(',').map((part) => part.trim());
    const competition = rest.join(', ') || null;

    const sourceUrl = new URL(href, baseUrl).href;
    const startsAt = time
      ? DateTime.fromFormat(`${date} ${time}`, 'yyyy-MM-dd HH:mm', { zone: timezone })
      : null;

    matches.push({
      key: matchKey(date, teams[0].name, teams[1].name),
      date,
      home: teams[0],
      away: teams[1],
      time,
      startsAt: startsAt?.isValid ? startsAt.toUTC().toJSDate() : null,
      status,
      score:
        status === 'upcoming' || goals.length < 2
          ? { home: null, away: null }
          : { home: goals[0], away: goals[1] },
      channel: orNull(channel),
      commentator: orNull(commentator),
      region: region || null,
      competition,
      sourceUrl,
      sourceType: new URL(sourceUrl).pathname.includes('/albaplayer/') ? 'player' : 'page',
    });
  });

  return matches;
}

function classStatus(classAttr = '', statText = '') {
  for (const [cls, status] of Object.entries(STATUS_BY_CLASS)) {
    if (classAttr.split(/\s+/).includes(cls)) return status;
  }
  // Class names changed? Fall back to the Arabic label.
  if (statText.includes('جارية')) return 'live';
  if (statText.includes('انتهت')) return 'finished';
  return 'upcoming';
}
