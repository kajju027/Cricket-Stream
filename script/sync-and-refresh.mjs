#!/usr/bin/env node
/**
 * =============================================================================
 *  sync-and-refresh.mjs
 * =============================================================================
 *  Pure static-file updater. No Cloudflare Pages Functions, no server, no
 *  edge runtime — this script just rewrites plain .html files that are
 *  already sitting in the repo. The workflow then commits + pushes whatever
 *  changed. Cloudflare Pages serves the result exactly like any other
 *  static file, no different from editing the HTML by hand.
 *
 *  Runs twice a day (see the workflow's cron). Every run checks ALL pages —
 *  the homepage and every channel folder — together, in this one process.
 * =============================================================================
 *  WHAT GETS UPDATED, PER PAGE
 * =============================================================================
 *  <title>, meta description, meta keywords, og:title, og:description,
 *  og:image, twitter:title, twitter:description, twitter:image.
 *
 *  Left alone on purpose (so the rest of the site keeps working exactly as
 *  before):
 *    - canonical / og:url: always kept pointed at that page's own real URL.
 *    - The JSON-LD WebSite/Organization block: this describes the whole
 *      site as one entity, not the individual page, so it's meant to be
 *      identical on every page — that's normal schema.org practice, not a
 *      duplicate-content problem, so it's never touched.
 *    - Every script, style, iframe, and id in the page — this script only
 *      ever edits <head> meta tags via targeted find-and-replace; nothing
 *      else in the file is touched.
 * =============================================================================
 *  WHERE EACH PAGE'S CONTENT COMES FROM (two sources, in priority order)
 * =============================================================================
 *  1. LIVE DATA (preferred): this channel's entry in the live iframes JSON
 *     that the site already fetches at runtime. If present, its "name"
 *     becomes the title/description, and its "logourl" (if set) becomes
 *     the og:image/twitter:image. THIS is what makes a shared link like
 *     https://matchdekho.pages.dev/Willow/ show the right channel name and
 *     picture in a WhatsApp/Telegram preview, instead of the generic
 *     default. If logourl is empty, the existing default image
 *     (gop-gop-moww.png) is simply left as-is.
 *  2. FALLBACK TEMPLATE (only when a channel has no live entry right now,
 *     i.e. it's idle): a date-seeded template pool, so an idle page still
 *     reads "fresh" instead of being stuck on one static line forever —
 *     this is the SEO-freshness rotation.
 *
 *  Only a file whose computed content is actually DIFFERENT from what's
 *  already on disk gets rewritten (see the `out !== html` check below) — an
 *  idle channel whose fallback template hasn't rolled over yet, or a live
 *  channel whose name/logo hasn't changed, is left completely alone and
 *  logged as [unchanged]. Only real changes get written, and the workflow
 *  then commits every changed file together in a single commit.
 * =============================================================================
 *  KNOWN LIMITATION OF STAYING 100% STATIC (no server functions)
 * =============================================================================
 *  This can only fix pages that have their own real file/URL (Hindi/,
 *  English/, Willow/, ...). A link like https://matchdekho.pages.dev/?English
 *  (query-string routing off the homepage) is still the SAME homepage file
 *  for every channel, so a crawler hitting that exact URL keeps seeing the
 *  generic homepage preview — two different static previews for the same
 *  URL isn't possible without a server. Share the folder links
 *  (/Willow/, /Hindi/, ...) instead — those already get the accurate,
 *  live-synced preview from this script.
 * =============================================================================
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const SITE_ORIGIN = 'https://matchdekho.pages.dev';
const PRIMARY_JSON = 'https://sonujson-v5.pages.dev/loura.json';

const CHANNELS = [
  'Hindi', 'English', 'Tamil', 'Telugu', 'Willow',
  'Cricbuzz', 'FC', 'IOS', 'Exp1', 'All',
];

// -----------------------------------------------------------------------------
// Fallback templates — used ONLY when a channel has no live entry right now.
// {label} is swapped for the channel name, {year} for the current year.
// -----------------------------------------------------------------------------
const TITLE_TEMPLATES = [
  'CRICKET NEWS POINT — {label} Live Cricket & IPL {year} | CnpTVOfficial',
  '{label} Live Cricket Streaming Free — Cricket News Point {year}',
  'Watch {label} Live: Cricket & IPL Streams | CnpTVOfficial',
  '{label} Live Match Streaming — CRICKET NEWS POINT {year}',
  'Live {label} Cricket & IPL Coverage | CnpTVOfficial',
  '{label} 24x7 Live Cricket Stream — Cricket News Point',
  'CRICKET NEWS POINT: {label} Live Streaming & Scores {year}',
  '{label} Live Cricket, IPL & Score Updates | CnpTVOfficial',
  'Free {label} Live Cricket Streaming — CnpTVOfficial {year}',
  '{label} Live — Cricket News Point Streaming Hub',
];
const DESC_TEMPLATES = [
  'Watch {label} live streaming free on Cricket News Point. Live IPL, cricket scores & instant match alerts — join our WhatsApp channel.',
  'Stream {label} live cricket & IPL matches for free. Get real-time scores and updates from Cricket News Point / CnpTVOfficial.',
  '{label} live cricket streaming, IPL coverage and instant score alerts — all free on Cricket News Point.',
  'Catch every {label} match live — IPL, international cricket & scores, streamed free by CnpTVOfficial.',
  'Live {label} cricket streaming with real-time scores and match alerts. Join CnpTVOfficial on WhatsApp & Telegram.',
];
const HOME_TITLE_TEMPLATES = [
  'CRICKET NEWS POINT — Live Cricket, IPL & Match Streaming {year}',
  'Watch Live Cricket & IPL Free — Cricket News Point {year}',
  'CnpTVOfficial — All Cricket Live Streams In One Place',
  'Live Cricket Scores, IPL & Streaming — Cricket News Point',
  'Cricket News Point — Every Live Match, One Link',
];
const HOME_DESC_TEMPLATES = [
  'Watch live IPL & cricket streams, get live scores & exclusive sports updates. Join our WhatsApp channel for instant alerts.',
  'All your live cricket in one place — IPL, international matches, live scores and instant alerts from CnpTVOfficial.',
  'Free live cricket and IPL streaming with real-time scores. Join Cricket News Point on WhatsApp for instant updates.',
];

// -----------------------------------------------------------------------------
// Keywords: the base list is exactly what's already in every page today, so
// the core brand keywords are never lost — this only extends it with a
// channel name and a couple of date-seeded phrases, so pages don't all
// carry the byte-for-byte identical keywords line.
// -----------------------------------------------------------------------------
const BASE_KEYWORDS =
  'cricket news, IPL live stream, live cricket streaming, IPL live score, international cricket, ' +
  'Cricket News Point, CnpTVOfficial, cricket highlights, live match, watch IPL free, T20 world cup live, live score updates';

const EXTRA_KEYWORD_POOL = [
  'live match today', 'free cricket streaming', 'ipl live updates today',
  'cricket highlights today', 'live score update', 'watch cricket online free',
  'today match live streaming', 'live tv cricket', 'cricket streaming site', 'sports live stream free',
];

function buildKeywords(label, isHome) {
  const e1 = EXTRA_KEYWORD_POOL[dayIndex(EXTRA_KEYWORD_POOL.length, 'kw1' + label)];
  const e2 = EXTRA_KEYWORD_POOL[dayIndex(EXTRA_KEYWORD_POOL.length, 'kw2' + label)];
  const channelPart = isHome ? '' : `, ${label.toLowerCase()} live cricket, ${label.toLowerCase()} cricket stream`;
  return `${BASE_KEYWORDS}${channelPart}, ${e1}, ${e2}`;
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

// Deterministic "pick an index for today" — same channel + same calendar day
// always gives the same index (so re-running mid-day is a no-op), but a
// different channel or the next day gives a different one.
function dayIndex(len, salt = '') {
  const days = Math.floor(Date.now() / 86400000);
  let hash = 0;
  for (const ch of salt) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (days + Math.abs(hash)) % len;
}

function fill(template, label, year) {
  return template.replaceAll('{label}', label).replaceAll('{year}', String(year));
}

// Only touches the file if the target pattern actually exists, so a page
// with slightly different markup is safely left untouched for that one tag
// instead of throwing.
function replaceOne(html, regex, replacement) {
  return regex.test(html) ? html.replace(regex, replacement) : html;
}

// -----------------------------------------------------------------------------
// Live data: the exact same JSON the front-end already fetches at runtime.
// Any failure here (network down, bad JSON, source moved) is swallowed and
// simply means every channel falls back to its template for this run —
// the workflow must never fail just because an external site is slow/down.
// -----------------------------------------------------------------------------
async function fetchLiveList() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${PRIMARY_JSON}?nc=${Date.now()}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return (data && data.iframes) || [];
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
// Applies one computed set of {title, desc, image, keywords, pageUrl} onto an
// HTML string. Pure string in, string out — makes this trivial to unit-test.
// -----------------------------------------------------------------------------
function applyTags(html, { title, desc, image, pageUrl, keywords }) {
  let out = html;
  out = replaceOne(out, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  out = replaceOne(out, /(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${desc}$2`);
  if (keywords) {
    out = replaceOne(out, /(<meta\s+name="keywords"\s+content=")[^"]*(")/, `$1${keywords}$2`);
  }
  out = replaceOne(out, /(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${title}$2`);
  out = replaceOne(out, /(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${desc}$2`);
  out = replaceOne(out, /(<meta\s+property="og:url"\s+content=")[^"]*(")/, `$1${pageUrl}$2`);
  out = replaceOne(out, /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${title}$2`);
  out = replaceOne(out, /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, `$1${desc}$2`);
  if (image) {
    out = replaceOne(out, /(<meta\s+property="og:image"\s+content=")[^"]*(")/, `$1${image}$2`);
    out = replaceOne(out, /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/, `$1${image}$2`);
  }
  return out;
}

// -----------------------------------------------------------------------------
// One channel folder (e.g. Hindi/index.html).
// -----------------------------------------------------------------------------
async function updateChannel(label, liveList) {
  const file = path.join(process.cwd(), label, 'index.html');
  let html;
  try {
    html = await fs.readFile(file, 'utf8');
  } catch {
    console.warn(`[skip] ${file} not found`);
    return;
  }

  const year = new Date().getUTCFullYear();
  const pageUrl = `${SITE_ORIGIN}/${label}/`;
  const liveItem = liveList.find((x) => String(x.id) === String(label)) || null;

  let title, desc, image;

  if (liveItem && liveItem.name) {
    // Live data wins: real channel/event name + its own logo (if it has one).
    title = `${liveItem.name} — CRICKET NEWS POINT`;
    desc = `Watch ${liveItem.name} live free on Cricket News Point. Live scores, IPL updates & instant match alerts.`;
    image = liveItem.logourl && liveItem.logourl.trim() ? liveItem.logourl.trim() : null;
  } else {
    // No live entry right now -> date-seeded fallback, so the page still
    // reads fresh instead of being stuck forever on one static line.
    title = fill(TITLE_TEMPLATES[dayIndex(TITLE_TEMPLATES.length, label + 'title')], label, year);
    desc = fill(DESC_TEMPLATES[dayIndex(DESC_TEMPLATES.length, label + 'desc')], label, year);
    image = null; // leave whatever default image is already in the file
  }

  const keywords = buildKeywords(label, false);
  const out = applyTags(html, { title, desc, image, pageUrl, keywords });

  // The whole "only touch what actually changed" guarantee lives right here:
  if (out !== html) {
    await fs.writeFile(file, out, 'utf8');
    console.log(`[updated] ${label} -> ${title}${image ? ' (custom image)' : ''}`);
  } else {
    console.log(`[unchanged] ${label}`);
  }
}

// -----------------------------------------------------------------------------
// The homepage. Not tied to one channel id, so it only ever uses the
// date-seeded HOME templates — never the live JSON.
// -----------------------------------------------------------------------------
async function updateHome() {
  const file = path.join(process.cwd(), 'index.html');
  let html;
  try {
    html = await fs.readFile(file, 'utf8');
  } catch {
    console.warn(`[skip] ${file} not found`);
    return;
  }

  const year = new Date().getUTCFullYear();
  const title = fill(HOME_TITLE_TEMPLATES[dayIndex(HOME_TITLE_TEMPLATES.length, 'hometitle')], '', year);
  const desc = fill(HOME_DESC_TEMPLATES[dayIndex(HOME_DESC_TEMPLATES.length, 'homedesc')], '', year);
  const keywords = buildKeywords('', true);
  const out = applyTags(html, { title, desc, image: null, pageUrl: `${SITE_ORIGIN}/`, keywords });

  if (out !== html) {
    await fs.writeFile(file, out, 'utf8');
    console.log(`[updated] (home) -> ${title}`);
  } else {
    console.log('[unchanged] (home)');
  }
}

async function main() {
  const liveList = await fetchLiveList();
  await updateHome();
  await Promise.all(CHANNELS.map((label) => updateChannel(label, liveList)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1); // a real crash should fail the Action loudly, not silently
});
