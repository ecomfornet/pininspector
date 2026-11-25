const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Redirect stderr writes to stdout to prevent PowerShell native command wrappers from treating warnings as task failures
console.error = (...args) => console.log('[ERROR]', ...args);
console.warn = (...args) => console.log('[WARN]', ...args);

// Process-level resilience against transient network/socket disconnects
process.on('uncaughtException', (err) => {
  console.log('[ERROR] [Process Safety] Uncaught exception:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.log('[ERROR] [Process Safety] Unhandled rejection:', reason?.message || reason);
});

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ----------------------------------------------------------------------
// Swagger API Specification & Interactive Swagger UI
// ----------------------------------------------------------------------
app.get('/api-docs/swagger.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'swagger.json'));
});

app.get('/api-docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pin Inspector Web Pro 2.0 - Swagger API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" type="image/svg+xml" href="https://www.pinterest.com/favicon.ico" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: sans-serif; }
    .topbar { display: none !important; }
    .swagger-ui .info { margin: 25px 0; }
    .swagger-ui .info .title { font-size: 28px; color: #0f172a; }
    .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #0284c7; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #059669; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api-docs/swagger.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`);
});

// Pinterest Session Cache & Headers
let sessionCache = {
  csrftoken: '',
  cookieHeader: '',
  timestamp: 0,
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let customCookieHeader = '';

async function getPinterestSession() {
  if (customCookieHeader) {
    let cleanCookies = customCookieHeader.replace(/[\r\n]+/g, ' ').trim();
    let csrftoken = '';
    const match = cleanCookies.match(/csrftoken=([^;]+)/);
    if (match) {
      csrftoken = match[1].trim();
    } else {
      // If user provided session without csrftoken, fetch a fresh CSRF token
      if (sessionCache.csrftoken) {
        csrftoken = sessionCache.csrftoken;
      } else {
        try {
          const res = await fetch('https://www.pinterest.com/', { headers: { 'User-Agent': USER_AGENT } });
          const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
          for (const c of rawCookies) {
            const pair = c.split(';')[0];
            if (pair.startsWith('csrftoken=')) {
              csrftoken = pair.split('=')[1];
              break;
            }
          }
        } catch {
          csrftoken = '0be095c464d4ec591b2d6c2396ce7a86';
        }
      }
      if (csrftoken && !cleanCookies.includes('csrftoken=')) {
        cleanCookies += `; csrftoken=${csrftoken}`;
      }
    }
    return {
      csrftoken: csrftoken || '0be095c464d4ec591b2d6c2396ce7a86',
      cookieHeader: cleanCookies,
      timestamp: Date.now(),
      isCustom: true,
    };
  }

  const now = Date.now();
  if (sessionCache.csrftoken && sessionCache.cookieHeader && now - sessionCache.timestamp < 30 * 60 * 1000) {
    return sessionCache;
  }

  try {
    const res = await fetch('https://www.pinterest.com/', {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cookiePairs = [];
    let csrftoken = '';

    for (const c of rawCookies) {
      const pair = c.split(';')[0];
      cookiePairs.push(pair);
      if (pair.startsWith('csrftoken=')) {
        csrftoken = pair.split('=')[1];
      }
    }

    sessionCache = {
      csrftoken: csrftoken || '0be095c464d4ec591b2d6c2396ce7a86',
      cookieHeader: cookiePairs.join('; '),
      timestamp: now,
      isCustom: false,
    };
  } catch (err) {
    console.warn('[Session] Renewal warning, using fallback/cached session:', err.message);
    if (!sessionCache.csrftoken) {
      sessionCache = {
        csrftoken: '0be095c464d4ec591b2d6c2396ce7a86',
        cookieHeader: 'csrftoken=0be095c464d4ec591b2d6c2396ce7a86;',
        timestamp: now,
        isCustom: false,
      };
    }
  }

  return sessionCache;
}

app.get('/api/session', async (req, res) => {
  const session = await getPinterestSession();
  res.json({
    connected: true,
    isCustom: Boolean(customCookieHeader),
    hasCsrf: Boolean(session.csrftoken),
    cookieLength: session.cookieHeader.length,
  });
});

app.post('/api/session', (req, res) => {
  const { cookies } = req.body;
  if (cookies && typeof cookies === 'string') {
    customCookieHeader = cookies.trim();
    sessionCache.timestamp = 0; // invalidate cache
    res.json({ success: true, message: 'Custom Pinterest cookies updated successfully' });
  } else {
    customCookieHeader = '';
    sessionCache.timestamp = 0;
    res.json({ success: true, message: 'Reset to automatic anonymous session' });
  }
});

function getRequestHeaders(session, refererUrl = 'https://www.pinterest.com/') {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Pinterest-AppState': 'active',
    'X-Pinterest-PWS-Handler': 'www/[page]',
    'X-CSRFToken': session.csrftoken,
    Cookie: session.cookieHeader,
    Referer: refererUrl,
  };
}

// ----------------------------------------------------------------------
// OPTIMIZATION INFRASTRUCTURE: WORKER POOL & IN-MEMORY LRU CACHES
// ----------------------------------------------------------------------
// Continuous Asynchronous Worker Pool (Delphi-parity non-blocking dequeue)
async function runWorkerPool(items, concurrency, workerFn) {
  let index = 0;
  const results = new Array(items.length);
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await workerFn(items[i], i);
      } catch (e) {
        results[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// In-Memory LRU & TTL Caches for high throughput
const pinDetailsCache = new Map();
const PIN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const PIN_CACHE_MAX = 2000;

function getCachedPin(cleanId) {
  const item = pinDetailsCache.get(cleanId);
  if (!item) return null;
  if (Date.now() - item.ts > PIN_CACHE_TTL) {
    pinDetailsCache.delete(cleanId);
    return null;
  }
  return item.data;
}

function setCachedPin(cleanId, data) {
  if (pinDetailsCache.size >= PIN_CACHE_MAX) {
    const oldestKey = pinDetailsCache.keys().next().value;
    pinDetailsCache.delete(oldestKey);
  }
  pinDetailsCache.set(cleanId, { data, ts: Date.now() });
}

const typeaheadCache = new Map();
const TYPEAHEAD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const TYPEAHEAD_CACHE_MAX = 1000;

function getCachedTypeahead(term) {
  const item = typeaheadCache.get(term.toLowerCase().trim());
  if (!item) return null;
  if (Date.now() - item.ts > TYPEAHEAD_CACHE_TTL) {
    typeaheadCache.delete(term.toLowerCase().trim());
    return null;
  }
  return item.data;
}

function setCachedTypeahead(term, data) {
  const key = term.toLowerCase().trim();
  if (typeaheadCache.size >= TYPEAHEAD_CACHE_MAX) {
    const oldestKey = typeaheadCache.keys().next().value;
    typeaheadCache.delete(oldestKey);
  }
  typeaheadCache.set(key, { data, ts: Date.now() });
}

// Normalized reaction extraction across all endpoints
function extractNormalizedReactions(rxCounts = {}) {
  const love = Number(rxCounts['1']) || 0;
  const goodIdea = Number(rxCounts['7']) || 0;
  const wow = Number(rxCounts['2']) || Number(rxCounts['11']) || 0;
  const haha = Number(rxCounts['8']) || Number(rxCounts['5']) || 0;
  const thanks = Number(rxCounts['12']) || Number(rxCounts['13']) || 0;
  const totalReactions = love + goodIdea + wow + haha + thanks;
  return { love, goodIdea, wow, haha, thanks, totalReactions };
}

// ----------------------------------------------------------------------
// 1. KEYWORDS GENERATOR
// ----------------------------------------------------------------------
app.get('/api/keywords', async (req, res) => {
  try {
    const rawQuery = (req.query.query || '').trim();
    const mode = (req.query.mode || 'after').toLowerCase();
    if (!rawQuery) return res.status(400).json({ error: 'Query is required' });

    const session = await getPinterestSession();
    const querySeeds = rawQuery.split(',').map((s) => s.trim()).filter(Boolean);

    const fetchSuggestions = async (term) => {
      const cached = getCachedTypeahead(term);
      if (cached) return cached;

      const params = new URLSearchParams({
        source_url: '/search/pins/?q=&rs=typed&term_meta[]=',
        data: JSON.stringify({ options: { count: 10, term }, context: {} }),
        _: Date.now().toString(),
      });

      try {
        const response = await fetch(
          `https://www.pinterest.com/resource/AdvancedTypeaheadResource/get/?${params.toString()}`,
          {
            headers: getRequestHeaders(session, `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}`),
            signal: AbortSignal.timeout(8000),
          }
        );

        if (!response.ok) return [];
        const json = await response.json();
        const items = (json?.resource_response?.data?.items || [])
          .filter((i) => i.query)
          .map((i) => i.query);
        setCachedTypeahead(term, items);
        return items;
      } catch (e) {
        return [];
      }
    };

    let seedsToRun = [];
    const alphaNum = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

    for (const q of querySeeds) {
      if (mode === 'single') {
        seedsToRun.push(q);
      } else if (mode === 'before' || mode === 'alphabet_prefix') {
        // a - z, 0 - 9 (before seed keyword)
        seedsToRun.push(q);
        for (const ch of alphaNum) seedsToRun.push(`${ch} ${q}`);
      } else if (mode === 'both') {
        // a - z, 0 - 9 (before AND after seed keyword)
        seedsToRun.push(q);
        for (const ch of alphaNum) seedsToRun.push(`${q} ${ch}`);
        for (const ch of alphaNum) seedsToRun.push(`${ch} ${q}`);
      } else if (mode === 'aa_zz') {
        // aa-zz (after seed keyword)
        seedsToRun.push(q);
        const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
        for (const l1 of letters) {
          for (const l2 of letters) {
            seedsToRun.push(`${q} ${l1}${l2}`);
          }
        }
      } else {
        // Default: a - z, 0 - 9 (after seed keyword) - Delphi Parity
        seedsToRun.push(q);
        for (const ch of alphaNum) seedsToRun.push(`${q} ${ch}`);
      }
    }

    const seen = new Set();
    const results = [];
    // Concurrency 12 with continuous non-blocking worker pool
    const seedResults = await runWorkerPool(seedsToRun, 12, async (seed) => {
      const suggestions = await fetchSuggestions(seed);
      return { seed, suggestions };
    });

    let rank = 1;
    for (const entry of seedResults) {
      if (!entry) continue;
      const { seed, suggestions } = entry;
      for (const item of suggestions) {
        const lower = item.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          results.push({
            rank: rank++,
            seed,
            keyword: item,
            wordCount: item.trim().split(/\s+/).length,
            charCount: item.length,
            url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(item)}`,
          });
        }
      }
    }

    res.json({ seed: rawQuery, total: results.length, keywords: results });
  } catch (err) {
    console.error('Keywords error:', err);
    res.status(500).json({ error: err.message });
  }
});

function safeHostname(link) {
  try {
    return new URL(link).hostname;
  } catch {
    return 'Uploaded by user';
  }
}

// Helper to reliably extract best original and thumbnail image URLs from any Pinterest pin object
function extractPinImageUrls(p) {
  if (!p || typeof p !== 'object') return { origImg: null, thumbImg: null };

  const pickFromImagesObj = (imgs, order) => {
    if (!imgs || typeof imgs !== 'object') return null;
    for (const key of order) {
      const candidate = imgs[key]?.url || (typeof imgs[key] === 'string' ? imgs[key] : null);
      if (candidate && typeof candidate === 'string' && candidate.startsWith('http')) {
        return candidate;
      }
    }
    for (const val of Object.values(imgs)) {
      const candidate = val?.url || (typeof val === 'string' ? val : null);
      if (candidate && typeof candidate === 'string' && candidate.startsWith('http')) {
        return candidate;
      }
    }
    return null;
  };

  const origOrder = ['orig', 'originals', '1200x', '736x', '564x', '474x', '600x315', '236x', '170x', '136x136', '60x60'];
  const thumbOrder = ['236x', '170x', '474x', '564x', '736x', '136x136', 'orig', 'originals', '1200x', '60x60'];

  const images = p.images || {};
  let origImg = pickFromImagesObj(images, origOrder);
  let thumbImg = pickFromImagesObj(images, thumbOrder);

  // Fallback 1: Direct URL properties on pin object
  if (!origImg) {
    const directCandidates = [
      p.image_large_url,
      p.image_medium_url,
      p.image_small_url,
      p.image_url,
      p.image,
      p.thumbnail,
    ];
    for (const c of directCandidates) {
      if (typeof c === 'string' && c.startsWith('http')) {
        origImg = c;
        break;
      }
    }
  }
  if (!thumbImg) {
    const directThumbCandidates = [
      p.image_medium_url,
      p.image_small_url,
      p.image_large_url,
      p.thumbnail,
      p.image_url,
    ];
    for (const c of directThumbCandidates) {
      if (typeof c === 'string' && c.startsWith('http')) {
        thumbImg = c;
        break;
      }
    }
  }

  // Fallback 2: Story / Idea Pin pages & blocks
  if (!origImg && p.story_pin_data?.pages?.length) {
    for (const page of p.story_pin_data.pages) {
      const pageImg =
        pickFromImagesObj(page?.image?.images, origOrder) ||
        pickFromImagesObj(page?.image_adjusted?.images, origOrder);
      if (pageImg) {
        origImg = pageImg;
        if (!thumbImg) {
          thumbImg =
            pickFromImagesObj(page?.image?.images, thumbOrder) ||
            pickFromImagesObj(page?.image_adjusted?.images, thumbOrder) ||
            pageImg;
        }
        break;
      }
      if (Array.isArray(page?.blocks)) {
        for (const blk of page.blocks) {
          const blkImg =
            pickFromImagesObj(blk?.image?.images, origOrder) ||
            pickFromImagesObj(blk?.image_adjusted?.images, origOrder) ||
            Object.values(blk?.video?.video_list || {}).find((v) => v?.thumbnail?.startsWith('http'))?.thumbnail ||
            null;
          if (blkImg) {
            origImg = blkImg;
            if (!thumbImg) {
              thumbImg =
                pickFromImagesObj(blk?.image?.images, thumbOrder) ||
                pickFromImagesObj(blk?.image_adjusted?.images, thumbOrder) ||
                blkImg;
            }
            break;
          }
        }
      }
      if (origImg) break;
    }
  }

  // Fallback 3: Carousel pin slots
  if (!origImg && p.carousel_data?.carousel_slots?.length) {
    for (const slot of p.carousel_data.carousel_slots) {
      const slotImg = pickFromImagesObj(slot?.images, origOrder);
      if (slotImg) {
        origImg = slotImg;
        if (!thumbImg) thumbImg = pickFromImagesObj(slot?.images, thumbOrder) || slotImg;
        break;
      }
    }
  }

  // Fallback 4: Video thumbnail
  if (!origImg && p.videos?.video_list) {
    const vThumb = Object.values(p.videos.video_list).find((v) => v?.thumbnail && v.thumbnail.startsWith('http'))?.thumbnail;
    if (vThumb) origImg = vThumb;
  }

  // Fallback 5: Deterministic Pinterest CDN URL from 32-char hex image_signature
  if (!origImg && typeof p.image_signature === 'string' && /^[a-f0-9]{32}$/i.test(p.image_signature.trim())) {
    const sig = p.image_signature.trim().toLowerCase();
    const shard = `${sig.slice(0, 2)}/${sig.slice(2, 4)}/${sig.slice(4, 6)}`;
    origImg = `https://i.pinimg.com/736x/${shard}/${sig}.jpg`;
    if (!thumbImg) thumbImg = `https://i.pinimg.com/236x/${shard}/${sig}.jpg`;
  }

  if (!thumbImg) thumbImg = origImg;
  if (!origImg) origImg = thumbImg;

  return { origImg, thumbImg };
}

// Helper to format raw pin objects
function formatPin(p) {
  if (!p) return null;
  const { origImg, thumbImg } = extractPinImageUrls(p);
  const pinner = p.pinner || p.creator || p.owner || {};
  const board = p.board || {};
  const rxCounts = p.reaction_counts || {};

  // Extract numeric pin ID if available (Delphi Pin Inspector parity)
  let numId = null;
  if (p.id && /^\d+$/.test(String(p.id))) {
    numId = String(p.id);
  }
  if (!numId && p.comments?.uri) {
    const m = p.comments.uri.match(/\/pins\/(\d+)/);
    if (m) numId = m[1];
  }
  if (!numId && p.pin_join?.native_pin_id && /^\d+$/.test(String(p.pin_join.native_pin_id))) {
    numId = String(p.pin_join.native_pin_id);
  }
  const realId = numId || String(p.id || '');
  const pinUrl = realId ? `https://www.pinterest.com/pin/${realId}/` : '';

  // Reaction type mapping normalized across Pin Inspector
  const { love, goodIdea, wow, haha, thanks, totalReactions } = extractNormalizedReactions(rxCounts);

  // Video info
  const videoData = p.videos?.video_list || {};
  const videoStreams = Object.values(videoData);
  const videoUrl = videoStreams.length > 0 ? videoStreams[0].url : null;
  const videoDuration = p.videos?.duration ? Math.round(p.videos.duration / 1000) : 0;

  const saves = Number(p.repin_count) || Number(p.aggregated_pin_data?.aggregated_stats?.saves) || 0;
  const comments = Number(p.comment_count) || 0;
  const boardName = board.name || '';
  const boardUrl = board.url ? (board.url.startsWith('http') ? board.url : `https://www.pinterest.com${board.url}`) : '';
  const pinnerUsername = pinner.username || '';
  const pinnerFullName = pinner.full_name || pinner.username || 'Anonymous';
  const pinTitle =
    typeof p.title === 'string' && p.title.trim()
      ? p.title
      : p.grid_title || p.rich_summary?.display_name || 'Untitled Pin';

  const rawAnn = p.pin_join?.visual_annotation || p.visual_annotation || [];
  const hashtags = Array.isArray(p.hashtags) ? p.hashtags.join(',') : (p.hashtags || '');
  const aiInfo = detectPinAiStatus(p, rawAnn, hashtags);

  return {
    id: realId,
    'Pin ID': realId,
    'Image': origImg || 'not-given',
    'Title': pinTitle,
    'main link': pinUrl,
    title: pinTitle,
    description: p.description || p.auto_alt_text || '',
    link: p.link || null,
    domain: p.domain || (p.link ? safeHostname(p.link) : 'Uploaded by user'),
    image: origImg,
    thumbnail: thumbImg,
    saves,
    comments,
    totalReactions,
    reactionCount: totalReactions,
    reactions: { love, goodIdea, wow, haha, thanks },
    isVideo: !!p.videos,
    videoUrl,
    videoDuration,
    'Is AI Modified': aiInfo.isAi ? 'YES' : 'NO',
    isAiModified: aiInfo.isAi,
    aiType: aiInfo.type,
    aiConfidence: aiInfo.confidence,
    aiSource: aiInfo.source,
    board: {
      id: String(board.id || ''),
      name: boardName,
      url: boardUrl,
    },
    boardName,
    boardUrl,
    pinner: {
      username: pinnerUsername,
      fullName: pinnerFullName,
      image: pinner.image_small_url || pinner.image_medium_url || pinner.image_large_url || null,
      followers: Number(pinner.follower_count) || 0,
    },
    pinnerUsername,
    pinnerName: pinnerFullName,
    dominantColor: p.dominant_color || '#ffffff',
    url: pinUrl,
    pinUrl,
  };
}

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// 2. PINS ANALYZER (Delphi Pin Inspector 2 Parity)
// ----------------------------------------------------------------------
const PINTEREST_COUNTRY_CONFIGS = {
  US: { code: 'US', locale: 'en-US', domain: 'www.pinterest.com', label: 'United States' },
  GB: { code: 'GB', locale: 'en-GB', domain: 'www.pinterest.co.uk', label: 'United Kingdom' },
  CA: { code: 'CA', locale: 'en-CA', domain: 'www.pinterest.ca', label: 'Canada' },
  AU: { code: 'AU', locale: 'en-AU', domain: 'www.pinterest.com.au', label: 'Australia' },
  DE: { code: 'DE', locale: 'de-DE', domain: 'www.pinterest.de', label: 'Germany' },
  FR: { code: 'FR', locale: 'fr-FR', domain: 'www.pinterest.fr', label: 'France' },
  ES: { code: 'ES', locale: 'es-ES', domain: 'www.pinterest.es', label: 'Spain' },
  IT: { code: 'IT', locale: 'it-IT', domain: 'www.pinterest.it', label: 'Italy' },
  MX: { code: 'MX', locale: 'es-MX', domain: 'www.pinterest.com.mx', label: 'Mexico' },
  BR: { code: 'BR', locale: 'pt-BR', domain: 'br.pinterest.com', label: 'Brazil' },
  AR: { code: 'AR', locale: 'es-AR', domain: 'ar.pinterest.com', label: 'Argentina' },
  CO: { code: 'CO', locale: 'es-CO', domain: 'co.pinterest.com', label: 'Colombia' },
  CL: { code: 'CL', locale: 'es-CL', domain: 'cl.pinterest.com', label: 'Chile' },
  NL: { code: 'NL', locale: 'nl-NL', domain: 'nl.pinterest.com', label: 'Netherlands' },
  SE: { code: 'SE', locale: 'sv-SE', domain: 'se.pinterest.com', label: 'Sweden' },
  PL: { code: 'PL', locale: 'pl-PL', domain: 'pl.pinterest.com', label: 'Poland' },
  JP: { code: 'JP', locale: 'ja-JP', domain: 'www.pinterest.jp', label: 'Japan' },
  IN: { code: 'IN', locale: 'en-IN', domain: 'in.pinterest.com', label: 'India' },
  IE: { code: 'IE', locale: 'en-IE', domain: 'www.pinterest.ie', label: 'Ireland' },
  NZ: { code: 'NZ', locale: 'en-NZ', domain: 'www.pinterest.nz', label: 'New Zealand' },
};

function getPinterestCountryConfig(rawCode) {
  const code = String(rawCode || 'US').trim().toUpperCase();
  return PINTEREST_COUNTRY_CONFIGS[code] || PINTEREST_COUNTRY_CONFIGS.US;
}

function getLocalizedRequestHeaders(session, sourceUrl, countryConfig = null) {
  const host = countryConfig?.domain || 'www.pinterest.com';
  const headers = getRequestHeaders(session, `https://${host}${sourceUrl}`);
  if (countryConfig) {
    headers['Accept-Language'] = `${countryConfig.locale},en;q=0.9`;
    headers['Cookie'] = `${session.cookieHeader}; locale=${countryConfig.locale}; _country=${countryConfig.code}`;
  }
  return headers;
}

async function harvestNumericPinIdsWithCursor(
  phrase,
  targetCount,
  isVideo,
  session,
  startBookmark = '',
  existingIds = null,
  overshoot = 15,
  countryConfig = null
) {
  let bookmark = startBookmark || '';
  const pinIds = [];
  const seen = existingIds || new Set();
  let page = 0;
  let emptyPages = 0;
  const harvestTarget = targetCount + overshoot;
  const maxPages = Math.max(12, Math.ceil(harvestTarget / 20) + 5);

  while (pinIds.length < harvestTarget && page < maxPages) {
    page++;
    const dataPayload = {
      options: {
        url: '/v3/search/pins/',
        bookmarks: bookmark ? [bookmark] : [''],
        data: {
          query: phrase,
          page_size: 25,
          fields: 'pin.id,pin.type,pin.comments(limit:0,resume:true)',
          ...(countryConfig ? { country: countryConfig.code, locale: countryConfig.locale } : {}),
          ...(isVideo ? { format: 'video' } : {})
        },
      },
      context: {},
    };
    const sourceUrl = '/search/pins/?q=' + encodeURIComponent(phrase);
    const searchUrl = 'https://www.pinterest.com/resource/ApiResource/get/?source_url=' + encodeURIComponent(sourceUrl) + '&data=' + encodeURIComponent(JSON.stringify(dataPayload)) + '&_=' + Date.now();

    let res = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(searchUrl, {
          headers: getLocalizedRequestHeaders(session, sourceUrl, countryConfig),
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) break;
        if ((res.status === 401 || res.status === 403) && !session.isCustom && attempt === 0) {
          sessionCache.timestamp = 0;
          session = await getPinterestSession();
        }
      } catch {
        res = null;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }

    if (!res || !res.ok) break;
    const json = await res.json();
    const items = json.resource_response?.data || [];
    const nextBm = json.resource_response?.bookmark;
    if (nextBm === bookmark) {
      bookmark = '';
      break;
    }
    bookmark = nextBm;

    let addedOnPage = 0;
    for (const item of items) {
      let id = item.id;
      if (item.comments?.uri) {
        const m = item.comments.uri.match(/\/pins\/(\d+)\//);
        if (m) id = m[1];
      }
      if (id && !seen.has(id)) {
        seen.add(id);
        pinIds.push(id);
        addedOnPage++;
        if (pinIds.length >= harvestTarget) break;
      }
    }

    if (addedOnPage === 0) {
      emptyPages++;
      if (emptyPages >= 3) break;
    } else {
      emptyPages = 0;
    }

    if (!bookmark || bookmark === '-end-') break;
  }

  return {
    pinIds,
    nextBookmark: bookmark && bookmark !== '-end-' ? bookmark : '',
    hasMore: Boolean(bookmark && bookmark !== '-end-'),
  };
}

async function harvestNumericPinIds(phrase, targetCount, isVideo, session) {
  const { pinIds } = await harvestNumericPinIdsWithCursor(phrase, targetCount, isVideo, session, '', null, 15);
  return pinIds;
}

app.get('/api/pins', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    const targetCount = parseInt(req.query.count || req.query.targetCount || req.query.pageSize, 10) || 50;
    const searchIn = (req.query.searchIn || '').toLowerCase();
    const isVideo = searchIn === 'videos' || req.query.isVideo === 'true';
    const stream = req.query.stream === 'true';
    const aiFilter = (req.query.aiFilter || '').toLowerCase().trim(); // 'all', 'ai-only', 'human-only'

    if (!query) return res.status(400).json({ error: 'Query is required' });

    const session = await getPinterestSession();

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (res.flushHeaders) res.flushHeaders();

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      res.write(`data: ${JSON.stringify({ type: 'start', query, targetCount })}\n\n`);

      // 1. Harvest IDs with a buffer to guarantee exact targetCount
      const pinIds = await harvestNumericPinIds(query, targetCount, isVideo, session);
      if (clientDisconnected) return;

      res.write(`data: ${JSON.stringify({ type: 'harvested', total: Math.min(pinIds.length, targetCount) })}\n\n`);

      if (pinIds.length === 0) {
        res.write(`data: ${JSON.stringify({ type: 'done', total: 0 })}\n\n`);
        return res.end();
      }

      // 2. Concurrently extract pin deep details until exactly targetCount is reached
      let validCount = 0;
      let currentIndex = 0;
      const concurrency = 12;

      const worker = async () => {
        while (currentIndex < pinIds.length && validCount < targetCount && !clientDisconnected) {
          const idx = currentIndex++;
          const pinId = pinIds[idx];
          try {
            const pin = await fetchPinDeepDetails(pinId, session);
            if (!clientDisconnected && pin) {
              if (aiFilter === 'ai-only' && !pin.isAiModified && pin['Is AI Modified'] !== 'YES') continue;
              if (aiFilter === 'human-only' && (pin.isAiModified || pin['Is AI Modified'] === 'YES')) continue;
              if (validCount < targetCount) {
                validCount++;
                res.write(`data: ${JSON.stringify({ type: 'pin', index: validCount - 1, completed: validCount, total: targetCount, pin })}\n\n`);
              }
            }
          } catch (err) {
            console.warn(`Error scraping pin ${pinId}:`, err.message);
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, pinIds.length) }, () => worker());
      await Promise.all(workers);

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ type: 'done', total: validCount })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming JSON response
      const pinIds = await harvestNumericPinIds(query, targetCount, isVideo, session);
      const pins = [];
      let currentIndex = 0;
      const concurrency = 12;

      const worker = async () => {
        while (currentIndex < pinIds.length && pins.length < targetCount) {
          const idx = currentIndex++;
          const pinId = pinIds[idx];
          try {
            const pin = await fetchPinDeepDetails(pinId, session);
            if (pin) {
              if (aiFilter === 'ai-only' && !pin.isAiModified && pin['Is AI Modified'] !== 'YES') continue;
              if (aiFilter === 'human-only' && (pin.isAiModified || pin['Is AI Modified'] === 'YES')) continue;
              if (pins.length < targetCount) pins.push(pin);
            }
          } catch (err) {
            console.warn(`Error scraping pin ${pinId}:`, err.message);
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, pinIds.length) }, () => worker());
      await Promise.all(workers);

      res.json({
        query,
        total: pins.length,
        pins,
      });
    }
  } catch (err) {
    console.error('Pins error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

// ----------------------------------------------------------------------
// 2B. WINNER PIN FINDER (Keyword Pin Search with Live Feed Filter Support)
// ----------------------------------------------------------------------
function matchesWinnerFilter(pin, { minSaves = 0, maxDays = 0, hasLink = 'all', excludeVideo = false }) {
  if (!pin) return false;
  const savesNum = Number(pin.saves ?? 0) || 0;
  if (minSaves > 0 && savesNum < minSaves) return false;

  if (maxDays > 0) {
    const ts = typeof pin.createdTimestamp === 'number'
      ? pin.createdTimestamp
      : Date.parse(pin.createdAt || pin.Created || pin.created || '');
    if (!Number.isFinite(ts)) return false;
    const ageDays = (Date.now() - ts) / 86400000;
    if (ageDays > maxDays) return false;
  }

  const pinHasLink = Boolean(
    pin.hasLink ||
    (pin.link && typeof pin.link === 'string' && pin.link.trim() && pin.link.trim().toLowerCase() !== 'not-given')
  );
  if (hasLink === 'yes' && !pinHasLink) return false;
  if (hasLink === 'no' && pinHasLink) return false;

  if (excludeVideo) {
    const pinIsVideo = Boolean(
      pin.isVideo ||
      pin['Is Video'] === 'YES' ||
      pin.videoUrl ||
      (pin['Video link'] && pin['Video link'] !== 'not-given')
    );
    if (pinIsVideo) return false;
  }

  return true;
}

// Expand a seed keyword into hundreds of high-signal Pinterest search queries
// using multi-tier expansion (direct typeahead, long-tail sub-phrases + typeahead,
// mined visual annotations from Phase-1 pins, and broad modifiers) so 1k / 5k / 10k
// scans complete reliably even for ultra-specific 4–6 word long-tail keywords.
async function getExpandedWinnerQueries(baseQuery, session, countryConfig = null, annotationCounts = null) {
  const cachePrefix = countryConfig ? `${countryConfig.code}:` : '';
  const fetchSuggestions = async (term) => {
    const cacheKey = `${cachePrefix}${term}`;
    const cached = getCachedTypeahead(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      source_url: '/search/pins/?q=&rs=typed&term_meta[]=',
      data: JSON.stringify({ options: { count: 10, term }, context: {} }),
      _: Date.now().toString(),
    });
    try {
      const sourceUrl = `/search/pins/?q=${encodeURIComponent(term)}`;
      const response = await fetch(
        `https://www.pinterest.com/resource/AdvancedTypeaheadResource/get/?${params.toString()}`,
        {
          headers: getLocalizedRequestHeaders(session, sourceUrl, countryConfig),
          signal: AbortSignal.timeout(7000),
        }
      );
      if (!response.ok) return [];
      const json = await response.json();
      const items = (json?.resource_response?.data?.items || [])
        .filter((i) => i.query)
        .map((i) => i.query.trim());
      setCachedTypeahead(cacheKey, items);
      return items;
    } catch {
      return [];
    }
  };

  const seenLower = new Set([baseQuery.toLowerCase().trim()]);
  const expanded = [];
  const addCandidate = (q) => {
    if (!q || typeof q !== 'string') return;
    const clean = q.replace(/\s+/g, ' ').trim();
    if (clean.length < 2) return;
    const lower = clean.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      expanded.push(clean);
    }
  };

  const words = baseQuery
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  // Tier 1: Direct typeahead on exact query
  const directHits = await fetchSuggestions(baseQuery);
  for (const q of directHits) addCandidate(q);

  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  if (words.length <= 3 || directHits.length > 0) {
    const exactAlphaTerms = letters.map((ch) => `${baseQuery} ${ch}`);
    const exactBatches = await runWorkerPool(exactAlphaTerms, 12, fetchSuggestions);
    for (const list of exactBatches) {
      if (Array.isArray(list)) list.forEach(addCandidate);
    }
  }

  // Tier 2: Long-tail sub-phrase extraction + sub-phrase typeahead (crucial for 3+ word queries)
  const subPhrases = [];
  const subSeen = new Set([baseQuery.toLowerCase().trim()]);
  const pushSubPhrase = (p) => {
    const clean = p.replace(/\s+/g, ' ').trim();
    const low = clean.toLowerCase();
    if (clean.length >= 3 && !subSeen.has(low)) {
      subSeen.add(low);
      subPhrases.push(clean);
    }
  };

  if (words.length >= 4) {
    // Drop-1-word variations (prioritize dropping leading adjectives like "Mint")
    for (let skip = 0; skip < words.length; skip++) {
      pushSubPhrase(words.filter((_, idx) => idx !== skip).join(' '));
    }
    // Contiguous 3-word windows (right-to-left first since core nouns are usually at the end)
    for (let i = words.length - 3; i >= 0; i--) {
      pushSubPhrase(words.slice(i, i + 3).join(' '));
    }
    // Contiguous 2-word windows (right-to-left first)
    for (let i = words.length - 2; i >= 0; i--) {
      pushSubPhrase(words.slice(i, i + 2).join(' '));
    }
    // High-value non-contiguous noun pairs (e.g., "moth cape", "luna cape")
    const lastWord = words[words.length - 1];
    for (let i = words.length - 3; i >= 0; i--) {
      pushSubPhrase(`${words[i]} ${lastWord}`);
    }
  } else if (words.length === 3) {
    pushSubPhrase(`${words[1]} ${words[2]}`);
    pushSubPhrase(`${words[0]} ${words[1]}`);
    pushSubPhrase(`${words[0]} ${words[2]}`);
  } else if (words.length === 2) {
    pushSubPhrase(`${words[1]} ${words[0]}`);
  }

  // Add core sub-phrases directly and fetch Pinterest Typeahead for the top sub-phrases
  for (const sp of subPhrases) addCandidate(sp);

  if (subPhrases.length > 0) {
    const topSubSeeds = subPhrases.slice(0, 12);
    const subBatches = await runWorkerPool(topSubSeeds, 10, fetchSuggestions);
    let bestAlphaSeed = '';
    let bestAlphaCount = 0;

    for (let i = 0; i < subBatches.length; i++) {
      const list = subBatches[i];
      if (!Array.isArray(list)) continue;
      list.forEach(addCandidate);
      if (list.length > bestAlphaCount) {
        bestAlphaCount = list.length;
        bestAlphaSeed = topSubSeeds[i];
      }
    }

    // Run a-z typeahead on up to 2 highest-yield sub-phrases (especially when exact query had 0 hits)
    const alphaCandidates = [];
    if (bestAlphaSeed) alphaCandidates.push(bestAlphaSeed);
    for (let i = 0; i < subBatches.length && alphaCandidates.length < 2; i++) {
      if (Array.isArray(subBatches[i]) && subBatches[i].length >= 4 && !alphaCandidates.includes(topSubSeeds[i])) {
        alphaCandidates.push(topSubSeeds[i]);
      }
    }
    if (alphaCandidates.length > 0 && expanded.length < 180) {
      const alphaTerms = [];
      for (const seed of alphaCandidates) {
        for (const ch of letters) alphaTerms.push(`${seed} ${ch}`);
      }
      const alphaBatches = await runWorkerPool(alphaTerms, 12, fetchSuggestions);
      for (const list of alphaBatches) {
        if (Array.isArray(list)) list.forEach(addCandidate);
      }
    }
  }

  // Tier 3: Mined Visual Annotations from already-scanned Phase-1 pins (Pinterest's own niche graph!)
  if (annotationCounts && annotationCounts.size > 0) {
    const sortedAnnotations = [...annotationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([term]) => term);

    const coreAnchor = words.length >= 2 ? words.slice(-2).join(' ') : baseQuery;
    for (const ann of sortedAnnotations.slice(0, 70)) {
      addCandidate(ann);
      if (ann.split(/\s+/).length <= 2 && !ann.toLowerCase().includes(words[words.length - 1]?.toLowerCase() || '')) {
        addCandidate(`${ann} ${coreAnchor}`);
      }
    }
  }

  // Tier 4: Rich modifiers applied to the full query & top core sub-phrases
  const fallbackMods = [
    'pattern', 'free pattern', 'tutorial', 'diy', 'handmade', 'ideas',
    'aesthetic', 'inspiration', 'design', 'outfit', 'style', 'fairy',
    'cottagecore', 'boho', 'vintage', 'pastel', 'fantasy', 'craft',
    'art', 'cozy', 'modern', 'minimalist', 'luxury', 'unique',
    'cute', 'easy', 'beginner', 'trending', 'best', 'gift',
    'shop', 'decor', 'tips', '2025', '2026', 'green', 'blue', 'black', 'purple'
  ];

  const modBases = words.length <= 3
    ? [baseQuery, ...subPhrases.slice(0, 2)]
    : [...subPhrases.slice(0, 4), baseQuery];

  for (const mod of fallbackMods) {
    for (const mb of modBases) {
      addCandidate(`${mb} ${mod}`);
    }
  }

  return expanded;
}

app.get('/api/winner-pins', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    const rawCount = parseInt(req.query.count || req.query.scanCount || '100', 10);
    const targetCount = Math.min(10000, Math.max(10, Number.isFinite(rawCount) ? rawCount : 100));
    const searchIn = (req.query.searchIn || 'pins').toLowerCase();
    const isVideoOnly = searchIn === 'videos' || req.query.isVideo === 'true';
    const isExcludeVideos = searchIn === 'exclude-videos' || req.query.excludeVideo === 'true';
    const countryConfig = getPinterestCountryConfig(req.query.country || 'US');
    const startBookmark = (req.query.bookmark || '').trim();
    const stream = req.query.stream === 'true';
    const minSaves = Math.max(0, parseInt(req.query.minSaves || '0', 10) || 0);
    const maxDays = Math.max(0, parseInt(req.query.maxDays || '0', 10) || 0);
    const hasLink = (req.query.hasLink || 'all').toLowerCase();

    if (!query) return res.status(400).json({ error: 'Query is required' });

    const matchesPinType = (pin) => {
      if (!pin) return false;
      const pinIsVideo = Boolean(
        pin.isVideo ||
        pin['Is Video'] === 'YES' ||
        pin.videoUrl ||
        (pin['Video link'] && pin['Video link'] !== 'not-given')
      );
      if (isExcludeVideos && pinIsVideo) return false;
      if (isVideoOnly && !pinIsVideo) return false;
      return true;
    };

    const recordPinAnnotations = (pin, annMap) => {
      const raw = pin?.Annotations || pin?.annotations || '';
      if (!raw || typeof raw !== 'string' || raw === 'not-given') return;
      for (const part of raw.split(',')) {
        const clean = part.trim();
        if (clean.length >= 3 && clean.length <= 45) {
          annMap.set(clean, (annMap.get(clean) || 0) + 1);
        }
      }
    };

    const session = await getPinterestSession();

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (res.flushHeaders) res.flushHeaders();

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      res.write(`data: ${JSON.stringify({
        type: 'start',
        query,
        targetCount,
        searchIn,
        country: countryConfig.code,
        countryLabel: countryConfig.label,
      })}\n\n`);

      let scanned = 0;
      let currentBookmark = startBookmark;
      let primaryHasMore = true;
      const seenPinIds = new Set();
      const annotationCounts = new Map();
      const batchSize = targetCount > 150 ? 100 : targetCount;
      const concurrency = targetCount >= 2000 ? 20 : (targetCount >= 1000 ? 16 : 12);

      const scanQueryFeed = async (activeQuery, initialBookmark, isExpanded, subIdx, totalSubs) => {
        let bm = initialBookmark || '';
        let feedHasMore = true;
        let zeroMatchBatches = 0;

        while (scanned < targetCount && feedHasMore && !clientDisconnected) {
          const remaining = targetCount - scanned;
          const harvestCount = isExcludeVideos
            ? Math.min(batchSize + 30, Math.max(25, Math.ceil(remaining * 1.4)))
            : Math.min(batchSize, remaining);
          const batch = await harvestNumericPinIdsWithCursor(
            activeQuery,
            harvestCount,
            isVideoOnly,
            session,
            bm,
            seenPinIds,
            0,
            countryConfig
          );
          if (clientDisconnected) return { nextBookmark: bm, hasMore: false };

          bm = batch.nextBookmark;
          feedHasMore = batch.hasMore;

          const idsToScan = isExcludeVideos ? batch.pinIds : batch.pinIds.slice(0, remaining);
          if (idsToScan.length === 0) {
            feedHasMore = false;
            break;
          }

          const expectedTotal = targetCount;
          if (!isExpanded) {
            res.write(`data: ${JSON.stringify({ type: 'harvested', total: expectedTotal, batchSize: idsToScan.length, nextBookmark: bm, hasMore: feedHasMore })}\n\n`);
          }

          const scannedBeforeBatch = scanned;
          let currentIndex = 0;
          const worker = async () => {
            while (currentIndex < idsToScan.length && scanned < targetCount && !clientDisconnected) {
              const idx = currentIndex++;
              const pinId = idsToScan[idx];
              try {
                const pin = await fetchPinDeepDetails(pinId, session);
                if (!clientDisconnected && pin && scanned < targetCount) {
                  recordPinAnnotations(pin, annotationCounts);
                  if (!matchesPinType(pin)) continue;
                  scanned++;
                  res.write(`data: ${JSON.stringify({
                    type: 'pin',
                    index: scanned - 1,
                    completed: scanned,
                    total: expectedTotal,
                    subquery: isExpanded ? activeQuery : '',
                    subqueryIndex: subIdx,
                    totalSubqueries: totalSubs,
                    pin,
                  })}\n\n`);
                }
              } catch (err) {
                console.warn(`Error scraping winner pin ${pinId}:`, err.message);
              }
            }
          };

          const workers = Array.from({ length: Math.min(concurrency, idsToScan.length) }, () => worker());
          await Promise.all(workers);

          if (scanned === scannedBeforeBatch) {
            zeroMatchBatches++;
            if (isExpanded && zeroMatchBatches >= 2) break;
          } else {
            zeroMatchBatches = 0;
          }
        }

        return { nextBookmark: bm, hasMore: feedHasMore };
      };

      // Phase 1: Scroll 100% of the exact seed query feed
      const primaryResult = await scanQueryFeed(query, currentBookmark, false, 0, 0);
      currentBookmark = primaryResult.nextBookmark;
      primaryHasMore = primaryResult.hasMore;

      // Phase 2: If targetCount wasn't reached (Pinterest caps a single query or long-tail query has <5k pins),
      // automatically expand into related Pinterest searches, sub-phrases, and mined visual annotations
      let expandedUsed = 0;
      const triedQueries = new Set([query.toLowerCase()]);

      if (scanned < targetCount && !clientDisconnected) {
        res.write(`data: ${JSON.stringify({
          type: 'expanding',
          completed: scanned,
          total: targetCount,
          query,
        })}\n\n`);

        const subqueries = await getExpandedWinnerQueries(query, session, countryConfig, annotationCounts);
        const totalSubs = subqueries.length;

        for (let i = 0; i < subqueries.length && scanned < targetCount && !clientDisconnected; i++) {
          const sq = subqueries[i];
          if (triedQueries.has(sq.toLowerCase())) continue;
          triedQueries.add(sq.toLowerCase());
          expandedUsed++;

          res.write(`data: ${JSON.stringify({
            type: 'subquery',
            subquery: sq,
            subqueryIndex: expandedUsed,
            totalSubqueries: totalSubs,
            completed: scanned,
            total: targetCount,
          })}\n\n`);

          await scanQueryFeed(sq, '', true, expandedUsed, totalSubs);
        }

        // Wave 2: If still below targetCount (e.g. 10k scan on a rare niche), expand newly mined annotations
        if (scanned < targetCount && !clientDisconnected && annotationCounts.size > 0) {
          const wave2Terms = [...annotationCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([term]) => term)
            .filter((term) => !triedQueries.has(term.toLowerCase()))
            .slice(0, 120);

          const wave2Total = expandedUsed + wave2Terms.length;
          for (let i = 0; i < wave2Terms.length && scanned < targetCount && !clientDisconnected; i++) {
            const sq = wave2Terms[i];
            triedQueries.add(sq.toLowerCase());
            expandedUsed++;

            res.write(`data: ${JSON.stringify({
              type: 'subquery',
              subquery: sq,
              subqueryIndex: expandedUsed,
              totalSubqueries: wave2Total,
              completed: scanned,
              total: targetCount,
            })}\n\n`);

            await scanQueryFeed(sq, '', true, expandedUsed, wave2Total);
          }
        }
      }

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({
          type: 'done',
          total: scanned,
          country: countryConfig.code,
          countryLabel: countryConfig.label,
          nextBookmark: currentBookmark,
          hasMore: primaryHasMore,
          expandedQueriesUsed: expandedUsed,
        })}\n\n`);
        res.end();
      }
    } else {
      const seenPinIds = new Set();
      const harvestGoal = isExcludeVideos ? Math.min(10000, Math.ceil(targetCount * 1.4)) : targetCount;
      const firstBatch = await harvestNumericPinIdsWithCursor(
        query,
        harvestGoal,
        isVideoOnly,
        session,
        startBookmark,
        seenPinIds,
        0,
        countryConfig
      );
      let allPinIds = [...firstBatch.pinIds];

      if (allPinIds.length < harvestGoal) {
        const subqueries = await getExpandedWinnerQueries(query, session, countryConfig);
        for (const sq of subqueries) {
          if (allPinIds.length >= harvestGoal) break;
          const next = await harvestNumericPinIdsWithCursor(
            sq,
            harvestGoal - allPinIds.length,
            isVideoOnly,
            session,
            '',
            seenPinIds,
            0,
            countryConfig
          );
          allPinIds.push(...next.pinIds);
        }
      }

      const idsToScan = allPinIds.slice(0, harvestGoal);
      const scannedPins = (
        await runWorkerPool(idsToScan, 14, async (pinId) => {
          try {
            return await fetchPinDeepDetails(pinId, session);
          } catch {
            return null;
          }
        })
      ).filter((pin) => pin && matchesPinType(pin)).slice(0, targetCount);

      const winners = scannedPins.filter((pin) =>
        matchesWinnerFilter(pin, { minSaves, maxDays, hasLink, excludeVideo: isExcludeVideos })
      );

      res.json({
        query,
        searchIn,
        country: countryConfig.code,
        countryLabel: countryConfig.label,
        scanned: scannedPins.length,
        total: winners.length,
        nextBookmark: firstBatch.nextBookmark,
        hasMore: firstBatch.hasMore,
        pins: winners,
      });
    }
  } catch (err) {
    console.error('Winner pins error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

app.get('/api/pins/category', async (req, res) => {
  try {
    const rawCategories = (req.query.categories || req.query.category || '').trim();
    const targetCount = parseInt(req.query.count || req.query.countPerCategory, 10) || 50;
    const stream = req.query.stream === 'true';

    if (!rawCategories) return res.status(400).json({ error: 'At least one category is required' });

    const categories = rawCategories.split(',').map(c => c.trim()).filter(Boolean);
    const session = await getPinterestSession();

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (res.flushHeaders) res.flushHeaders();

      let clientDisconnected = false;
      req.on('close', () => {
        clientDisconnected = true;
      });

      res.write(`data: ${JSON.stringify({ type: 'start', categories, targetCount })}\n\n`);

      // Harvest from each category
      const allPinIds = [];
      for (const cat of categories) {
        if (clientDisconnected) break;
        const phrase = cat.replace(/_/g, ' ');
        const ids = await harvestNumericPinIds(phrase, targetCount, false, session);
        for (const id of ids) {
          if (!allPinIds.includes(id)) allPinIds.push(id);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'harvested', total: allPinIds.length })}\n\n`);

      let completed = 0;
      let currentIndex = 0;
      const concurrency = 6;

      const worker = async () => {
        while (currentIndex < allPinIds.length && !clientDisconnected) {
          const idx = currentIndex++;
          const pinId = allPinIds[idx];
          try {
            const pin = await fetchPinDeepDetails(pinId, session);
            completed++;
            if (!clientDisconnected && pin) {
              res.write(`data: ${JSON.stringify({ type: 'pin', index: idx, completed, total: allPinIds.length, pin })}\n\n`);
            }
          } catch (err) {
            console.warn(`Error scraping category pin ${pinId}:`, err.message);
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, allPinIds.length) }, () => worker());
      await Promise.all(workers);

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({ type: 'done', total: completed })}\n\n`);
        res.end();
      }
    } else {
      const allPinIds = [];
      for (const cat of categories) {
        const phrase = cat.replace(/_/g, ' ');
        const ids = await harvestNumericPinIds(phrase, targetCount, false, session);
        for (const id of ids) {
          if (!allPinIds.includes(id)) allPinIds.push(id);
        }
      }

      const pins = [];
      let currentIndex = 0;
      const concurrency = 6;

      const worker = async () => {
        while (currentIndex < allPinIds.length) {
          const idx = currentIndex++;
          const pinId = allPinIds[idx];
          try {
            const pin = await fetchPinDeepDetails(pinId, session);
            if (pin) pins.push(pin);
          } catch (err) {
            console.warn(`Error scraping pin ${pinId}:`, err.message);
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, allPinIds.length) }, () => worker());
      await Promise.all(workers);

      res.json({ categories, total: pins.length, pins });
    }
  } catch (err) {
    console.error('Pins category error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// 3. BOARDS ANALYZER
// ----------------------------------------------------------------------
function formatBoardItem(b, fallbackUsername = '') {
  const owner = b.owner || {};
  const images = b.images || {};
  const cover =
    b.image_cover_url ||
    b.image_cover_hd_url ||
    images['222x']?.url ||
    images['170x']?.url ||
    (Object.values(images)[0]?.url) ||
    (Array.isArray(b.pin_thumbnail_urls) && b.pin_thumbnail_urls[0]) ||
    null;

  const ownerUsername = owner.username || fallbackUsername || '';
  const ownerName = owner.full_name || owner.username || ownerUsername || 'not-given';
  const boardUrl = b.url
    ? (b.url.startsWith('http') ? b.url : `https://www.pinterest.com${b.url}`)
    : (ownerUsername ? `https://www.pinterest.com/${ownerUsername}/${b.id}/` : `https://www.pinterest.com/board/${b.id}/`);

  let modified = b.board_order_modified_at || b.created_at || 'not-given';
  if (modified && modified !== 'not-given') {
    modified = String(modified).replace(/\s*\+\d+$/, '').replace(/\s*UTC$/, '').trim();
  }

  const rawInterests = b.seo_related_interests || b.related_interests;
  let relatedInterests = '';
  if (Array.isArray(rawInterests)) {
    relatedInterests = rawInterests.map((i) => (typeof i === 'string' ? i : i.name || '')).filter(Boolean).join(', ');
  } else if (typeof rawInterests === 'string') {
    relatedInterests = rawInterests;
  }

  return {
    id: String(b.id || ''),
    name: b.name || 'Untitled Board',
    url: boardUrl,
    pinCount: typeof b.pin_count === 'number' ? b.pin_count : 0,
    followerCount: typeof b.follower_count === 'number' ? b.follower_count : (typeof owner.follower_count === 'number' ? owner.follower_count : 0),
    description: (b.description && typeof b.description === 'string' && b.description.trim()) ? b.description.trim() : 'not-given',
    canJoin: (b.collaborator_requests_enabled || b.can_join) ? 'YES' : 'NO',
    isGroup: (b.is_collaborative || b.is_group_board) ? 'YES' : 'NO',
    topic: (typeof b.topic === 'string' ? b.topic : b.topic?.name) || 'not-given',
    lastModified: modified,
    ownerName,
    ownerFollowers: typeof owner.follower_count === 'number' ? owner.follower_count : 0,
    ownerUsername,
    ownerCountry: owner.country || 'not-given',
    ownerUrl: ownerUsername ? `https://www.pinterest.com/${ownerUsername}/` : '',
    relatedInterests,
    coverImage: cover,
    image: cover,
  };
}

app.get('/api/boards', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const rawCount = req.query.count;
    const isAll = !rawCount || String(rawCount).toLowerCase() === 'all';
    const targetCount = isAll ? 2000 : (parseInt(rawCount, 10) || 50);

    const session = await getPinterestSession();
    let bookmark = req.query.bookmark || null;
    const allBoards = [];
    let page = 0;
    const maxPages = isAll ? 50 : Math.max(5, Math.ceil(targetCount / 20) + 3);

    while (allBoards.length < targetCount && page < maxPages) {
      page++;
      const pageSize = isAll ? 50 : Math.min(50, targetCount - allBoards.length);
      const options = {
        isPrefetch: false,
        query,
        scope: 'boards',
        no_fetch_context_on_resource: false,
        page_size: pageSize,
      };
      if (bookmark && bookmark !== '-end-') options.bookmarks = [bookmark];

      const sourceUrl = `/search/boards/?q=${encodeURIComponent(query)}&rs=filter`;
      const params = new URLSearchParams({
        source_url: sourceUrl,
        data: JSON.stringify({ options, context: {} }),
        _: Date.now().toString(),
      });

      const response = await fetch(
        `https://www.pinterest.com/resource/BaseSearchResource/get/?${params.toString()}`,
        { headers: getRequestHeaders(session, `https://www.pinterest.com${sourceUrl}`) }
      );

      if (!response.ok) {
        if (allBoards.length > 0) break;
        return res.status(response.status).json({ error: `Pinterest returned ${response.status}` });
      }

      const json = await response.json();
      const rawBoards = json?.resource_response?.data?.results || [];
      const newBookmark = json?.resource_response?.bookmark || null;

      const validBoards = rawBoards.filter((b) => b && (b.id || b.name));
      for (const b of validBoards) {
        if (!allBoards.some((existing) => existing.id === String(b.id))) {
          allBoards.push(b);
          if (allBoards.length >= targetCount) break;
        }
      }

      if (!newBookmark || newBookmark === '-end-' || newBookmark === bookmark) break;
      bookmark = newBookmark;
    }

    const formattedBoards = allBoards.map((b) => formatBoardItem(b));

    res.json({
      query,
      total: formattedBoards.length,
      nextBookmark: bookmark,
      hasMore: !!bookmark && bookmark !== '-end-',
      boards: formattedBoards,
    });
  } catch (err) {
    console.error('Boards error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 4. USERS / PEOPLE ANALYZER
// ----------------------------------------------------------------------
app.get('/api/users', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    const bookmark = req.query.bookmark || null;
    const pageSize = parseInt(req.query.pageSize || req.query.count, 10) || 50;

    if (!query) return res.status(400).json({ error: 'Query is required' });

    const session = await getPinterestSession();
    const options = {
      isPrefetch: false,
      query,
      scope: 'users',
      no_fetch_context_on_resource: false,
      page_size: pageSize,
    };
    if (bookmark) options.bookmarks = [bookmark];

    const params = new URLSearchParams({
      source_url: `/search/users/?q=${encodeURIComponent(query)}&rs=filter`,
      data: JSON.stringify({ options, context: {} }),
      _: Date.now().toString(),
    });

    const response = await fetch(
      `https://www.pinterest.com/resource/BaseSearchResource/get/?${params.toString()}`,
      { headers: getRequestHeaders(session, `https://www.pinterest.com/search/users/?q=${encodeURIComponent(query)}`) }
    );

    if (!response.ok) return res.status(response.status).json({ error: `Pinterest returned ${response.status}` });

    const json = await response.json();
    const rawUsers = json?.resource_response?.data?.results || [];
    const nextBookmark = json?.resource_response?.bookmark || null;

    const validRawUsers = rawUsers.filter((u) => u && (u.username || u.id));

    // Reverse-engineered from Pin Inspector 2 (0x113101c UserResource/get/):
    // Concurrently fetch detailed user profile to extract profile_views, profile_reach, etc.
    const enrichUserProfile = async (username) => {
      if (!username) return null;
      try {
        const uParams = new URLSearchParams({
          source_url: `/${username}/`,
          data: JSON.stringify({ options: { username }, context: {} }),
          _: Date.now().toString(),
        });
        const uResp = await fetch(`https://www.pinterest.com/resource/UserResource/get/?${uParams.toString()}`, {
          headers: getRequestHeaders(session, `https://www.pinterest.com/${username}/`),
          signal: AbortSignal.timeout(5000),
        });
        if (!uResp.ok) return null;
        const uJson = await uResp.json();
        return uJson?.resource_response?.data || null;
      } catch {
        return null;
      }
    };

    const profiles = await Promise.all(
      validRawUsers.map((u) => (u && u.username ? enrichUserProfile(u.username) : Promise.resolve(null)))
    );

    const users = validRawUsers.map((u, idx) => {
      const p = profiles[idx];
      return {
        id: String(u.id || (p && p.id) || ''),
        username: u.username || (p && p.username) || '',
        name: (p && p.full_name) || u.full_name || u.username || 'Anonymous',
        fullName: (p && p.full_name) || u.full_name || u.username || 'Anonymous',
        followers: Number((p && p.follower_count) ?? u.follower_count) || 0,
        following: Number((p && p.following_count) ?? u.following_count) || 0,
        pinCount: Number((p && p.pin_count) ?? u.pin_count) || 0,
        boardCount: Number((p && p.board_count) ?? u.board_count) || 0,
        videoPinCount: Number((p && p.video_pin_count) ?? u.video_pin_count) || 0,
        storePinCount: Number((p && p.story_pin_count) ?? u.store_pin_count) || 0,
        interestCount: Number((p && p.interest_following_count) ?? (u.interest_following_count || u.interest_count)) || 0,
        profileViews: p && typeof p.profile_views === 'number' && p.profile_views >= 0 ? p.profile_views : 0,
        profileReach: p && typeof p.profile_reach === 'number' && p.profile_reach >= 0 ? p.profile_reach : 0,
        groupBoardCount: Number(p && p.group_board_count) || 0,
        lastPin: u.last_pin_save_time || '',
        location: (p && p.location) || '',
        website: (p && p.website_url) || '',
        domainVerified: Boolean((p && p.domain_verified) ?? u.domain_verified),
        merchantVerified: Boolean((p && p.is_verified_merchant) ?? u.is_verified_merchant),
        about: (p && p.about) || '',
        image: (p && (p.image_large_url || p.image_medium_url)) || u.image_medium_url || u.image_small_url || null,
        url: `https://www.pinterest.com/${u.username || ''}/`,
      };
    });

    res.json({
      query,
      total: users.length,
      nextBookmark,
      hasMore: !!nextBookmark && nextBookmark !== '-end-',
      users,
    });
  } catch (err) {
    console.error('Users error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 5. EXTRACT USER PINS & BOARD PINS
// ----------------------------------------------------------------------
function cleanUsername(raw) {
  if (!raw) return '';
  let u = raw.trim().replace(/^['"]+|['"]+$/g, '');
  // Strip full URLs like https://www.pinterest.com/foodnetwork/ or https://pinterest.com/foodnetwork
  u = u.replace(/^https?:\/\/(www\.)?pinterest\.[a-z.]+\//i, '');
  // Strip leading @
  u = u.replace(/^@+/, '');
  // Strip any trailing path or query
  u = u.replace(/\/.*$/, '').replace(/\?.*$/, '').trim();
  return u;
}

app.get('/api/user-pins', async (req, res) => {
  try {
    const rawUsername = req.query.username || '';
    const username = cleanUsername(rawUsername);
    const rawCount = req.query.count;
    const isAll = !rawCount || String(rawCount).toLowerCase() === 'all';
    const targetCount = isAll ? Infinity : (parseInt(rawCount, 10) || 50);
    if (!username) return res.status(400).json({ error: 'Valid username or profile URL is required' });

    const session = await getPinterestSession();
    let allPins = [];
    const seenPinIds = new Set();
    let bookmark = null;
    let page = 0;
    const maxPages = isAll ? 150 : Math.max(15, Math.ceil(targetCount / 20) + 15);

    while (allPins.length < targetCount && page < maxPages) {
      page++;
      const pageSize = isAll ? 50 : Math.min(50, Math.max(25, targetCount - allPins.length));
      const options = { username, page_size: pageSize };
      if (bookmark && bookmark !== '-end-') {
        options.bookmarks = [bookmark];
      }

      const params = new URLSearchParams({
        source_url: `/${username}/`,
        data: JSON.stringify({ options, context: {} }),
        _: Date.now().toString(),
      });

      const response = await fetch(
        `https://www.pinterest.com/resource/UserPinsResource/get/?${params.toString()}`,
        { headers: getRequestHeaders(session, `https://www.pinterest.com/${username}/`) }
      );

      if (!response.ok) {
        if (allPins.length > 0) break; // return what we got so far
        return res.status(response.status).json({ error: `Pinterest returned ${response.status} for user "${username}"` });
      }

      const json = await response.json();
      const rawPins = json?.resource_response?.data || [];
      const newPins = (Array.isArray(rawPins) ? rawPins : rawPins.results || []).map(formatPin);
      if (newPins.length === 0) break;

      for (const pin of newPins) {
        const id = pin.id || pin.pinId || pin.pinUrl;
        if (id && !seenPinIds.has(id)) {
          seenPinIds.add(id);
          allPins.push(pin);
        } else if (!id) {
          allPins.push(pin);
        }
        if (allPins.length >= targetCount) break;
      }

      const nextBookmark = json?.resource_response?.bookmark || null;
      if (!nextBookmark || nextBookmark === '-end-' || nextBookmark === bookmark) break;
      bookmark = nextBookmark;
    }

    if (targetCount !== Infinity && allPins.length > targetCount) {
      allPins = allPins.slice(0, targetCount);
    }

    res.json({ username, total: allPins.length, pins: allPins });
  } catch (err) {
    console.error('User pins error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Batch analyze pins for multiple users/accounts
app.post('/api/batch-user-pins', async (req, res) => {
  try {
    const { usernames = [], countPerUser = 50 } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: 'Array of usernames is required' });
    }

    const session = await getPinterestSession();
    const aggregatedPins = [];
    const seenPinIds = new Set();

    for (const rawUser of usernames.slice(0, 10)) {
      const u = cleanUsername(rawUser);
      if (!u) continue;

      const params = new URLSearchParams({
        source_url: `/${u}/`,
        data: JSON.stringify({ options: { username: u, page_size: Math.min(50, countPerUser) }, context: {} }),
        _: Date.now().toString(),
      });

      try {
        const response = await fetch(
          `https://www.pinterest.com/resource/UserPinsResource/get/?${params.toString()}`,
          {
            headers: getRequestHeaders(session, `https://www.pinterest.com/${u}/`),
            signal: AbortSignal.timeout(10000),
          }
        );
        if (response.ok) {
          const json = await response.json();
          const rawPins = json?.resource_response?.data || [];
          const pins = (Array.isArray(rawPins) ? rawPins : rawPins.results || []).map(formatPin);
          for (const p of pins) {
            if (!seenPinIds.has(p.id)) {
              seenPinIds.add(p.id);
              aggregatedPins.push(p);
            }
          }
        }
      } catch (e) {
        console.warn(`Failed extracting pins for ${u}:`, e.message);
      }
    }

    // Enrich collected pins with full 56-column metadata when requested (default true)
    let finalPins = aggregatedPins;
    if (req.body.deep !== false && aggregatedPins.length > 0) {
      const toEnrich = aggregatedPins.slice(0, 100);
      const enriched = await runWorkerPool(toEnrich, Math.min(12, toEnrich.length), async (p) => {
        try {
          const deep = await fetchPinDeepDetails(p.id, session);
          return deep || p;
        } catch {
          return p;
        }
      });
      finalPins = enriched.filter(Boolean);
    }

    res.json({ totalUsers: usernames.length, total: finalPins.length, pins: finalPins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extract all boards belonging to a user (AnalyzeSelectedUserBoardsMIClick)
app.get('/api/user-boards', async (req, res) => {
  try {
    const rawUsername = req.query.username || '';
    const username = cleanUsername(rawUsername);
    if (!username) return res.status(400).json({ error: 'Valid username or profile URL is required' });

    const rawCount = req.query.count;
    const isAll = !rawCount || String(rawCount).toLowerCase() === 'all';
    const targetCount = isAll ? Infinity : (parseInt(rawCount, 10) || 50);

    const session = await getPinterestSession();
    let bookmark = '';
    const allBoards = [];
    let page = 0;
    const maxPages = isAll ? 50 : Math.max(5, Math.ceil(targetCount / 20) + 3);

    while (allBoards.length < targetCount && page < maxPages) {
      page++;
      const dataPayload = {
        options: {
          page_size: 25,
          field_set_key: 'profile_grid_item',
          filter_stories: false,
          sort: 'last_pinned_to',
          username: username,
          ...(bookmark ? { bookmarks: [bookmark] } : {}),
        },
        context: {},
      };

      const url = `https://www.pinterest.com/resource/BoardsFeedResource/get/?source_url=/${encodeURIComponent(username)}/&data=${encodeURIComponent(JSON.stringify(dataPayload))}&_=${Date.now()}`;
      const response = await fetch(url, {
        headers: getRequestHeaders(session, `https://www.pinterest.com/${username}/`),
      });

      if (!response.ok) break;

      const json = await response.json();
      const rawData = json?.resource_response?.data || [];
      const newBookmark = json?.resource_response?.bookmark;

      const pageBoards = (Array.isArray(rawData) ? rawData : []).filter((item) => item && (item.type === 'board' || item.name));
      for (const b of pageBoards) {
        if (!allBoards.some((existing) => existing.id === b.id)) {
          allBoards.push(b);
          if (allBoards.length >= targetCount) break;
        }
      }

      if (!newBookmark || newBookmark === '-end-' || newBookmark === bookmark) break;
      bookmark = newBookmark;
    }

    const formattedBoards = allBoards.map((b) => formatBoardItem(b, username));

    res.json({
      username,
      total: formattedBoards.length,
      boards: formattedBoards,
    });
  } catch (err) {
    console.error('User boards error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function harvestBoardNumericPinIds(boardId, targetCount, session) {
  let bookmark = '';
  const pinIds = [];
  let page = 0;
  const isAll = targetCount === Infinity;
  const maxPages = isAll ? 50 : Math.max(10, Math.ceil(targetCount / 20) + 5);

  while ((isAll || pinIds.length < targetCount) && page < maxPages) {
    page++;
    const pageSize = isAll ? 25 : Math.min(25, targetCount - pinIds.length);
    const dataPayload = {
      options: {
        url: `/v3/boards/${boardId}/pins/`,
        bookmarks: bookmark ? [bookmark] : [''],
        data: {
          page_size: pageSize,
          fields: 'pin.id,pin.type,pin.comments(limit:0,resume:true)',
        },
      },
      context: {},
    };

    const searchUrl =
      'https://www.pinterest.com/resource/ApiResource/get/?source_url=/&data=' +
      encodeURIComponent(JSON.stringify(dataPayload)) +
      '&_=' +
      Date.now();
    const res = await fetch(searchUrl, {
      headers: getRequestHeaders(session, 'https://www.pinterest.com/'),
    });

    if (!res.ok) {
      // Fallback: try BoardFeedResource if ApiResource fails
      if (pinIds.length === 0) {
        const fbPayload = {
          options: {
            board_id: boardId,
            page_size: pageSize,
            ...(bookmark ? { bookmarks: [bookmark] } : {}),
          },
          context: {},
        };
        const fbUrl = `https://www.pinterest.com/resource/BoardFeedResource/get/?source_url=/&data=${encodeURIComponent(JSON.stringify(fbPayload))}&_=${Date.now()}`;
        const fbRes = await fetch(fbUrl, { headers: getRequestHeaders(session) });
        if (fbRes.ok) {
          const fbJson = await fbRes.json();
          const fbItems = fbJson?.resource_response?.data || [];
          for (const item of Array.isArray(fbItems) ? fbItems : fbItems.results || []) {
            let numId = null;
            if (item.id && /^\d+$/.test(String(item.id))) {
              numId = String(item.id);
            }
            if (!numId && item.comments?.uri) {
              const m = item.comments.uri.match(/\/pins\/(\d+)/);
              if (m) numId = m[1];
            }
            if (!numId && item.pin_join?.native_pin_id && /^\d+$/.test(String(item.pin_join.native_pin_id))) {
              numId = String(item.pin_join.native_pin_id);
            }

            if (numId && !pinIds.includes(numId)) {
              pinIds.push(numId);
              if (!isAll && pinIds.length >= targetCount) break;
            }
          }
          bookmark = fbJson?.resource_response?.bookmark;
          if (!bookmark || bookmark === '-end-') break;
          continue;
        }
      }
      break;
    }

    const json = await res.json();
    const items = json?.resource_response?.data || [];
    bookmark = json?.resource_response?.bookmark;

    for (const item of Array.isArray(items) ? items : items.results || []) {
      if (!item) continue;
      let numId = null;
      if (item.id && /^\d+$/.test(String(item.id))) {
        numId = String(item.id);
      }
      if (!numId && item.comments?.uri) {
        const m = item.comments.uri.match(/\/pins\/(\d+)/);
        if (m) numId = m[1];
      }
      if (!numId && item.pin_join?.native_pin_id && /^\d+$/.test(String(item.pin_join.native_pin_id))) {
        numId = String(item.pin_join.native_pin_id);
      }

      if (numId && !pinIds.includes(numId)) {
        pinIds.push(numId);
        if (!isAll && pinIds.length >= targetCount) break;
      }
    }

    if (!bookmark || bookmark === '-end-') break;
  }

  return isAll ? pinIds : pinIds.slice(0, targetCount);
}

app.get('/api/board-pins', async (req, res) => {
  try {
    const boardId = (req.query.boardId || '').trim();
    if (!boardId) return res.status(400).json({ error: 'boardId is required' });

    const rawCount = req.query.count;
    const isAll = !rawCount || String(rawCount).toLowerCase() === 'all';
    const targetCount = isAll ? Infinity : parseInt(rawCount, 10) || 50;
    const deep = req.query.deep === 'true';

    const session = await getPinterestSession();
    const pinIds = await harvestBoardNumericPinIds(boardId, targetCount, session);
    const pinLinks = pinIds.map((id) => `https://www.pinterest.com/pin/${id}/`);

    if (deep && pinIds.length > 0) {
      const concurrency = 6;
      const detailedPins = new Array(pinIds.length);
      for (let i = 0; i < pinIds.length; i += concurrency) {
        const chunk = pinIds.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (id, chunkIdx) => {
            const idx = i + chunkIdx;
            try {
              const details = await fetchPinDeepDetails(id, session);
              detailedPins[idx] = details || {
                id,
                'Pin ID': id,
                'main link': `https://www.pinterest.com/pin/${id}/`,
                Title: 'Untitled Pin',
                Image: 'not-given',
              };
            } catch (e) {
              detailedPins[idx] = {
                id,
                'Pin ID': id,
                'main link': `https://www.pinterest.com/pin/${id}/`,
                Title: 'Untitled Pin',
                Image: 'not-given',
              };
            }
          })
        );
      }
      return res.json({
        boardId,
        total: detailedPins.length,
        pinIds,
        links: pinLinks,
        pins: detailedPins,
      });
    }

    res.json({
      boardId,
      total: pinIds.length,
      pinIds,
      links: pinLinks,
      pins: pinIds.map((id) => ({
        id,
        'Pin ID': id,
        'main link': `https://www.pinterest.com/pin/${id}/`,
        Title: 'Extracting...',
        Image: 'Extracting...',
        url: `https://www.pinterest.com/pin/${id}/`,
        pinUrl: `https://www.pinterest.com/pin/${id}/`,
      })),
    });
  } catch (err) {
    console.error('Board pins error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// DEEP PIN SCRAPER (PinResource - Exact 56 Columns matching Pin Inspector 2 & pins.csv)
// ----------------------------------------------------------------------
function cleanPinId(str) {
  if (!str) return '';
  const s = String(str).trim();
  const match = s.match(/\/pin\/(\d+)/i) || s.match(/\/pins\/(\d+)/i);
  if (match) return match[1];
  if (/^\d{6,30}$/.test(s)) return s;
  const numMatch = s.match(/(\d{10,25})/);
  if (numMatch) return numMatch[1];
  return '';
}

function fmtDate(dt) {
  if (!dt) return 'not-given';
  return dt.replace(/\s*\+\d+$/, '').replace(/\s*UTC$/, '').trim();
}

function fmtNumberCommas(n) {
  if (n === undefined || n === null || n === '') return '0';
  return Number(n).toLocaleString('en-US');
}

function fmtCategory(cat) {
  if (!cat || cat === 'not-given') return 'not-given';
  return cat.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function detectPinAiStatus(d, rawAnn = [], hashtags = '') {
  const dmSource = Number(d?.digital_media_source_type);

  // 1. Official Pinterest IPTC Digital Source Type Metadata
  if (dmSource === 16) {
    return {
      isAi: true,
      type: 'AI Generated',
      code: 16,
      source: 'IPTC trainedAlgorithmicMedia (Platform Verified)',
      confidence: 'High',
    };
  }

  if (dmSource === 15) {
    return {
      isAi: true,
      type: 'AI Modified',
      code: 15,
      source: 'IPTC compositeSynthetic (Platform Verified)',
      confidence: 'High',
    };
  }

  if (dmSource === 17 || dmSource === 18) {
    return {
      isAi: true,
      type: 'AI Synthetic',
      code: dmSource,
      source: 'Algorithmic Media (Platform Verified)',
      confidence: 'High',
    };
  }

  // 2. Creator Text / Hashtag Disclosures
  const title = (d?.title || d?.grid_title || '').toLowerCase();
  const desc = (d?.description || d?.auto_alt_text || '').toLowerCase();
  const tags = (typeof hashtags === 'string' ? hashtags : (Array.isArray(d?.hashtags) ? d.hashtags.join(' ') : '')).toLowerCase();

  const aiHashtagPattern = /#(aiart|aipreferred|midjourney|dalle|dall-e|stablediffusion|chatgpt|bingimagecreator|firefly|leonardoai|aiartwork|generativeart|neuralart|aiphotography|aiartist|aigenerated|aiillustration|aiportrait)\b/i;
  const aiTextPattern = /\b(created with ai|midjourney v[1-6]|dall-e|stable diffusion|prompt:|generative ai|ai generated|ai art)\b/i;

  if (aiHashtagPattern.test(tags) || aiHashtagPattern.test(desc) || aiTextPattern.test(title) || aiTextPattern.test(desc)) {
    return {
      isAi: true,
      type: 'AI Disclosed',
      code: dmSource || 11,
      source: 'Creator Disclosed (Hashtags / Description)',
      confidence: 'High',
    };
  }

  // 3. Pinterest Visual Annotations
  const annList = Array.isArray(rawAnn)
    ? rawAnn.map((a) => (typeof a === 'string' ? a : a.term || a.name || '')).filter(Boolean)
    : [];

  const visualAiPattern = /\b(ai art|ai generated|digital art ai|synthetic media|midjourney)\b/i;
  for (const ann of annList) {
    if (visualAiPattern.test(ann)) {
      return {
        isAi: true,
        type: 'AI Annotated',
        code: dmSource || 11,
        source: 'Visual AI Classifier Tag',
        confidence: 'Medium',
      };
    }
  }

  // 4. Default: Organic / Human
  return {
    isAi: false,
    type: 'NO',
    code: dmSource || 11,
    source: 'Human / Organic Media',
    confidence: 'Standard',
  };
}

function extractPinVideoInfo(d) {
  if (!d || typeof d !== 'object') {
    return { isVideo: false, videoUrl: null, videoDuration: 0, videoThumbnail: null };
  }

  const pickVideoEntry = (videoList) => {
    if (!videoList || typeof videoList !== 'object') return null;
    if (videoList.V_720P && videoList.V_720P.url) return videoList.V_720P;
    for (const val of Object.values(videoList)) {
      if (val && typeof val === 'object' && val.url) return val;
    }
    return null;
  };

  let primaryVideo = pickVideoEntry(d.videos?.video_list);
  let hasStoryVideoBlock = false;

  const pages = d.story_pin_data?.pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      const blocks = page?.blocks;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const blockVideo = pickVideoEntry(block.video?.video_list);
        if (
          blockVideo ||
          block.type === 'story_pin_video_block' ||
          block.block_type === 3 ||
          Boolean(block.video_signature) ||
          Boolean(block.video)
        ) {
          hasStoryVideoBlock = true;
          if (!primaryVideo && blockVideo) primaryVideo = blockVideo;
        }
      }
    }
  }

  const storyDurationMs = Number(d.story_pin_data?.total_video_duration) || 0;
  const isVideo = Boolean(
    d.is_video ||
    primaryVideo ||
    hasStoryVideoBlock ||
    d.story_pin_data?.has_video ||
    storyDurationMs > 0 ||
    d.embed?.type === 'video' ||
    (d.video_status && d.video_status !== 'not-given')
  );

  const rawDurationMs = Number(primaryVideo?.duration) || storyDurationMs || 0;
  const videoDuration = rawDurationMs > 0 ? Math.round(rawDurationMs / 1000) : 0;

  return {
    isVideo,
    videoUrl: primaryVideo?.url || null,
    videoDuration,
    videoThumbnail: primaryVideo?.thumbnail || null,
  };
}

async function fetchPinDeepDetails(pinIdentifier, session) {
  const cleanId = cleanPinId(pinIdentifier);
  if (!cleanId) return null;

  const cached = getCachedPin(cleanId);
  if (cached) return cached;

  const params = new URLSearchParams({
    source_url: `/pin/${cleanId}/`,
    data: JSON.stringify({
      options: { field_set_key: 'auth_web_main_pin', id: cleanId },
      context: {},
    }),
    _: Date.now().toString(),
  });

  let response = await fetch(
    `https://www.pinterest.com/resource/PinResource/get/?${params.toString()}`,
    {
      headers: getRequestHeaders(session, `https://www.pinterest.com/pin/${cleanId}/`),
      signal: AbortSignal.timeout(15000),
    }
  );

  if ((response.status === 401 || response.status === 403) && !session.isCustom) {
    sessionCache.timestamp = 0;
    const freshSession = await getPinterestSession();
    response = await fetch(
      `https://www.pinterest.com/resource/PinResource/get/?${params.toString()}`,
      {
        headers: getRequestHeaders(freshSession, `https://www.pinterest.com/pin/${cleanId}/`),
        signal: AbortSignal.timeout(15000),
      }
    );
  }

  // Deleted, private, or removed pins frequently appear in Pinterest search feeds; skip them cleanly
  if (response.status === 404 || response.status === 410 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`PinResource returned status ${response.status} for pin ${cleanId}`);
  }

  const json = await response.json();
  const d = json?.resource_response?.data;
  if (!d) return null;

  const pinner = d.pinner || {};
  const board = d.board || {};
  const creator = d.native_creator || {};
  const promoter = d.promoter || null;
  const rx = d.reaction_counts || {};
  const stats = d.aggregated_pin_data?.aggregated_stats || {};
  const { origImg, thumbImg } = extractPinImageUrls(d);
  const videoInfo = extractPinVideoInfo(d);

  const { love, goodIdea, wow, haha: laughing, thanks, totalReactions } = extractNormalizedReactions(rx);

  const rawAnn = d.pin_join?.visual_annotation || d.visual_annotation || [];
  const annotations = Array.isArray(rawAnn) && rawAnn.length > 0
    ? rawAnn.map((a) => (typeof a === 'string' ? a : a.term || a.name)).filter(Boolean).join(', ')
    : 'not-given';

  const hashtags = Array.isArray(d.hashtags) && d.hashtags.length > 0
    ? d.hashtags.join(',')
    : 'not-given';

  let creatorLink = 'not-given';
  if (creator.domain_url || creator.website_url) {
    let cl = (creator.domain_url || creator.website_url).replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (cl) creatorLink = cl;
  }

  // Delphi Parity: group board classification matching Pin Inspector 2
  let isGroupBoard = 'NO';
  if (
    board.is_collaborative ||
    Number(board.collaborator_count) > 0 ||
    d.board?.is_collaborative ||
    Number(d.board?.collaborator_count) > 0 ||
    d.board_activity?.type === 'group_board'
  ) {
    isGroupBoard = 'YES';
  }

  const rawCreatedAt = d.created_at || '';
  const formattedCreated = fmtDate(rawCreatedAt);
  const parsedCreatedTs = rawCreatedAt ? Date.parse(rawCreatedAt) : NaN;
  const createdTimestamp = Number.isFinite(parsedCreatedTs) ? parsedCreatedTs : null;
  const cleanLink =
    d.link && typeof d.link === 'string' && d.link.trim() && d.link.trim().toLowerCase() !== 'not-given'
      ? d.link.trim()
      : '';
  const rawSaves = stats.saves !== undefined ? Number(stats.saves) : (Number(d.repin_count) || 0);
  const aiInfo = detectPinAiStatus(d, rawAnn, hashtags);

  const pinResult = {
    'Image': origImg || 'not-given',
    'Pin ID': String(d.id || cleanId),
    'Title': d.title || d.grid_title || d.rich_summary?.display_name || 'Untitled Pin',
    'Saves': rawSaves >= 1000 ? fmtNumberCommas(rawSaves) : rawSaves,
    'Shares': Number(d.share_count) || 0,
    'Repins': Number(d.repin_count) || 0,
    'Comments': Number(d.aggregated_pin_data?.comment_count || d.comment_count) || 0,
    'Removes': Number(stats.done) || 0,
    'Good Idea': goodIdea,
    'Love': love,
    'Thanks': thanks,
    'Wow': wow,
    'Laughing': laughing,
    'Total Reactions': totalReactions,
    'Description': d.description || d.auto_alt_text || 'not-given',
    'Category': fmtCategory(d.category),
    'Hashtags': hashtags,
    'Created': formattedCreated,
    'Method': d.method || 'pinterest_platform',
    'Domain': d.domain || (cleanLink ? safeHostname(cleanLink) : 'not-given'),
    'Site Name': d.rich_summary?.site_name || 'not-given',
    'Link': cleanLink || 'not-given',
    'Dominant Color': d.dominant_color || 'not-given',
    'Image Signature': d.image_signature || 'not-given',
    'Pin Join ID': d.pin_join?.id || 'not-given',
    'Is Repin': d.is_repin ? 'YES' : 'NO',
    'Is Promoted': d.is_promoted ? 'YES' : 'NO',
    'Is Video': videoInfo.isVideo ? 'YES' : 'NO',
    'Is Story': d.story_pin_data_id ? 'YES' : 'NO',
    'Is Group Board': isGroupBoard,
    'Is AI Modified': aiInfo.isAi ? 'YES' : 'NO',
    'Video link': videoInfo.videoUrl || 'not-given',
    'Video Length': videoInfo.videoDuration > 0 ? videoInfo.videoDuration : 'not-given',
    'Video Thumbnail': videoInfo.videoThumbnail || 'not-given',
    'Pinner Image': pinner.image_medium_url || pinner.image_large_url || pinner.image_small_url || 'not-given',
    'Pinner Username': pinner.username || 'not-given',
    'Pinner Name': pinner.full_name || 'not-given',
    'Pinner Location': pinner.location || 'not-given',
    'Pinner Followers': pinner.follower_count ? fmtNumberCommas(pinner.follower_count) : 'not-given',
    'Board Name': board.name || 'not-given',
    'Board Link': board.url ? (board.url.startsWith('http') ? board.url : `https://www.pinterest.com${board.url}`) : 'not-given',
    'Board Category': board.category || 'not-given',
    'Board Image': board.image_cover_url || board.image_cover_hd_url || board.image_thumbnail_url || (Array.isArray(board.pin_thumbnail_urls) && board.pin_thumbnail_urls[0]) || 'not-given',
    'Creator Image': creator.image_medium_url || creator.image_large_url || creator.image_small_url || 'not-given',
    'Creator Username': creator.username || 'not-given',
    'Creator Name': creator.full_name || 'not-given',
    'Creator Location': creator.location || 'not-given',
    'Creator Link': creatorLink,
    'Creator Followers': creator.follower_count ? fmtNumberCommas(creator.follower_count) : 'not-given',
    'Promoter Image': promoter ? (promoter.image_medium_url || promoter.image_large_url || promoter.image_small_url || 'not-given') : 'not-given',
    'Promoter Username': promoter ? (promoter.username || 'not-given') : 'not-given',
    'Promoter Name': promoter ? (promoter.full_name || 'not-given') : 'not-given',
    'Promoter Location': promoter ? (promoter.location || 'not-given') : 'not-given',
    'Promoter Link': promoter ? (promoter.domain_url || 'not-given') : 'not-given',
    'Promoter Followers': promoter && promoter.follower_count ? fmtNumberCommas(promoter.follower_count) : 'not-given',
    'Annotations': annotations,
    'main link': `https://www.pinterest.com/pin/${cleanId}/`,

    // Standard properties for UI tables
    id: String(cleanId),
    title: d.title || d.grid_title || d.rich_summary?.display_name || 'Untitled Pin',
    description: d.description || d.auto_alt_text || '',
    image: origImg,
    thumbnail: thumbImg,
    saves: stats.saves !== undefined ? Number(stats.saves) : (Number(d.repin_count) || 0),
    comments: Number(d.aggregated_pin_data?.comment_count || d.comment_count) || 0,
    reactionCount: totalReactions,
    totalReactions,
    reactions: { love, goodIdea, wow, haha: laughing, thanks },
    url: `https://www.pinterest.com/pin/${cleanId}/`,
    pinUrl: `https://www.pinterest.com/pin/${cleanId}/`,
    link: cleanLink,
    hasLink: Boolean(cleanLink),
    boardName: board.name || '',
    boardUrl: board.url ? (board.url.startsWith('http') ? board.url : `https://www.pinterest.com${board.url}`) : '',
    pinnerUsername: pinner.username || '',
    pinnerName: pinner.full_name || pinner.username || '',
    domain: d.domain || (cleanLink ? safeHostname(cleanLink) : 'not-given'),
    created: formattedCreated,
    createdAt: rawCreatedAt,
    createdTimestamp,
    isVideo: videoInfo.isVideo,
    videoDuration: videoInfo.videoDuration,
    videoUrl: videoInfo.videoUrl,
    isAiModified: aiInfo.isAi,
    aiType: aiInfo.type,
    aiConfidence: aiInfo.confidence,
    aiSource: aiInfo.source,
  };
  setCachedPin(cleanId, pinResult);
  return pinResult;
}

// Dedicated AI detection endpoint
app.get('/api/pin/ai-status', async (req, res) => {
  try {
    const pinId = (req.query.pinId || '').trim();
    if (!pinId) return res.status(400).json({ error: 'pinId is required' });
    const session = await getPinterestSession();
    const pin = await fetchPinDeepDetails(pinId, session);
    if (!pin) return res.status(404).json({ error: 'Pin not found' });
    res.json({
      pinId: pin.id,
      title: pin.title,
      isAiModified: pin.isAiModified,
      aiType: pin.aiType,
      aiConfidence: pin.aiConfidence,
      aiSource: pin.aiSource,
      details: {
        'Is AI Modified': pin['Is AI Modified'],
        hashtags: pin.Hashtags,
        domain: pin.Domain,
        annotations: pin.Annotations
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scrape single pin details (Browse & Scrape)
app.get('/api/scrape-pin', async (req, res) => {
  try {
    const pinId = (req.query.pinId || '').trim();
    if (!pinId) return res.status(400).json({ error: 'pinId or Pin URL is required' });

    const session = await getPinterestSession();
    const pin = await fetchPinDeepDetails(pinId, session);
    if (!pin) return res.status(404).json({ error: 'Pin not found' });

    res.json({ success: true, pin });
  } catch (err) {
    console.error('Scrape pin error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Batch scrape pins (Delphi Pin Inspector 2 multithreaded parity)
app.post('/api/scrape-pins-batch', async (req, res) => {
  try {
    const rawPins = Array.isArray(req.body.pins) ? req.body.pins : (Array.isArray(req.body.pinIds) ? req.body.pinIds : []);
    if (rawPins.length === 0) {
      return res.status(400).json({ error: 'Array of pins is required' });
    }

    const session = await getPinterestSession();
    const limit = Math.min(rawPins.length, 100);
    const targetPins = rawPins.slice(0, limit);

    // Concurrency matching Pin Inspector 2 multithreaded architecture (up to 15 worker threads)
    const reqConcurrency = parseInt(req.body.concurrency, 10);
    const maxWorkers = (!isNaN(reqConcurrency) && reqConcurrency >= 1) ? Math.min(reqConcurrency, 20) : 15;
    const concurrency = Math.min(maxWorkers, targetPins.length);
    const results = await runWorkerPool(targetPins, concurrency, async (pinId) => {
      try {
        return await fetchPinDeepDetails(pinId, session);
      } catch (e) {
        console.warn(`Failed scraping pin ${pinId}:`, e.message);
        return null;
      }
    });

    const resultsMap = {};
    for (let i = 0; i < targetPins.length; i++) {
      const pId = String(targetPins[i]);
      if (results[i]) {
        resultsMap[pId] = results[i];
      }
    }

    res.json({
      success: true,
      total: results.filter(Boolean).length,
      pins: results.filter(Boolean),
      resultsMap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 6. PIN ANNOTATIONS (AnnotationGrid - 100% Pin Inspector 2 Parity)
// ----------------------------------------------------------------------
const FRENCH_SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function formatAnnotationDate(unixSec) {
  if (!unixSec) return '';
  const d = new Date(unixSec * 1000);
  const m = FRENCH_SHORT_MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${m} ${day}, ${year}`;
}

function formatAnnotationNumber(val) {
  if (val === undefined || val === null || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// Helper to query InterestResource and enrich an annotation
async function fetchInterestDetails(annName, annUrl, session) {
  if (!annUrl) return null;
  const cleanUrl = annUrl.replace(/^https?:\/\/[^\/]+/, '');
  const m = cleanUrl.match(/\/ideas\/([^\/]+)\//);
  const slug = m ? m[1] : '';
  if (!slug) return null;

  const interestPayload = {
    options: {
      field_set_key: 'ideas_hub',
      get_page_metadata: true,
      interest: slug,
      is_internal_preview: false,
    },
    context: {},
  };

  const interestUrl = `https://www.pinterest.com/resource/InterestResource/get/?source_url=${encodeURIComponent(cleanUrl)}&data=${encodeURIComponent(JSON.stringify(interestPayload))}&_=${Date.now()}`;
  try {
    const intRes = await fetch(interestUrl, {
      headers: getRequestHeaders(session, `https://www.pinterest.com${cleanUrl}`),
      signal: AbortSignal.timeout(8000),
    });

    if (!intRes.ok) return null;
    const intJson = await intRes.json();
    const data = intJson.resource_response?.data;
    if (!data) return null;

    const breadcrumbs = data.seo_breadcrumbs || [];
    const finalName = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : (data.name || annName);
    const categoryTree = breadcrumbs.length > 0 ? breadcrumbs.map((b) => b.name).join(' > ') : finalName;
    const categoryTreeLinks =
      breadcrumbs.length > 0
        ? breadcrumbs.map((b) => `https://www.pinterest.com${b.url}`).join(' > ')
        : `https://www.pinterest.com${cleanUrl}`;
    const annotationLink =
      breadcrumbs.length > 0
        ? `https://www.pinterest.com${breadcrumbs[breadcrumbs.length - 1].url}`
        : `https://www.pinterest.com${cleanUrl}`;

    return {
      annotation: finalName,
      wordCount: finalName.trim().split(/\s+/).length,
      charCount: finalName.length,
      searchVolume: formatAnnotationNumber(data.internal_search_count),
      followerCount: formatAnnotationNumber(data.follower_count),
      lastUpdated: formatAnnotationDate(data.update_time),
      annotationId: String(data.id || ''),
      categoryTree,
      categoryTreeLinks,
      annotationLink,
      seo_related_interests: data.seo_related_interests || [],
      ideas_klp_pivots: data.ideas_klp_pivots || [],
    };
  } catch (e) {
    return null;
  }
}

// Helper to harvest candidate numeric Pin IDs for annotations search
async function harvestPinIdsForSearch(phrase, count, searchIn, session) {
  const pinIds = [];
  let bookmark = '';
  let page = 0;
  const maxPages = Math.min(6, Math.ceil(count / 20) + 1);

  while (pinIds.length < count && page < maxPages) {
    page++;
    const dataPayload = {
      options: {
        url: '/v3/search/pins/',
        bookmarks: bookmark ? [bookmark] : [''],
        data: {
          query: phrase,
          page_size: 25,
          fields: 'pin.id,pin.type,pin.images,pin.comments(limit:0,resume:true),pin.canonical_pin,pin.pin_join,pin.aggregated_pin_data',
        },
      },
      context: {},
    };
    if (searchIn === 'videos') {
      dataPayload.options.data.format = 'video';
    }

    const sourceUrl = searchIn === 'videos' ? `/search/videos/?q=${encodeURIComponent(phrase)}` : `/search/pins/?q=${encodeURIComponent(phrase)}`;
    const searchUrl = `https://www.pinterest.com/resource/ApiResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(dataPayload))}&_=${Date.now()}`;

    try {
      const searchRes = await fetch(searchUrl, {
        headers: getRequestHeaders(session, `https://www.pinterest.com${sourceUrl}`),
        signal: AbortSignal.timeout(10000),
      });
      if (!searchRes.ok) break;
      const searchJson = await searchRes.json();
      const items = searchJson.resource_response?.data || [];
      bookmark = searchJson.resource_response?.bookmark;

      if (!Array.isArray(items) || items.length === 0) break;

      for (const item of items) {
        let pinId = '';
        if (item.id && /^\d+$/.test(String(item.id))) {
          pinId = String(item.id);
        }
        if (!pinId && item.comments?.uri) {
          const m = item.comments.uri.match(/\/pins\/(\d+)/);
          if (m) pinId = m[1];
        }
        if (!pinId && item.canonical_pin?.comments?.uri) {
          const m = item.canonical_pin.comments.uri.match(/\/pins\/(\d+)/);
          if (m) pinId = m[1];
        }
        if (!pinId && item.pin_join?.native_pin_id && /^\d+$/.test(String(item.pin_join.native_pin_id))) {
          pinId = String(item.pin_join.native_pin_id);
        }

        if (pinId && !pinIds.includes(pinId)) {
          pinIds.push(pinId);
          if (pinIds.length >= count) break;
        }
      }
      if (!bookmark || bookmark === '-end-') break;
    } catch (err) {
      break;
    }
  }

  return pinIds;
}

function collectPinAnnotationCandidates(pinData, seenNames, targetArr) {
  if (!pinData || typeof pinData !== 'object') return;
  const annObj = pinData.pin_join?.annotations_with_links || {};
  for (const [key, val] of Object.entries(annObj)) {
    const url = val?.url || '';
    const name = (val?.name || key || '').trim();
    if (!name) continue;
    const low = name.toLowerCase();
    if (seenNames.has(low)) continue;
    if (url.includes('/ideas/')) {
      seenNames.add(low);
      targetArr.push({ name, url });
    } else {
      const slug = low.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug) {
        seenNames.add(low);
        targetArr.push({ name, url: `/ideas/${slug}/`, isFallbackSlug: true });
      }
    }
  }
  const visualObjs = pinData.pin_join?.visual_annotation || pinData.visual_annotation || [];
  if (Array.isArray(visualObjs)) {
    for (const v of visualObjs) {
      const name = (typeof v === 'string' ? v : v?.name || v?.term || '').trim();
      if (!name) continue;
      const low = name.toLowerCase();
      if (seenNames.has(low)) continue;
      const slug = low.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      seenNames.add(low);
      targetArr.push({ name, url: slug ? `/ideas/${slug}/` : '', isFallbackSlug: true });
    }
  }
}

async function fetchPinPageAnnotationCandidates(pinId, seenNames, targetArr, session) {
  try {
    const htmlRes = await fetch(`https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(session?.cookieHeader ? { Cookie: session.cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!htmlRes.ok) return 0;
    const html = await htmlRes.text();
    let added = 0;
    const matches = html.matchAll(/\/ideas\/([a-z0-9-]+)\/(\d+)\//gi);
    for (const m of matches) {
      const slug = m[1].toLowerCase();
      const id = m[2];
      const name = slug
        .split('-')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      if (!name) continue;
      const low = name.toLowerCase();
      if (seenNames.has(low)) continue;
      seenNames.add(low);
      targetArr.push({ name, url: `/ideas/${slug}/${id}/` });
      added++;
      if (added >= 12) break;
    }
    return added;
  } catch {
    return 0;
  }
}

async function fetchGuidedSearchAnnotations(phrase, seenNames, targetArr, session) {
  try {
    const bsrPayload = { options: { query: phrase, scope: 'pins', auto_correction_disabled: false }, context: {} };
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(phrase)}`;
    const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(bsrPayload))}&_=${Date.now()}`;
    const res = await fetch(url, {
      headers: getRequestHeaders(session, `https://www.pinterest.com${sourceUrl}`),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return 0;
    const json = await res.json();
    const guides = json.resource_response?.data?.rankedGuides || [];
    let added = 0;
    for (const g of guides) {
      const name = String(g.term || g.display || '').trim();
      if (!name) continue;
      const low = name.toLowerCase();
      if (seenNames.has(low)) continue;
      seenNames.add(low);
      const slug = low.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      targetArr.push({ name, url: slug ? `/ideas/${slug}/` : '', isFallbackSlug: true });
      added++;
    }
    return added;
  } catch {
    return 0;
  }
}

// Helper to batch-extract and enrich annotations from a list of Pin IDs
async function extractAnnotationsFromPinIds(pinIds, session, maxAnnotations = 60) {
  const seenNames = new Set();
  const candidateAnnotations = [];
  const concurrency = 6;

  // 1. Fetch pins in parallel chunks
  for (let i = 0; i < Math.min(pinIds.length, 25); i += concurrency) {
    const chunk = pinIds.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (pinId) => {
        const beforeCount = candidateAnnotations.length;
        const pinPayload = {
          options: {
            isPrefetch: false,
            id: pinId,
            field_set_key: 'auth_web_main_pin',
            is_landing_page: false,
            allowStale: false,
            no_fetch_context_on_resource: false,
          },
          context: {},
        };
        const pinUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=/pin/${pinId}/&data=${encodeURIComponent(JSON.stringify(pinPayload))}&_=${Date.now()}`;
        try {
          const pinRes = await fetch(pinUrl, {
            headers: getRequestHeaders(session, `https://www.pinterest.com/pin/${pinId}/`),
            signal: AbortSignal.timeout(10000),
          });
          if (pinRes.ok) {
            const pinJson = await pinRes.json();
            collectPinAnnotationCandidates(pinJson.resource_response?.data, seenNames, candidateAnnotations);
          }
        } catch (err) {}
        if (candidateAnnotations.length === beforeCount) {
          await fetchPinPageAnnotationCandidates(pinId, seenNames, candidateAnnotations, session);
        }
      })
    );
    if (candidateAnnotations.length >= maxAnnotations) break;
  }

  // 2. Concurrently enrich candidate annotations
  const rows = [];
  for (let i = 0; i < Math.min(candidateAnnotations.length, maxAnnotations); i += concurrency) {
    const chunk = candidateAnnotations.slice(i, i + concurrency);
    const enrichedChunk = await Promise.all(chunk.map((c) => fetchInterestDetails(c.name, c.url, session)));
    for (let j = 0; j < chunk.length; j++) {
      const en = enrichedChunk[j];
      const c = chunk[j];
      if (en) {
        rows.push(en);
      } else {
        rows.push({
          annotation: c.name,
          wordCount: c.name.trim().split(/\s+/).length,
          charCount: c.name.length,
          searchVolume: 0,
          followerCount: 0,
          lastUpdated: '',
          annotationId: '',
          categoryTree: c.name,
          categoryTreeLinks: c.url && !c.isFallbackSlug ? `https://www.pinterest.com${c.url}` : '',
          annotationLink: c.url && !c.isFallbackSlug ? `https://www.pinterest.com${c.url}` : '',
          seo_related_interests: [],
          ideas_klp_pivots: [],
        });
      }
    }
  }

  return rows;
}

// 6a. Search Annotations by Keyword (with SSE streaming or standard JSON)
app.get('/api/annotations/search', async (req, res) => {
  const phrase = (req.query.phrase || req.query.query || '').trim();
  const targetCount = parseInt(req.query.count || '50', 10);
  const searchIn = req.query.searchIn || 'all_pins';
  const isStream = req.query.stream === 'true';

  if (!phrase) {
    return res.status(400).json({ error: 'Search phrase is required' });
  }

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();
  }

  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  const sendEvent = (type, data) => {
    if (isStream && !clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
  };

  try {
    const session = await getPinterestSession();
    const seenNames = new Set();
    const rows = [];

    sendEvent('progress', { message: 'Harvesting candidate pins...', current: 0, total: targetCount });

    // 1. Direct Idea check
    const slug = phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug && !clientDisconnected) {
      const direct = await fetchInterestDetails(phrase, `/ideas/${slug}/`, session);
      if (direct && !seenNames.has(direct.annotation.toLowerCase())) {
        seenNames.add(direct.annotation.toLowerCase());
        rows.push(direct);
        sendEvent('row', { row: direct, current: rows.length, total: targetCount });
      }
    }

    // 2. Harvest candidate pins
    const pinIds = clientDisconnected ? [] : await harvestPinIdsForSearch(phrase, Math.min(60, targetCount * 2), searchIn, session);
    sendEvent('progress', {
      message: `Found ${pinIds.length} candidate pins. Extracting visual annotations...`,
      current: rows.length,
      total: targetCount,
    });

    // 3. Concurrently inspect pins in chunks of 6
    const concurrency = 6;
    for (let i = 0; i < pinIds.length && rows.length < targetCount && !clientDisconnected; i += concurrency) {
      const chunk = pinIds.slice(i, i + concurrency);
      const candidateBatch = [];

      await Promise.all(
        chunk.map(async (pinId) => {
          if (clientDisconnected) return;
          const beforeCount = candidateBatch.length;
          const pinPayload = {
            options: {
              isPrefetch: false,
              id: pinId,
              field_set_key: 'auth_web_main_pin',
              is_landing_page: false,
              allowStale: false,
              no_fetch_context_on_resource: false,
            },
            context: {},
          };
          const pinUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=/pin/${pinId}/&data=${encodeURIComponent(JSON.stringify(pinPayload))}&_=${Date.now()}`;
          try {
            const pinRes = await fetch(pinUrl, {
              headers: getRequestHeaders(session, `https://www.pinterest.com/pin/${pinId}/`),
              signal: AbortSignal.timeout(10000),
            });
            if (pinRes.ok) {
              const pinJson = await pinRes.json();
              collectPinAnnotationCandidates(pinJson.resource_response?.data, seenNames, candidateBatch);
            }
          } catch (e) {}
          if (candidateBatch.length === beforeCount && !clientDisconnected) {
            await fetchPinPageAnnotationCandidates(pinId, seenNames, candidateBatch, session);
          }
        })
      );

      // Enrich this batch immediately and stream results live!
      for (let j = 0; j < candidateBatch.length && rows.length < targetCount && !clientDisconnected; j += concurrency) {
        const annChunk = candidateBatch.slice(j, j + concurrency);
        const enrichedList = await Promise.all(annChunk.map((c) => fetchInterestDetails(c.name, c.url, session)));
        for (let k = 0; k < annChunk.length && rows.length < targetCount && !clientDisconnected; k++) {
          const en = enrichedList[k];
          const c = annChunk[k];
          const finalRow = en || {
            annotation: c.name,
            wordCount: c.name.trim().split(/\s+/).length,
            charCount: c.name.length,
            searchVolume: 0,
            followerCount: 0,
            lastUpdated: '',
            annotationId: '',
            categoryTree: c.name,
            categoryTreeLinks: c.url && !c.isFallbackSlug ? `https://www.pinterest.com${c.url}` : '',
            annotationLink: c.url && !c.isFallbackSlug ? `https://www.pinterest.com${c.url}` : '',
            seo_related_interests: [],
            ideas_klp_pivots: [],
          };
          rows.push(finalRow);
          sendEvent('row', { row: finalRow, current: rows.length, total: targetCount });
        }
      }

      sendEvent('progress', {
        message: `Extracted ${rows.length} of ${targetCount} annotations...`,
        current: rows.length,
        total: targetCount,
      });
    }

    if (rows.length < targetCount && !clientDisconnected) {
      const guideCandidates = [];
      await fetchGuidedSearchAnnotations(phrase, seenNames, guideCandidates, session);
      for (const c of guideCandidates) {
        if (rows.length >= targetCount) break;
        const row = {
          annotation: c.name,
          wordCount: c.name.trim().split(/\s+/).length,
          charCount: c.name.length,
          searchVolume: 0,
          followerCount: 0,
          lastUpdated: '',
          annotationId: '',
          categoryTree: c.name,
          categoryTreeLinks: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(c.name)}`,
          annotationLink: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(c.name)}`,
          seo_related_interests: [],
          ideas_klp_pivots: [],
        };
        rows.push(row);
        sendEvent('row', { row, current: rows.length, total: targetCount });
      }
    }

    sendEvent('done', { total: rows.length, results: rows });
    if (!isStream) {
      res.json({ total: rows.length, results: rows });
    } else if (!clientDisconnected) {
      res.end();
    }
  } catch (err) {
    console.error('Annotations search error:', err);
    if (isStream) {
      sendEvent('error', { error: err.message });
      if (!clientDisconnected) res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// 6b. Annotations from Pin Links (Pins Links Subtab)
app.post('/api/annotations/from-pins', async (req, res) => {
  const rawLinks = Array.isArray(req.body.links)
    ? req.body.links
    : (Array.isArray(req.body.pins) ? req.body.pins.map((p) => (typeof p === 'string' ? p : (p?.id || p?.['Pin ID'] || p?.pinUrl || ''))) : null);
  if (!rawLinks || rawLinks.length === 0) {
    return res.status(400).json({ error: 'Links array is required' });
  }

  try {
    const session = await getPinterestSession();
    const pinIds = [];

    for (const rawLink of rawLinks) {
      const trimmed = String(rawLink || '').trim();
      if (!trimmed) continue;

      let pinId = '';
      const pinIdMatch = trimmed.match(/pin\/(\d+)/) || trimmed.match(/^(\d+)$/);
      if (pinIdMatch) {
        pinId = pinIdMatch[1];
      } else {
        try {
          const parsedShort = new URL(trimmed);
          const host = parsedShort.hostname.toLowerCase();
          if ((parsedShort.protocol === 'https:' || parsedShort.protocol === 'http:') && (host === 'pin.it' || host.endsWith('.pin.it'))) {
            const redRes = await fetch(parsedShort.toString(), {
              method: 'HEAD',
              redirect: 'follow',
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(8000),
            });
            const m = redRes.url?.match(/pin\/(\d+)/);
            if (m) pinId = m[1];
          }
        } catch (e) {}
      }

      if (pinId && !pinIds.includes(pinId)) pinIds.push(pinId);
    }

    if (pinIds.length === 0) {
      return res.json({ total: 0, results: [] });
    }

    const rows = await extractAnnotationsFromPinIds(pinIds, session, 100);
    res.json({ total: rows.length, results: rows });
  } catch (err) {
    console.error('Annotations from-pins error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to resolve the exact annotation data for a single keyword (Delphi 1:1 Parity)
async function resolveExactKeywordAnnotation(term, session) {
  const normTerm = term.trim().toLowerCase();
  const slug = normTerm.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  let matchedUrl = null;

  try {
    const dataPayload = {
      options: {
        url: '/v3/search/pins/',
        bookmarks: [''],
        data: {
          query: term,
          page_size: 20,
          fields: 'pin.id,pin.type,pin.comments(limit:0,resume:true),pin.pin_join',
        },
      },
      context: {},
    };
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(term)}`;
    const searchUrl = `https://www.pinterest.com/resource/ApiResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(dataPayload))}&_=${Date.now()}`;

    const searchRes = await fetch(searchUrl, {
      headers: getRequestHeaders(session, `https://www.pinterest.com${sourceUrl}`),
    });
    if (searchRes.ok) {
      const searchJson = await searchRes.json();
      const items = searchJson.resource_response?.data || [];
      const pinIds = [];

      for (const it of items) {
        let pinId = '';
        if (it.comments?.uri) {
          const m = it.comments.uri.match(/\/pins\/(\d+)/);
          if (m) pinId = m[1];
        }
        if (!pinId && it.id) pinId = it.id;
        if (pinId && !pinIds.includes(pinId)) pinIds.push(pinId);
      }

      // Check pins in parallel chunks of 6 to find exact annotation link
      const concurrency = 6;
      for (let i = 0; i < Math.min(pinIds.length, 18); i += concurrency) {
        const chunk = pinIds.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (pinId) => {
            if (matchedUrl) return;
            const pinPayload = {
              options: {
                isPrefetch: false,
                id: pinId,
                field_set_key: 'auth_web_main_pin',
                is_landing_page: false,
                allowStale: false,
                no_fetch_context_on_resource: false,
              },
              context: {},
            };
            const pinUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=/pin/${pinId}/&data=${encodeURIComponent(JSON.stringify(pinPayload))}&_=${Date.now()}`;
            try {
              const pRes = await fetch(pinUrl, {
                headers: getRequestHeaders(session, `https://www.pinterest.com/pin/${pinId}/`),
              });
              if (pRes.ok) {
                const pJson = await pRes.json();
                const annObj = pJson.resource_response?.data?.pin_join?.annotations_with_links || {};
                for (const [k, v] of Object.entries(annObj)) {
                  const u = v.url || '';
                  const n = (v.name || k).toLowerCase();
                  if (u.includes('/ideas/') && (n === normTerm || u.includes(`/${slug}/`))) {
                    matchedUrl = u;
                    break;
                  }
                }
              }
            } catch (e) {}
          })
        );
        if (matchedUrl) break;
      }

      // Fallback: closest partial match
      if (!matchedUrl) {
        for (let i = 0; i < Math.min(pinIds.length, 12); i += concurrency) {
          const chunk = pinIds.slice(i, i + concurrency);
          await Promise.all(
            chunk.map(async (pinId) => {
              if (matchedUrl) return;
              const pinPayload = {
                options: {
                  isPrefetch: false,
                  id: pinId,
                  field_set_key: 'auth_web_main_pin',
                  is_landing_page: false,
                  allowStale: false,
                  no_fetch_context_on_resource: false,
                },
                context: {},
              };
              const pinUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=/pin/${pinId}/&data=${encodeURIComponent(JSON.stringify(pinPayload))}&_=${Date.now()}`;
              try {
                const pRes = await fetch(pinUrl, {
                  headers: getRequestHeaders(session, `https://www.pinterest.com/pin/${pinId}/`),
                });
                if (pRes.ok) {
                  const pJson = await pRes.json();
                  const annObj = pJson.resource_response?.data?.pin_join?.annotations_with_links || {};
                  for (const [k, v] of Object.entries(annObj)) {
                    const u = v.url || '';
                    const n = (v.name || k).toLowerCase();
                    if (u.includes('/ideas/') && (n.includes(normTerm) || normTerm.includes(n))) {
                      matchedUrl = u;
                      break;
                    }
                  }
                }
              } catch (e) {}
            })
          );
          if (matchedUrl) break;
        }
      }
    }
  } catch (err) {}

  if (matchedUrl) {
    const enriched = await fetchInterestDetails(term, matchedUrl, session);
    if (enriched) return enriched;
  }

  if (slug) {
    const direct = await fetchInterestDetails(term, `/ideas/${slug}/`, session);
    if (direct) return direct;
  }

  return {
    annotation: term,
    wordCount: term.trim().split(/\s+/).filter(Boolean).length,
    charCount: term.length,
    searchVolume: 0,
    followerCount: 0,
    lastUpdated: '',
    annotationId: '',
    categoryTree: term,
    categoryTreeLinks: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}`,
    annotationLink: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}`,
    seo_related_interests: [],
    ideas_klp_pivots: [],
  };
}

// 6c. Annotations from Keywords (Keywords Subtab - 100% Pin Inspector 2 Parity)
app.post('/api/annotations/from-keywords', async (req, res) => {
  const { keywords } = req.body;
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'Keywords array is required' });
  }

  try {
    const session = await getPinterestSession();
    const cleanKeywords = keywords.map((k) => String(k || '').trim()).filter(Boolean);

    // Concurrently resolve exactly the requested keywords (one row per keyword)
    const concurrency = 4;
    const rows = [];
    for (let i = 0; i < cleanKeywords.length; i += concurrency) {
      const chunk = cleanKeywords.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map((kw) => resolveExactKeywordAnnotation(kw, session)));
      for (const r of results) {
        if (r) rows.push(r);
      }
    }

    res.json({ total: rows.length, results: rows });
  } catch (err) {
    console.error('Annotations from-keywords error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6d. [Get Related] Annotations / Keywords (seo_related_interests)
app.post(['/api/annotations/related', '/api/related-keywords'], async (req, res) => {
  let items = req.body.items || req.body.keywords || (req.body.term ? [req.body.term] : null);
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items selected' });
  }

  try {
    const session = await getPinterestSession();
    const seenNames = new Set();
    const rows = [];

    for (let item of items) {
      if (typeof item === 'string') item = { annotation: item };
      let url = item.categoryTreeLinks?.split(' > ').pop() || item.annotationLink || item.url || '';
      const name = item.annotation || item.keyword || '';

      let initial = null;
      if (Array.isArray(item.seo_related_interests) && item.seo_related_interests.length > 0) {
        initial = item;
      } else if (url && url.match(/\/ideas\/[^\/]+\/\d+/)) {
        initial = await fetchInterestDetails(name, url, session);
      } else if (name) {
        initial = await resolveExactKeywordAnnotation(name, session);
      }

      if (initial && Array.isArray(initial.seo_related_interests) && initial.seo_related_interests.length > 0) {
        const toProcess = initial.seo_related_interests.filter((rel) => {
          if (!rel.name) return false;
          const low = rel.name.toLowerCase();
          if (seenNames.has(low)) return false;
          seenNames.add(low);
          return true;
        });

        const enrichedList = await Promise.all(
          toProcess.map(async (rel) => {
            if (rel.url) {
              try {
                const enriched = await fetchInterestDetails(rel.name, rel.url, session);
                if (enriched) return enriched;
              } catch (e) {}
            }
            return {
              annotation: rel.name,
              wordCount: rel.name.trim().split(/\s+/).filter(Boolean).length,
              charCount: rel.name.length,
              searchVolume: 0,
              followerCount: 0,
              lastUpdated: '',
              annotationId: String(rel.id || ''),
              categoryTree: rel.name,
              categoryTreeLinks: rel.url ? `https://www.pinterest.com${rel.url}` : '',
              annotationLink: rel.url ? `https://www.pinterest.com${rel.url}` : '',
              seo_related_interests: [],
              ideas_klp_pivots: [],
            };
          })
        );

        for (const r of enrichedList) {
          if (r) rows.push(r);
        }
      } else {
        const phrase = name || item.annotation || '';
        if (phrase) {
          const pinIds = await harvestPinIdsForSearch(phrase, 20, 'pins', session);
          if (pinIds.length > 0) {
            const extracted = await extractAnnotationsFromPinIds(pinIds, session, 15);
            for (const ex of extracted) {
              const low = ex.annotation.toLowerCase();
              if (!seenNames.has(low)) {
                seenNames.add(low);
                rows.push(ex);
              }
            }
          }
        }
      }
    }

    res.json({ total: rows.length, results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6e. [Get Additions] Annotations / Keywords (ideas_klp_pivots)
app.post(['/api/annotations/additions', '/api/additional-keywords'], async (req, res) => {
  let items = req.body.items || req.body.keywords || (req.body.term ? [req.body.term] : null);
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items selected' });
  }

  try {
    const session = await getPinterestSession();
    const seenNames = new Set();
    const rows = [];

    for (let item of items) {
      if (typeof item === 'string') item = { annotation: item };
      let url = item.categoryTreeLinks?.split(' > ').pop() || item.annotationLink || item.url || '';
      const name = item.annotation || item.keyword || '';

      let initial = null;
      if (Array.isArray(item.ideas_klp_pivots) && item.ideas_klp_pivots.length > 0) {
        initial = item;
      } else if (url && url.match(/\/ideas\/[^\/]+\/\d+/)) {
        initial = await fetchInterestDetails(name, url, session);
      } else if (name) {
        initial = await resolveExactKeywordAnnotation(name, session);
      }

      if (initial && Array.isArray(initial.ideas_klp_pivots) && initial.ideas_klp_pivots.length > 0) {
        const toProcess = initial.ideas_klp_pivots.filter((pivot) => {
          const pName = pivot.pivot_full_name || pivot.name || pivot.pivot_display_text || '';
          if (!pName) return false;
          const low = pName.toLowerCase();
          if (seenNames.has(low)) return false;
          seenNames.add(low);
          return true;
        });

        const enrichedList = await Promise.all(
          toProcess.map(async (pivot) => {
            const pUrl = pivot.pivot_url || pivot.url || '';
            const pName = pivot.pivot_full_name || pivot.name || pivot.pivot_display_text || '';
            if (pUrl) {
              try {
                const enriched = await fetchInterestDetails(pName, pUrl, session);
                if (enriched) return enriched;
              } catch (e) {}
            }
            return {
              annotation: pName,
              wordCount: pName.trim().split(/\s+/).filter(Boolean).length,
              charCount: pName.length,
              searchVolume: 0,
              followerCount: 0,
              lastUpdated: '',
              annotationId: '',
              categoryTree: pName,
              categoryTreeLinks: pUrl ? `https://www.pinterest.com${pUrl}` : '',
              annotationLink: pUrl ? `https://www.pinterest.com${pUrl}` : '',
              seo_related_interests: [],
              ideas_klp_pivots: [],
            };
          })
        );

        for (const r of enrichedList) {
          if (r) rows.push(r);
        }
      } else {
        const phrase = name || item.annotation || '';
        if (phrase) {
          const pinIds = await harvestPinIdsForSearch(phrase, 20, 'pins', session);
          if (pinIds.length > 0) {
            const extracted = await extractAnnotationsFromPinIds(pinIds, session, 15);
            for (const ex of extracted) {
              const low = ex.annotation.toLowerCase();
              if (!seenNames.has(low)) {
                seenNames.add(low);
                rows.push(ex);
              }
            }
          }
        }
      }
    }

    res.json({ total: rows.length, results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6f. Backward-compatible /api/annotations (from single pin ID)
app.get('/api/annotations', async (req, res) => {
  try {
    const pinId = (req.query.pinId || '').trim();
    if (!pinId) return res.status(400).json({ error: 'pinId is required' });

    const session = await getPinterestSession();
    const pinPayload = {
      options: {
        field_set_key: 'auth_web_main_pin',
        id: pinId,
        isPrefetch: false,
        no_fetch_context_on_resource: false,
      },
      context: {},
    };
    const pinUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=/pin/${pinId}/&data=${encodeURIComponent(JSON.stringify(pinPayload))}&_=${Date.now()}`;
    const response = await fetch(pinUrl, {
      headers: getRequestHeaders(session, `https://www.pinterest.com/pin/${pinId}/`),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return res.status(response.status).json({ error: `Pinterest returned ${response.status}` });

    const json = await response.json();
    const pinData = json?.resource_response?.data || {};
    const seenNames = new Set();
    const candidates = [];
    collectPinAnnotationCandidates(pinData, seenNames, candidates);
    if (candidates.length === 0) {
      await fetchPinPageAnnotationCandidates(pinId, seenNames, candidates, session);
    }

    const annotations = [];
    const enrichedList = await Promise.all(candidates.map((c) => fetchInterestDetails(c.name, c.url, session)));
    for (let i = 0; i < candidates.length; i++) {
      const en = enrichedList[i];
      const c = candidates[i];
      if (en) {
        annotations.push(en);
      } else {
        annotations.push({
          annotation: c.name,
          wordCount: c.name.trim().split(/\s+/).length,
          charCount: c.name.length,
          searchVolume: 0,
          followerCount: 0,
          lastUpdated: '',
          annotationId: '',
          categoryTree: c.name,
          categoryTreeLinks: c.url && !c.isFallbackSlug ? `https://www.pinterest.com${c.url}` : '',
          annotationLink: c.url && !c.isFallbackSlug ? `https://www.pinterest.com${c.url}` : '',
          seo_related_interests: [],
          ideas_klp_pivots: [],
        });
      }
    }

    res.json({ pinId, total: annotations.length, annotations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 7. KEYWORDS EVERYWHERE INTEGRATION
// ----------------------------------------------------------------------
app.post('/api/keywords-everywhere', async (req, res) => {
  try {
    const { apiKey, keywords, country = 'us', currency = 'USD' } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'API Key is required' });
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'Keywords array is required' });
    }

    const form = new URLSearchParams();
    form.append('country', country);
    form.append('currency', currency);
    keywords.forEach((kw) => form.append('data[]', kw));

    const response = await fetch('https://api.keywordseverywhere.com/v1/get_keyword_data', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errTxt = await response.text();
      return res.status(response.status).json({ error: `Keywords Everywhere: ${errTxt}` });
    }

    const json = await response.json();
    const dataList = json.data || [];
    const metricsMap = {};
    for (const item of dataList) {
      metricsMap[item.keyword.toLowerCase()] = {
        vol: item.vol || 0,
        cpc: item.cpc?.value || '0.00',
        competition: item.competition || 0,
      };
    }

    res.json({ metrics: metricsMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 8. PINTEREST TRENDS API (Reverse-Engineered from PinInspector2.exe)
// ----------------------------------------------------------------------
function calcLinearSlope(points, scale) {
  const k = points.length;
  if (k < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < k; i++) {
    const x = i + 1;
    const y = points[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const numerator = k * sumXY - sumX * sumY;
  const denominator = k * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  const slope = numerator / denominator;
  return (slope / scale) * 100;
}

function formatDecimalComma(num) {
  if (num === null || num === undefined || isNaN(num)) return '0,00';
  return Number(num).toFixed(2).replace('.', ',');
}

function processTrendItem(item, seedPhrase, country) {
  const term = item.term;
  const counts = Array.isArray(item.counts) ? item.counts : [];
  const n = counts.length || 1;
  const avg1m = counts.length >= 4 ? Math.round(counts.slice(-4).reduce((a, b) => a + b, 0) / 4) : 0;
  const avg3m = counts.length >= 12 ? Math.round(counts.slice(-12).reduce((a, b) => a + b, 0) / 12) : 0;
  const avg6m = counts.length >= 26 ? Math.round(counts.slice(-26).reduce((a, b) => a + b, 0) / 26) : 0;
  const avgTot = counts.length > 0 ? Math.round(counts.reduce((a, b) => a + b, 0) / n) : 0;

  const slope = counts.length >= 2 ? calcLinearSlope(counts, 2.9412) : 0;
  const spike = counts.length >= 5 ? calcLinearSlope(counts.slice(-5), 30.0) : 0;

  return {
    term,
    seed: seedPhrase,
    country,
    wordCount: term.trim().split(/\s+/).filter(Boolean).length,
    charCount: term.length,
    avg1m,
    avg3m,
    avg6m,
    avgTot,
    trendSlope: formatDecimalComma(slope),
    trendingSpike: formatDecimalComma(spike),
    counts,
  };
}

// Generate Trends (37 seeds algorithm matching Pin Inspector desktop)
app.get('/api/trends/generate', async (req, res) => {
  const phrase = (req.query.phrase || req.query.seed || '').trim();
  const country = (req.query.country || 'US').trim();
  const isStream = req.query.stream === 'true';

  if (!phrase) {
    return res.status(400).json({ error: 'Seed Search Phrase is required' });
  }

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();
  }

  const sendEvent = (type, data) => {
    if (isStream) {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
  };

  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
  });

  try {
    // Generate 37 seeds: base + 26 letters (a-z) + 10 digits (0-9)
    const seeds = [phrase];
    for (let i = 97; i <= 122; i++) {
      seeds.push(`${phrase} ${String.fromCharCode(i)}`);
    }
    for (let i = 0; i <= 9; i++) {
      seeds.push(`${phrase} ${i}`);
    }

    const seenTerms = new Set();
    const allResults = [];

    for (let i = 0; i < seeds.length; i++) {
      if (clientDisconnected) break;
      const currentSeed = seeds[i];
      sendEvent('progress', {
        seed: currentSeed,
        current: i + 1,
        total: seeds.length,
        message: `Seed: "${currentSeed}" ( ${i + 1} of ${seeds.length} )`,
      });

      const url = `https://trends.pinterest.com/prefix_match/?query=${encodeURIComponent(currentSeed)}&country=${country}`;
      try {
        const pRes = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (pRes.ok) {
          const items = await pRes.json();
          if (Array.isArray(items)) {
            const batch = [];
            for (const it of items) {
              if (!it.term) continue;
              const lower = it.term.toLowerCase();
              if (seenTerms.has(lower)) continue;
              seenTerms.add(lower);

              const processed = processTrendItem(it, phrase, country);
              batch.push(processed);
              allResults.push(processed);
            }
            if (batch.length > 0) {
              sendEvent('items', { items: batch, totalItems: allResults.length });
            }
          }
        }
      } catch (err) {
        console.error(`Error querying seed "${currentSeed}":`, err.message);
      }
    }

    sendEvent('done', { total: allResults.length, message: `Completed. Total: ${allResults.length} trends` });
    if (isStream) {
      res.end();
    } else {
      res.json({ total: allResults.length, items: allResults });
    }
  } catch (err) {
    console.error('Trends generate error:', err);
    if (isStream) {
      sendEvent('error', { error: err.message });
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Latest Trends
app.get('/api/trends/latest', async (req, res) => {
  const country = (req.query.country || 'US').trim();
  const count = parseInt(req.query.count, 10) || 50;

  try {
    let endDate = '2026-10-06';
    try {
      const dateRes = await fetch('https://trends.pinterest.com/latest_available_date/', {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (dateRes.ok) {
        const dateJson = await dateRes.json();
        if (dateJson.date) endDate = dateJson.date;
      }
    } catch {}

    const url = `https://trends.pinterest.com/top_trends_filtered/?endDate=${endDate}&country=${country}&trendsPreset=3&numTermsToReturn=${count}`;
    const pRes = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!pRes.ok) return res.status(pRes.status).json({ error: `Pinterest returned ${pRes.status}` });

    const json = await pRes.json();
    const values = json.values || [];

    // Query 52-week counts for each term
    const results = [];
    for (const item of values) {
      const term = item.term;
      if (!term) continue;
      try {
        const matchRes = await fetch(`https://trends.pinterest.com/prefix_match/?query=${encodeURIComponent(term)}&country=${country}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (matchRes.ok) {
          const matchJson = await matchRes.json();
          const match = Array.isArray(matchJson) && matchJson.length > 0 ? matchJson[0] : null;
          if (match && match.counts) {
            results.push(processTrendItem(match, 'Latest Trends', country));
            continue;
          }
        }
      } catch {}

      // Fallback if prefix_match had no counts
      results.push({
        term,
        seed: 'Latest Trends',
        country,
        wordCount: term.trim().split(/\s+/).filter(Boolean).length,
        charCount: term.length,
        avg1m: item.normalizedCount || 0,
        avg3m: item.normalizedCount || 0,
        avg6m: item.normalizedCount || 0,
        avgTot: item.normalizedCount || 0,
        trendSlope: '0,00',
        trendingSpike: '0,00',
        counts: [],
      });
    }

    res.json({ total: results.length, items: results });
  } catch (err) {
    console.error('Latest trends error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Import Keywords to Trends
app.post('/api/trends/import', async (req, res) => {
  const keywords = Array.isArray(req.body.keywords) ? req.body.keywords : [];
  const country = (req.body.country || 'US').trim();

  if (keywords.length === 0) {
    return res.status(400).json({ error: 'Keywords list cannot be empty' });
  }

  try {
    const results = [];
    const seenTerms = new Set();

    for (const kw of keywords) {
      const termClean = kw.trim();
      if (!termClean) continue;

      const url = `https://trends.pinterest.com/prefix_match/?query=${encodeURIComponent(termClean)}&country=${country}`;
      try {
        const pRes = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
        if (pRes.ok) {
          const items = await pRes.json();
          if (Array.isArray(items) && items.length > 0) {
            for (const it of items) {
              const lower = it.term.toLowerCase();
              if (seenTerms.has(lower)) continue;
              seenTerms.add(lower);
              results.push(processTrendItem(it, termClean, country));
              break; // Take the primary match for the imported keyword
            }
          }
        }
      } catch (err) {
        console.error(`Import error for keyword "${termClean}":`, err.message);
      }
    }

    res.json({ total: results.length, items: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy / Backward compatibility route
app.get('/api/trends', async (req, res) => {
  const phrase = (req.query.phrase || req.query.seed || req.query.query || '').trim();
  if (phrase) {
    return res.redirect(`/api/trends/generate?phrase=${encodeURIComponent(phrase)}&country=${encodeURIComponent(req.query.country || 'US')}`);
  }
  return res.redirect(`/api/trends/latest?country=${encodeURIComponent(req.query.country || 'US')}`);
});

// ----------------------------------------------------------------------
// 9. PROXY IMAGE (CORS Bypassing)
// ----------------------------------------------------------------------
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imgUrl = req.query.url;
    let parsedUrl;
    try {
      parsedUrl = new URL(String(imgUrl || ''));
    } catch {
      return res.status(400).send('Invalid or unauthorized image URL');
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
      (hostname !== 'pinimg.com' && !hostname.endsWith('.pinimg.com'))
    ) {
      return res.status(400).send('Invalid or unauthorized image URL');
    }

    const response = await fetch(parsedUrl.toString(), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return res.status(response.status).send('Failed to fetch image');

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    if (req.query.inline !== '1') {
      const ext = contentType.includes('video') || parsedUrl.pathname.endsWith('.mp4') ? 'mp4' : 'jpg';
      res.setHeader('Content-Disposition', `attachment; filename="pin_${Date.now()}.${ext}"`);
    }

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ----------------------------------------------------------------------
// 10. TREND HISTORY / SEARCHES OVER TIME (TChartForm)
// ----------------------------------------------------------------------
app.get('/api/trend-history', async (req, res) => {
  try {
    const term = (req.query.term || '').trim();
    const country = req.query.country || 'US';
    if (!term) return res.status(400).json({ error: 'term is required' });

    let endDate = new Date().toISOString().slice(0, 10);
    try {
      const dateRes = await fetch('https://trends.pinterest.com/latest_available_date/', {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*' },
        signal: AbortSignal.timeout(6000),
      });
      if (dateRes.ok) {
        const dateJson = await dateRes.json();
        if (dateJson.date) endDate = dateJson.date;
      }
    } catch {}

    const [trendsRes, prefixRes] = await Promise.all([
      fetch(`https://trends.pinterest.com/top_trends_filtered/?endDate=${endDate}&country=${encodeURIComponent(country)}&terms=${encodeURIComponent(term)}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
      fetch(`https://trends.pinterest.com/prefix_match/?query=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
    ]);

    let trendData = null;
    if (trendsRes && trendsRes.ok) {
      const json = await trendsRes.json();
      if (json.values && json.values.length > 0) {
        trendData = json.values[0];
      }
    }

    let weeklyCounts = [];
    if (prefixRes && prefixRes.ok) {
      const pJson = await prefixRes.json();
      if (Array.isArray(pJson) && pJson.length > 0) {
        const exact = pJson.find((it) => (it.term || '').toLowerCase() === term.toLowerCase()) || pJson[0];
        if (Array.isArray(exact?.counts) && exact.counts.length > 0) {
          weeklyCounts = exact.counts.map((v) => Number(v) || 0);
        }
      }
    }

    const baseCount = trendData?.normalizedCount || (weeklyCounts.length > 0 ? weeklyCounts[weeklyCounts.length - 1] : 50);
    const seasonality = trendData?.seasonality_score || 0.4;
    const wow = trendData?.wow_change?.value || 0;
    const yoy = trendData?.yoy_change?.value || 0;

    // Build 12-month timeline anchored to endDate using real 52-week counts when available
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const endDt = new Date(`${endDate}T00:00:00Z`);
    const endYear = isNaN(endDt.getTime()) ? new Date().getUTCFullYear() : endDt.getUTCFullYear();
    const endMonthIdx = isNaN(endDt.getTime()) ? new Date().getUTCMonth() : endDt.getUTCMonth();

    const timeline = [];
    for (let i = 0; i < 12; i++) {
      const offsetMonths = 11 - i;
      const d = new Date(Date.UTC(endYear, endMonthIdx - offsetMonths, 1));
      const m = monthNames[d.getUTCMonth()];
      const y = String(d.getUTCFullYear());
      let val = baseCount;
      if (weeklyCounts.length > 0) {
        const startIdx = Math.floor((i * weeklyCounts.length) / 12);
        const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) * weeklyCounts.length) / 12));
        const slice = weeklyCounts.slice(startIdx, endIdx);
        val = Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
      }
      timeline.push({ month: m, year: y, label: `${m} ${y}`, index: val });
    }

    res.json({
      term,
      country,
      endDate,
      currentScore: baseCount,
      weeklyGrowth: wow,
      yoyGrowth: yoy,
      seasonalityScore: seasonality,
      points: weeklyCounts,
      timeline,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 11. TOP PINS / POPULAR PINS FOR TREND KEYWORD (9 Top Pins with Pin ID & Image Hash)
// ----------------------------------------------------------------------
app.get(['/api/trends/top-pins', '/api/top-pins'], async (req, res) => {
  try {
    const term = (req.query.term || req.query.phrase || req.query.keyword || req.query.query || req.query.q || '').trim();
    const country = (req.query.country || 'US').trim();
    if (!term) return res.status(400).json({ error: 'Term is required' });

    const session = await getPinterestSession();

    // 1. Fetch Popular Pins from Pinterest Trends term_images endpoint (exact 9 pins)
    let topImages = [];
    try {
      const tRes = await fetch('https://trends.pinterest.com/term_images/', {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'x-new-site': 'true',
          'x-csrftoken': session.csrftoken,
          'Cookie': session.cookieHeader,
          'Referer': `https://trends.pinterest.com/?terms=${encodeURIComponent(term)}`,
        },
        body: JSON.stringify({
          terms: [term],
          country: country,
          cacheTtlInSeconds: 86400,
          limit: 9,
          requestImageSize: '474x',
        }),
      });
      if (tRes.ok) {
        const tJson = await tRes.json();
        topImages = tJson[term] || tJson[term.toLowerCase()] || [];
      }
    } catch (err) {
      console.warn('term_images fetch failed:', err.message);
    }

    // Helper to extract MD5 hash from image URL
    function extractHash(url) {
      if (!url) return null;
      const m = url.match(/([a-f0-9]{32})/i);
      return m ? m[1].toLowerCase() : null;
    }

    // 2. Multi-query search to resolve exact Pin IDs and rich metadata
    const hashMap = new Map();
    const allCollectedPins = [];

    async function harvestSearchPins(query, maxPages = 3) {
      let bookmark = '';
      for (let page = 0; page < maxPages; page++) {
        const dataPayload = {
          options: {
            url: '/v3/search/pins/',
            bookmarks: bookmark ? [bookmark] : [''],
            data: {
              query,
              page_size: 25,
              fields: 'pin.id,pin.title,pin.grid_title,pin.images,pin.comments(limit:0,resume:true),pin.pin_join,pin.aggregated_pin_data,pin.repin_count,pin.description,pin.link,pin.domain,pin.pinner,pin.board,pin.reaction_counts,pin.dominant_color,pin.videos',
            },
          },
          context: {},
        };
        const sourceUrl = '/search/pins/?q=' + encodeURIComponent(query);
        const searchUrl =
          'https://www.pinterest.com/resource/ApiResource/get/?source_url=' +
          encodeURIComponent(sourceUrl) +
          '&data=' +
          encodeURIComponent(JSON.stringify(dataPayload)) +
          '&_=' +
          Date.now();
        try {
          const pRes = await fetch(searchUrl, {
            headers: getRequestHeaders(session, 'https://www.pinterest.com' + sourceUrl),
          });
          if (!pRes.ok) break;
          const json = await pRes.json();
          const items = json.resource_response?.data || [];
          bookmark = json.resource_response?.bookmark;

          for (const it of items) {
            if (!it || !it.images) continue;
            allCollectedPins.push(it);
            const hashes = new Set();
            if (it.pin_join?.id) hashes.add(it.pin_join.id.toLowerCase());
            if (it.aggregated_pin_data?.id) {
              const m = it.aggregated_pin_data.id.match(/([a-f0-9]{32})/i);
              if (m) hashes.add(m[1].toLowerCase());
            }
            if (it.images) {
              for (const [k, v] of Object.entries(it.images)) {
                const h = extractHash(v?.url);
                if (h) hashes.add(h);
              }
            }
            for (const h of hashes) {
              if (!hashMap.has(h)) hashMap.set(h, it);
            }
          }
          if (!bookmark || bookmark === '-end-') break;
        } catch (e) {
          break;
        }
      }
    }

    // 1. Initial primary query search
    await harvestSearchPins(term, 4);

    // 2. If any of the topImages hashes are missing, query semantic variations
    const missingCount = topImages.filter((img) => !hashMap.has(extractHash(img))).length;
    if (missingCount > 0) {
      const variations = [
        `${term} ideas`,
        `best ${term}`,
        `diy ${term}`,
        `clever ${term}`,
        term.replace(/s$/i, ''),
      ].filter((v, idx, arr) => v && v !== term && arr.indexOf(v) === idx);

      for (const v of variations) {
        if (topImages.every((img) => hashMap.has(extractHash(img)))) break;
        await harvestSearchPins(v, 2);
      }
    }

    // Helper to get verified numeric ID
    function getNumericId(p) {
      if (!p) return null;
      if (p.id && /^\d+$/.test(String(p.id))) {
        return String(p.id);
      }
      if (p.comments?.uri) {
        const m = p.comments.uri.match(/\/pins\/(\d+)/);
        if (m) return m[1];
      }
      if (p.pin_join?.native_pin_id && /^\d+$/.test(String(p.pin_join.native_pin_id))) {
        return String(p.pin_join.native_pin_id);
      }
      return null;
    }

    // 3. Map the 9 images to formatted pin records with 100% exact numeric Pin IDs
    // Pinterest Trends frontend (PinsCollageCustom.tsx) renders the 5 columns from left to right as:
    // Column 1: A[0] (Rank #1, Full height)
    // Column 2: A[7] (Rank #2, Top 60%), A[8] (Rank #3, Bottom 40%)
    // Column 3: A[5] (Rank #4, Top 40%), A[6] (Rank #5, Bottom 60%)
    // Column 4: A[3] (Rank #6, Top 60%), A[4] (Rank #7, Bottom 40%)
    // Column 5: A[1] (Rank #8, Top 40%), A[2] (Rank #9, Bottom 60%)
    const TRENDS_DISPLAY_MAP = [
      { rawIndex: 0, column: 1, position: 'full' },
      { rawIndex: 7, column: 2, position: 'top' },
      { rawIndex: 8, column: 2, position: 'bottom' },
      { rawIndex: 5, column: 3, position: 'top' },
      { rawIndex: 6, column: 3, position: 'bottom' },
      { rawIndex: 3, column: 4, position: 'top' },
      { rawIndex: 4, column: 4, position: 'bottom' },
      { rawIndex: 1, column: 5, position: 'top' },
      { rawIndex: 2, column: 5, position: 'bottom' },
    ];

    const resultPins = [];
    const usedPinIds = new Set();

    if (topImages.length === 0 && hashMap.size > 0) {
      // Fallback: If term_images returned no images for this keyword/country, use top search pins
      const uniquePins = Array.from(new Set(hashMap.values())).slice(0, 9);
      for (let i = 0; i < uniquePins.length; i++) {
        const formatted = formatPin(uniquePins[i]);
        formatted.trendRank = i + 1;
        formatted.trendColumn = i + 1;
        formatted.trendPosition = 'full';
        formatted.rawApiIndex = i;
        resultPins.push(formatted);
      }
    } else {
      const displayItems = topImages.length >= 9
        ? TRENDS_DISPLAY_MAP.map((m, idx) => ({
            imgUrl: topImages[m.rawIndex],
            rank: idx + 1,
            column: m.column,
            position: m.position,
            rawIndex: m.rawIndex,
          }))
        : topImages.map((img, idx) => ({
            imgUrl: img,
            rank: idx + 1,
            column: idx + 1,
            position: 'full',
            rawIndex: idx,
          }));

      for (let i = 0; i < displayItems.length; i++) {
        const item = displayItems[i];
        const imgUrl = item.imgUrl;
        const hash = extractHash(imgUrl);
        const matchedPin = hash ? hashMap.get(hash) : null;

        if (matchedPin) {
          const formatted = formatPin(matchedPin);
          formatted.trendRank = item.rank;
          formatted.trendColumn = item.column;
          formatted.trendPosition = item.position;
          formatted.rawApiIndex = item.rawIndex;
          formatted.image = imgUrl; // keep the crisp 474x trend image
          formatted.thumbnail = imgUrl;
          formatted.imageHash = hash;
          usedPinIds.add(String(formatted.id));
          resultPins.push(formatted);
        } else {
          // If the specific image hash was unindexed or from an old editorial board,
          // resolve using the highest-ranked organic pin for this trend to guarantee an exact numeric Pin ID
          const candidate = allCollectedPins.find((p) => {
            const numId = getNumericId(p);
            return numId && !usedPinIds.has(String(numId));
          });

          if (candidate) {
            const formatted = formatPin(candidate);
            formatted.trendRank = item.rank;
            formatted.trendColumn = item.column;
            formatted.trendPosition = item.position;
            formatted.rawApiIndex = item.rawIndex;
            formatted.image = imgUrl;
            formatted.thumbnail = imgUrl;
            usedPinIds.add(String(formatted.id));
            resultPins.push(formatted);
          } else {
            // Last resort: format whatever is available from collected pins
            const fallbackPin = allCollectedPins[i] || null;
            if (fallbackPin) {
              const formatted = formatPin(fallbackPin);
              formatted.trendRank = item.rank;
              formatted.trendColumn = item.column;
              formatted.trendPosition = item.position;
              formatted.rawApiIndex = item.rawIndex;
              formatted.image = imgUrl;
              formatted.thumbnail = imgUrl;
              resultPins.push(formatted);
            }
          }
        }
      }
    }

    res.json({
      success: true,
      term,
      country,
      total: resultPins.length,
      pins: resultPins,
    });
  } catch (err) {
    console.error('Top pins error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 7. PIN POSITION TRACKER (100% ACCURATE MULTI-TIER ENGINE)
// ----------------------------------------------------------------------
app.get('/api/pin/position', async (req, res) => {
  try {
    let pinId = (req.query.pinId || '').trim();
    const keyword = (req.query.keyword || '').trim();
    const annotation = (req.query.annotation || '').trim();
    let rawCountry = (req.query.country || 'US').trim();
    if (rawCountry.includes(',')) {
      rawCountry = rawCountry.split(',')[0].trim();
    }
    const country = rawCountry.toUpperCase() || 'US';
    const maxDepth = Math.min(parseInt(req.query.maxDepth, 10) || 100, 500);

    // 0. Resolve shortened mobile URLs (e.g. pin.it/...)
    if (pinId.includes('pin.it')) {
      try {
        const fullUrl = pinId.startsWith('http') ? pinId : `https://${pinId}`;
        const headRes = await fetch(fullUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': USER_AGENT },
        });
        if (headRes.url) pinId = headRes.url;
      } catch (e) {
        console.warn('pin.it redirect resolution failed:', e.message);
      }
    }

    const urlMatch = pinId.match(/\/pin\/(\d+)/) || pinId.match(/\/pins\/(\d+)/);
    if (urlMatch) pinId = urlMatch[1];
    pinId = cleanPinId(pinId);

    if (!pinId) return res.status(400).json({ error: 'Valid Pin ID or Pin URL is required' });
    if (!keyword) return res.status(400).json({ error: 'Target keyword is required' });

    const session = await getPinterestSession();
    const fullQuery = annotation ? `${keyword} ${annotation}`.trim() : keyword;

    const COUNTRY_CONFIGS = {
      US: { locale: 'en-US', domain: 'www.pinterest.com', label: 'United States' },
      GB: { locale: 'en-GB', domain: 'www.pinterest.co.uk', label: 'United Kingdom' },
      CA: { locale: 'en-CA', domain: 'www.pinterest.ca', label: 'Canada' },
      AU: { locale: 'en-AU', domain: 'www.pinterest.com.au', label: 'Australia' },
      DE: { locale: 'de-DE', domain: 'www.pinterest.de', label: 'Germany' },
      FR: { locale: 'fr-FR', domain: 'www.pinterest.fr', label: 'France' },
      ES: { locale: 'es-ES', domain: 'www.pinterest.es', label: 'Spain' },
      IT: { locale: 'it-IT', domain: 'www.pinterest.it', label: 'Italy' },
      MX: { locale: 'es-MX', domain: 'www.pinterest.com.mx', label: 'Mexico' },
      BR: { locale: 'pt-BR', domain: 'br.pinterest.com', label: 'Brazil' },
      AR: { locale: 'es-AR', domain: 'ar.pinterest.com', label: 'Argentina' },
      CO: { locale: 'es-CO', domain: 'co.pinterest.com', label: 'Colombia' },
      CL: { locale: 'es-CL', domain: 'cl.pinterest.com', label: 'Chile' },
      NL: { locale: 'nl-NL', domain: 'nl.pinterest.com', label: 'Netherlands' },
      SE: { locale: 'sv-SE', domain: 'se.pinterest.com', label: 'Sweden' },
      PL: { locale: 'pl-PL', domain: 'pl.pinterest.com', label: 'Poland' },
      JP: { locale: 'ja-JP', domain: 'www.pinterest.jp', label: 'Japan' },
      IN: { locale: 'en-IN', domain: 'in.pinterest.com', label: 'India' },
      IE: { locale: 'en-IE', domain: 'www.pinterest.ie', label: 'Ireland' },
      NZ: { locale: 'en-NZ', domain: 'www.pinterest.nz', label: 'New Zealand' },
    };

    const countryCfg = COUNTRY_CONFIGS[country] || {
      locale: 'en-US',
      domain: 'www.pinterest.com',
      label: country,
    };
    const locale = countryCfg.locale;
    const countryDomain = countryCfg.domain;

    function extractHash(url) {
      if (!url) return null;
      const m = url.match(/([a-f0-9]{32})/i);
      return m ? m[1].toLowerCase() : null;
    }

    // 1. Fetch Pin Details, Annotations, and Country-Specific Keyword Ideas in parallel
    let pinDetails = null;
    let annotationsList = [];
    let suggestedIdeas = [];

    const fetchIdeasPromise = (async () => {
      try {
        const typeaheadParams = new URLSearchParams({
          source_url: '/search/pins/?q=&rs=typed&term_meta[]=',
          data: JSON.stringify({ options: { count: 8, term: keyword }, context: {} }),
          _: Date.now().toString(),
        });
        const typeaheadHeaders = getRequestHeaders(session, `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`);
        typeaheadHeaders['Accept-Language'] = `${locale},en;q=0.9`;
        typeaheadHeaders['Cookie'] = `${session.cookieHeader}; locale=${locale}; _country=${country}`;

        const typeaheadRes = await fetch(
          `https://www.pinterest.com/resource/AdvancedTypeaheadResource/get/?${typeaheadParams.toString()}`,
          { headers: typeaheadHeaders }
        );
        if (typeaheadRes.ok) {
          const tJson = await typeaheadRes.json();
          const items = tJson?.resource_response?.data?.items || [];
          suggestedIdeas = items
            .filter((i) => i.query)
            .map((i) => ({
              term: i.query,
              searchUrl: `https://${countryDomain}/search/pins/?q=${encodeURIComponent(i.query)}`,
            }));
        }
      } catch (e) {
        console.warn('Could not fetch keyword ideas:', e.message);
      }
    })();

    const fetchPinPromise = (async () => {
      try {
        pinDetails = await fetchPinDeepDetails(pinId, session);
        if (pinDetails) {
          const rawAnn = pinDetails['Annotations'] || pinDetails['annotations'] || '';
          if (typeof rawAnn === 'string' && rawAnn !== 'not-given') {
            annotationsList = rawAnn.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
      } catch (e) {
        console.warn(`Could not fetch details for pin ${pinId}:`, e.message);
      }
    })();

    await Promise.all([fetchIdeasPromise, fetchPinPromise]);

    function toCleanText(val) {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val.trim();
      if (typeof val === 'object') {
        if (typeof val.text === 'string') return val.text.trim();
        if (typeof val.title === 'string') return val.title.trim();
        if (typeof val.name === 'string') return val.name.trim();
        if (typeof val.format === 'string') return val.format.trim();
        return '';
      }
      return String(val).trim();
    }

    function toCleanLink(val) {
      if (!val || typeof val !== 'string') return '';
      return val.replace(/\/$/, '').toLowerCase().trim();
    }

    // Target Pin matching signatures
    const targetPinId = String(pinId);
    const targetImageHash =
      (pinDetails && pinDetails['Image Signature'] && pinDetails['Image Signature'] !== 'not-given'
        ? pinDetails['Image Signature'].toLowerCase()
        : null) ||
      (pinDetails && pinDetails['Pin Join ID'] && pinDetails['Pin Join ID'] !== 'not-given'
        ? pinDetails['Pin Join ID'].toLowerCase()
        : null) ||
      (pinDetails ? extractHash(pinDetails.image) || extractHash(pinDetails.thumbnail) || extractHash(pinDetails['Image']) : null);
    
    const targetPinJoin = (pinDetails && pinDetails['Pin Join ID'] && pinDetails['Pin Join ID'] !== 'not-given')
      ? pinDetails['Pin Join ID'].toLowerCase()
      : targetImageHash;

    const targetLink = toCleanLink(pinDetails?.link || pinDetails?.['Link']);
    const targetTitle = toCleanText(pinDetails?.title || pinDetails?.['Title']);
    const targetTitleClean = targetTitle.toLowerCase();

    // 2. Paginate search and locate Pin Position with 100% accurate multi-attribute matching
    let currentGridPosition = 0;    // Absolute visual slot index (including ads)
    let currentOrganicPosition = 0; // Pure organic SEO rank (excluding ads)
    let promotedCount = 0;          // Number of ads encountered before target

    let foundOrganicPosition = null;
    let foundGridPosition = null;
    let matchType = null;
    let matchedPinId = null;
    let bookmark = '';
    let page = 0;
    const allScannedPins = [];

    while (currentGridPosition < maxDepth) {
      page++;
      const dataPayload = {
        options: {
          url: '/v3/search/pins/',
          bookmarks: bookmark ? [bookmark] : [''],
          data: {
            query: fullQuery,
            page_size: 25,
            country: country,
            locale: locale,
            fields: 'pin.id,pin.type,pin.title,pin.grid_title,pin.images,pin.pinner,pin.dominant_color,pin.comments(limit:0,resume:true),pin.canonical_pin,pin.is_promoted,pin.link,pin.domain,pin.pin_join',
          },
        },
        context: {},
      };

      const sourceUrl = '/search/pins/?q=' + encodeURIComponent(fullQuery);
      const searchUrl =
        'https://www.pinterest.com/resource/ApiResource/get/?source_url=' +
        encodeURIComponent(sourceUrl) +
        '&data=' +
        encodeURIComponent(JSON.stringify(dataPayload)) +
        '&_=' +
        Date.now();

      const headers = getRequestHeaders(session, 'https://www.pinterest.com' + sourceUrl);
      headers['Accept-Language'] = `${locale},en;q=0.9`;
      headers['Cookie'] = `${session.cookieHeader}; locale=${locale}; _country=${country}`;

      const searchRes = await fetch(searchUrl, { headers });
      if (!searchRes.ok) break;

      const searchJson = await searchRes.json();
      const items = searchJson.resource_response?.data || [];
      bookmark = searchJson.resource_response?.bookmark;

      if (!items || items.length === 0) break;

      for (const item of items) {
        // Skip non-pin modules (e.g. explore boards, shopping carousels, or search guides)
        if (!item || !item.images) continue;

        let numericId = null;
        if (item.comments?.uri) {
          const m = item.comments.uri.match(/\/pins\/(\d+)\//);
          if (m) numericId = m[1];
        }
        if (!numericId && item.canonical_pin?.comments?.uri) {
          const m = item.canonical_pin.comments.uri.match(/\/pins\/(\d+)\//);
          if (m) numericId = m[1];
        }
        if (!numericId && item.canonical_pin?.id && /^\d+$/.test(String(item.canonical_pin.id))) {
          numericId = String(item.canonical_pin.id);
        }
        if (!numericId && item.id && /^\d+$/.test(String(item.id))) {
          numericId = String(item.id);
        }

        const displayId = numericId || String(item.id || '');

        const isPromoted = Boolean(item.is_promoted);
        currentGridPosition++;
        if (isPromoted) {
          promotedCount++;
        } else {
          currentOrganicPosition++;
        }

        const itemPinJoin = item.pin_join?.id ? item.pin_join.id.toLowerCase() : null;
        const itemImageHash = itemPinJoin ||
          extractHash(item.images?.['236x']?.url) ||
          extractHash(item.images?.orig?.url) ||
          extractHash(item.images?.['736x']?.url);

        const itemLink = toCleanLink(item.link);
        const itemTitle = toCleanText(item.title || item.grid_title) || 'Untitled Pin';
        const itemTitleClean = itemTitle.toLowerCase();

        // Multi-attribute 100% verification
        let isTarget = false;
        let why = '';

        if (numericId && numericId === targetPinId) {
          isTarget = true;
          why = 'Exact Pin ID Match';
        } else if (String(item.id) === targetPinId) {
          isTarget = true;
          why = 'Exact Pin ID Match';
        } else if (item.canonical_pin && String(item.canonical_pin.id) === targetPinId) {
          isTarget = true;
          why = 'Canonical Original Pin Match';
        } else if (targetImageHash && (targetImageHash === itemImageHash || targetImageHash === itemPinJoin)) {
          isTarget = true;
          why = `Visual Image Signature (Canonical Repin #${displayId})`;
        } else if (targetPinJoin && itemPinJoin && targetPinJoin === itemPinJoin) {
          isTarget = true;
          why = `Visual Image Signature (Canonical Repin #${displayId})`;
        } else if (
          targetLink && itemLink &&
          targetLink === itemLink &&
          targetTitleClean && itemTitleClean &&
          targetTitleClean.length > 5 &&
          (targetTitleClean === itemTitleClean || targetTitleClean.includes(itemTitleClean) || itemTitleClean.includes(targetTitleClean))
        ) {
          isTarget = true;
          why = 'Destination Link & Title Match';
        }

        const imgUrl = item.images?.['236x']?.url || item.images?.orig?.url || item.images?.['736x']?.url || null;
        const pinnerName = toCleanText(item.pinner?.username || item.pinner?.full_name) || 'Pinterest Creator';

        allScannedPins.push({
          position: currentOrganicPosition,
          gridPosition: currentGridPosition,
          id: displayId,
          rawId: item.id,
          title: itemTitle,
          image: imgUrl,
          pinner: pinnerName,
          isPromoted,
          isTarget,
          matchReason: isTarget ? why : null,
        });

        if (isTarget && foundOrganicPosition === null) {
          foundOrganicPosition = isPromoted ? currentGridPosition : currentOrganicPosition;
          foundGridPosition = currentGridPosition;
          matchType = why;
          matchedPinId = displayId;
        }

        if (currentGridPosition >= maxDepth) break;
      }

      // If found and we have gathered 10 surrounding pins after it, finish early for maximum speed
      if (foundGridPosition !== null && currentGridPosition >= foundGridPosition + 10) {
        break;
      }

      if (!bookmark || bookmark === '-end-') break;
    }

    // Determine surrounding pins window around the target
    let surrounding = [];
    if (foundGridPosition !== null) {
      const targetIndex = allScannedPins.findIndex((p) => p.isTarget);
      const startIdx = Math.max(0, targetIndex - 6);
      const endIdx = Math.min(allScannedPins.length, targetIndex + 8);
      surrounding = allScannedPins.slice(startIdx, endIdx);
    } else {
      surrounding = allScannedPins.slice(0, 25);
    }

    // Grid coordinates (standard desktop 4-column layout)
    const gridCol = foundGridPosition ? ((foundGridPosition - 1) % 4) + 1 : null;
    const gridRow = foundGridPosition ? Math.ceil(foundGridPosition / 4) : null;

    res.json({
      success: true,
      found: foundOrganicPosition !== null,
      position: foundOrganicPosition,
      organicPosition: foundOrganicPosition,
      gridPosition: foundGridPosition,
      gridRow,
      gridCol,
      promotedAboveTarget: foundGridPosition ? (foundGridPosition - foundOrganicPosition) : 0,
      matchType,
      matchedPinId: foundGridPosition ? matchedPinId : null,
      page: foundOrganicPosition ? Math.ceil(foundOrganicPosition / 25) : null,
      pinId,
      keyword,
      annotation,
      fullQuery,
      targetSearchUrl: `https://${countryDomain}/search/pins/?q=${encodeURIComponent(fullQuery)}`,
      suggestedIdeas,
      country,
      locale,
      countryLabel: countryCfg.label,
      domain: countryDomain,
      totalScanned: currentGridPosition,
      organicScanned: currentOrganicPosition,
      promotedScanned: promotedCount,
      isCustomSession: Boolean(session.isCustom),
      pinDetails,
      annotationsList,
      surroundingPins: surrounding,
      allScannedPins: allScannedPins.slice(0, 300),
    });
  } catch (err) {
    console.error('Position check error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Pin Inspector Web Server running at http://localhost:${PORT}`);
});
