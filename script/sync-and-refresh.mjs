#!/usr/bin/env node
/**
 * sync-and-refresh.mjs
 * ----------------------------------------------------------------------
 * Pure static-file updater — no Cloudflare Pages Functions, no server,
 * no edge runtime. This script just rewrites the plain .html files that
 * are already sitting in the repo, then the workflow commits + pushes
 * them. Cloudflare Pages serves them exactly like any other static file.
 *
 * For each page — the homepage AND every channel (Hindi/, English/,
 * Willow/, ...) — this touches EVERY tag that's safe to vary: <title>,
 * meta description, meta keywords, og:title/description/image,
 * twitter:title/description/image. (Things left alone on purpose:
 * canonical/og:url stay pointed at that page's own real URL, and the
 * site-wide JSON-LD WebSite/Organization block is left as-is since it
 * describes the whole site as one entity, not the individual page —
 * schema.org repeating that block identically on every page is normal
 * and is not a duplicate-content problem.)
 *
 *   1. Try to find that channel's entry in the LIVE iframes JSON
 *      (the same one the front-end already fetches at runtime).
 *      -> If found: bake that entry's "name" into the title/description,
 *         and its "logourl" into the og:image/twitter:image — THIS is
 *         what makes a shared https://matchdekho.pages.dev/Willow/ link
 *         preview show the right channel name + picture on
 *         WhatsApp/Telegram/Facebook, instead of the generic default.
 *      -> If a channel has no logourl right now, its existing default
 *         image (gop-gop-moww.png) is simply left untouched.
 *   2. If NO live entry exists for that channel right now (it's idle),
 *      fall back to a date-seeded template pool instead, so the page
 *      still gets a fresh (but same-all-day) title/description/keywords
 *      — this is the daily SEO-freshness rotation.
 *
 * Runs once a day. Because social-preview crawlers (WhatsApp/Telegram/
 * etc.) don't run JavaScript, they only ever see whatever this script
 * last baked in — so a channel's preview picture/name is only as fresh
 * as the last daily run, which is the trade-off of not using a server
 * function.
 *
 * Known limitation of going static-only: this can only fix pages that
 * have their own real file/URL (Hindi/, English/, Willow/, ...). A link
 * like https://matchdekho.pages.dev/?English (query-string routing off
 * the homepage) is still the SAME homepage file for every channel, so a
 * crawler hitting that exact URL will keep seeing the generic homepage
 * preview — there is no way to give two different static previews for
 * the same file/URL without a server. If that matters to you, the folder
 * links (/Willow/, /Hindi/, ...) are the ones to share instead — those
 * already get the accurate preview from this script.
 * ----------------------------------------------------------------------
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const SITE_ORIGIN = 'https://matchdekho.pages.dev';
const PRIMARY_JSON = 'https://sonujson-v5.pages.dev/loura.json';

const CHANNELS = [
  'Hindi', 'English', 'Tamil', 'Telugu', 'Willow',
  'Cricbuzz', 'FC', 'IOS', 'Exp1', 'All',
];

// ---- fallback templates, used only when a channel has no live entry ----
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

// The base list is the same one already in every page today — kept as-is
// so the core brand keywords are never lost, only extended.
const BASE_KEYWORDS =
  'cricket news, IPL live stream, live cricket streaming, IPL live score, international cricket, ' +
  'Cricket News Point, CnpTVOfficial, cricket highlights, live match, watch IPL free, T20 world cup live, live score updates';

// Small pool of extra phrases so the keywords line isn't byte-identical
// on every single page/day (this was one of the "everything should look
// duplicate" issues) — rotates the same date-seeded way as titles.
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

function dayIndex(len, salt = '') {
  const days = Math.floor(Date.now() / 86400000);
  let h = 0;
  for (const c of salt) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (days + Math.abs(h)) % len;
}
function fill(tpl, label, year) {
  return tpl.replaceAll('{label}', label).replaceAll('{year}', String(year));
}
function replaceOne(html, regex, replacement) {
  return regex.test(html) ? html.replace(regex, replacement) : html;
}

async function fetchLiveList() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(PRIMARY_JSON + '?nc=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return (data && data.iframes) || [];
  } catch {
    return []; // source unreachable this run -> every channel just falls back to templates below
  }
}

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
    // Live data wins: real channel/event name + its own logo (if any).
    title = `${liveItem.name} — CRICKET NEWS POINT`;
    desc = `Watch ${liveItem.name} live free on Cricket News Point. Live scores, IPL updates & instant match alerts.`;
    image = liveItem.logourl && liveItem.logourl.trim() ? liveItem.logourl.trim() : null;
  } else {
    // No live entry right now -> date-seeded fallback so the page still
    // reads fresh instead of being stuck forever on one static line.
    const baseTitle = fill(TITLE_TEMPLATES[dayIndex(TITLE_TEMPLATES.length, label + 'title')], label, year);
    const baseDesc = fill(DESC_TEMPLATES[dayIndex(DESC_TEMPLATES.length, label + 'desc')], label, year);
    title = baseTitle;
    desc = baseDesc;
    image = null; // leave whatever default image is already in the file
  }

  const keywords = buildKeywords(label, false);
  const out = applyTags(html, { title, desc, image, pageUrl, keywords });
  if (out !== html) {
    await fs.writeFile(file, out, 'utf8');
    console.log(`[updated] ${label} -> ${title}${image ? ' (custom image)' : ''}`);
  } else {
    console.log(`[unchanged] ${label}`);
  }
}

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
  process.exit(1);
});
