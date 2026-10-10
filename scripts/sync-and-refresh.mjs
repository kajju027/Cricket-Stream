import fs from 'node:fs/promises';
import path from 'node:path';

const SITE_ORIGIN = 'https://matchdekho.pages.dev';
const PRIMARY_JSON = 'https://sonujson-v5.pages.dev/loura.json';
const HOME_IMAGE_SOURCE_ID = 'All';

const CHANNELS = [
  'Hindi', 'English', 'Tamil', 'Telugu', 'Willow',
  'Cricbuzz', 'FC', 'IOS', 'Exp1', 'All',
];

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
  'CRICKET NEWS POINT : MAIN 2026 — Live Cricket, Match Updates & Scores | Cricket News Point {year}',
  'CRICKET NEWS POINT  : MAIN — Asian Games Cricket, Live Score & Match Updates | CNP TV Official',
  'CRICKET NEWS POINT : MAIN — Live Cricket Score, Match Updates & Streaming | Cricket News Point',
  'CRICKET NEWS POINT : MAIN — Live Score, Match Updates & Cricket News | CNP TV Official',
  'CRICKET NEWS POINT : MAIN Live Score & Latest Match Updates | Cricket News Point',
];

const HOME_DESC_TEMPLATES = [
  'Watch live IPL & cricket streams, get live scores & exclusive sports updates. Join our WhatsApp channel for instant alerts.',
  'All your live cricket in one place — IPL, international matches, live scores and instant alerts from CnpTVOfficial.',
  'Free live cricket and IPL streaming with real-time scores. Join Cricket News Point on WhatsApp for instant updates.',
];

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

function dayIndex(len, salt = '') {
  const days = Math.floor(Date.now() / 86400000);
  let hash = 0;
  for (const ch of salt) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (days + Math.abs(hash)) % len;
}

function fill(template, label, year) {
  return template.replaceAll('{label}', label).replaceAll('{year}', String(year));
}

function replaceOne(html, regex, replacement) {
  return regex.test(html) ? html.replace(regex, replacement) : html;
}

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
    title = `${liveItem.name} — CRICKET NEWS POINT`;
    desc = `Watch ${liveItem.name} live free on Cricket News Point. Live scores, IPL updates & instant match alerts.`;
    image = liveItem.logourl && liveItem.logourl.trim() ? liveItem.logourl.trim() : null;
  } else {
    title = fill(TITLE_TEMPLATES[dayIndex(TITLE_TEMPLATES.length, label + 'title')], label, year);
    desc = fill(DESC_TEMPLATES[dayIndex(DESC_TEMPLATES.length, label + 'desc')], label, year);
    image = null;
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

async function updateHome(liveList) {
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

  const featured = liveList.find((x) => String(x.id) === HOME_IMAGE_SOURCE_ID) || null;
  const image = featured && featured.logourl && featured.logourl.trim() ? featured.logourl.trim() : null;

  const out = applyTags(html, { title, desc, image, pageUrl: `${SITE_ORIGIN}/`, keywords });

  if (out !== html) {
    await fs.writeFile(file, out, 'utf8');
    console.log(`[updated] (home) -> ${title}${image ? ' (custom image)' : ''}`);
  } else {
    console.log('[unchanged] (home)');
  }
}

async function main() {
  const liveList = await fetchLiveList();
  await updateHome(liveList);
  await Promise.all(CHANNELS.map((label) => updateChannel(label, liveList)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
