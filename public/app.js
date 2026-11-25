// Pin Inspector Web Pro 2.0 - Complete Client Application Logic
// 100% Reverse-Engineered from Embarcadero Delphi Pin Inspector 2 Forms & Specifications

const state = {
  currentTab: 'keywords',
  keywords: [],
  pins: [],
  boards: [],
  users: [],
  annotations: [],
  trends: [],
  currentPinsQuery: '',
  kwSort: { field: 'rank', asc: true },
  pinsSort: { field: 'saves', asc: false },
  boardsSort: { field: 'followerCount', asc: false },
  usersSort: { field: 'followers', asc: false },
  trendSort: { field: null, asc: true },
  
  // Selection tracking per table
  selected: {
    keywords: new Set(),
    pins: new Set(),
    boards: new Set(),
    users: new Set(),
    annotations: new Set(),
    trends: new Set(),
  },

  // Active filters per table: array of { column, op, value }
  filters: {
    keywords: [],
    pins: [],
    boards: [],
    users: [],
    annotations: [],
    trends: [],
  },

  // Visible columns per table
  visibleColumns: JSON.parse(localStorage.getItem('piw_visible_cols') || '{}'),

  // Bookmarks
  bookmarks: JSON.parse(localStorage.getItem('piw_bookmarks') || '[]'),

  // Integrations & Settings
  keApiKey: localStorage.getItem('piw_ke_api_key') || '',
  keCountry: localStorage.getItem('piw_ke_country') || 'us',
  keCurrency: localStorage.getItem('piw_ke_currency') || 'USD',
  downloadThreads: parseInt(localStorage.getItem('piw_dl_threads') || '5', 10),
  customCookies: localStorage.getItem('piw_custom_cookies') || '',

  // Pins Subtabs & Unified PinGrid State (Images 2, 3, 4)
  currentPinsSubTab: 'search',
  pinsRunning: false,
  pinsCancelled: false,
  pinsImgSize: 25,
  pinsWrapText: false,
  pinsAbortController: null,
  usersImageSize: 25,
  boardsImageSize: 30,

  // Winner Pin Finder State
  winnerPins: [],
  winnerQuery: '',
  winnerRunning: false,
  winnerCancelled: false,
  winnerAbortController: null,
  winnerNextBookmark: '',
  winnerHasMore: false,
  winnerViewMode: 'grid',
  winnerRenderLimit: 200,
  winnerCurrentSubquery: '',
  winnerPinType: 'pins',
  winnerCountry: 'US',
  winnerFilter: {
    enabled: true,
    minSaves: 15,
    maxDays: 28,
    hasLink: 'yes',
    action: 'hide',
  },
};

// Global Chart instance
let trendChartInstance = null;
let currentChartTerm = '';
let activeColumnsTable = 'keywords';
let activeFilterTable = 'keywords';
let activeImportTool = 'pins';

// Initialize UI Badges & Bookmarks
document.addEventListener('DOMContentLoaded', () => {
  updateBookmarksBadge();
  checkSessionStatus();
  if (state.keApiKey) {
    document.getElementById('keBadge')?.classList.remove('hidden');
  }
  applyAllSavedColumns();
  initCategoriesChecklist();
  syncWinnerFilterUI();
  renderWinnerPins();
});

// Check Server Session Status
async function checkSessionStatus() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    const pill = document.getElementById('sessionStatusPill');
    const txt = document.getElementById('sessionStatusText');
    if (data.connected) {
      if (data.isCustom) {
        txt.textContent = 'Custom Session Active';
        pill.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200';
      } else {
        txt.textContent = 'Pinterest API Connected';
        pill.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200';
      }
    }
  } catch (err) {
    const txt = document.getElementById('sessionStatusText');
    if (txt) txt.textContent = 'Offline';
  }
}

// Tab Switching
function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('tab-active'));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));

  const activeBtn = document.getElementById(`tab-${tabId}`);
  const activePanel = document.getElementById(`panel-${tabId}`);
  if (activeBtn) activeBtn.classList.add('tab-active');
  if (activePanel) activePanel.classList.remove('hidden');

  updateSelectionBar();

  if (tabId === 'trends') {
    renderTrends();
  } else if (tabId === 'winner') {
    syncWinnerFilterUI();
    renderWinnerPins();
  }
}

// ----------------------------------------------------------------------
// 1. KEYWORDS GENERATOR (KeywordGrid - 100% Pin Inspector 2 Parity)
// ----------------------------------------------------------------------
let contextKeywordTerm = '';
let contextKeywordSeed = '';

document.getElementById('keywordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('kwInput').value.trim();
  const mode = document.getElementById('kwMode').value;
  if (!query) return;

  const btn = document.getElementById('kwSearchBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="ph ph-spinner animate-spin text-xs"></i> Generating...`;

  try {
    const res = await fetch(`/api/keywords?query=${encodeURIComponent(query)}&mode=${mode}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.keywords = data.keywords || [];
    state.selected.keywords.clear();
    renderKeywords();
  } catch (err) {
    alert(`Failed to generate keywords: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

function getPinImageUrl(p, preferThumb = false) {
  if (!p) return '';
  const candidates = preferThumb
    ? [p.thumbnail, p.image, p.Image, p.images?.['236x']?.url, p.images?.orig?.url]
    : [p.Image, p.image, p.thumbnail, p.images?.orig?.url, p.images?.['736x']?.url, p.images?.['236x']?.url];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http')) return c;
  }
  return '';
}

function getPinValue(p, colName) {
  if (!p) return '';
  if (colName === 'Image') {
    const imgUrl = getPinImageUrl(p, false);
    if (imgUrl) return imgUrl;
    return p.Image || '';
  }
  if (p[colName] !== undefined && p[colName] !== null) return p[colName];

  const colMap = {
    '#': p.rank || '',
    'Image': getPinImageUrl(p, false) || p.Image || '',
    'Pin ID': p['Pin ID'] || p.id || '',
    'Title': p.Title || p.title || '',
    'Saves': p.Saves !== undefined ? p.Saves : (p.saves !== undefined ? p.saves : 0),
    'Shares': p.Shares !== undefined ? p.Shares : (p.shares !== undefined ? p.shares : 0),
    'Repins': p.Repins !== undefined ? p.Repins : (p.repins !== undefined ? p.repins : (p.saves || 0)),
    'Comments': p.Comments !== undefined ? p.Comments : (p.comments !== undefined ? p.comments : 0),
    'Removes': p.Removes !== undefined ? p.Removes : 0,
    'Good Idea': p['Good Idea'] !== undefined ? p['Good Idea'] : (p.reactions?.goodIdea || 0),
    'Love': p.Love !== undefined ? p.Love : (p.reactions?.love || 0),
    'Thanks': p.Thanks !== undefined ? p.Thanks : (p.reactions?.thanks || 0),
    'Wow': p.Wow !== undefined ? p.Wow : (p.reactions?.wow || 0),
    'Laughing': p.Laughing !== undefined ? p.Laughing : (p.reactions?.haha || 0),
    'Total Reactions': p['Total Reactions'] !== undefined ? p['Total Reactions'] : (p.totalReactions ?? p.reactionCount ?? 0),
    'Description': p.Description || p.description || '',
    'Category': p.Category || p.category || '',
    'Hashtags': p.Hashtags || p.hashtags || '',
    'Created': p.Created || p.created || '',
    'Method': p.Method || p.method || '',
    'Domain': p.Domain || p.domain || '',
    'Site Name': p['Site Name'] || p.siteName || '',
    'Link': p.Link || p.link || '',
    'Dominant Color': p['Dominant Color'] || p.dominantColor || '',
    'Image Signature': p['Image Signature'] || p.imageSignature || '',
    'Is Repin': p['Is Repin'] || (p.isRepin ? 'YES' : 'NO'),
    'Is Promoted': p['Is Promoted'] || (p.isPromoted ? 'YES' : 'NO'),
    'Is Video': p['Is Video'] || (p.isVideo ? 'YES' : 'NO'),
    'Is Story': p['Is Story'] || (p.isStory ? 'YES' : 'NO'),
    'Is Group Board': p['Is Group Board'] || (p.isGroupBoard ? 'YES' : 'NO'),
    'Is AI Modified': p['Is AI Modified'] || (p.isAiModified ? 'YES' : 'NO'),
    'Video link': p['Video link'] || p.videoUrl || '',
    'Video Length': p['Video Length'] !== undefined ? p['Video Length'] : (p.videoDuration || 0),
    'Video Thumbnail': p['Video Thumbnail'] || p.videoThumbnail || '',
    'Pinner Image': p['Pinner Image'] || p.pinner?.image || '',
    'Pinner Username': p['Pinner Username'] || p.pinnerUsername || p.pinner?.username || '',
    'Pinner Name': p['Pinner Name'] || p.pinnerName || p.pinner?.fullName || '',
    'Pinner Location': p['Pinner Location'] || p.pinnerLocation || '',
    'Pinner Followers': p['Pinner Followers'] !== undefined ? p['Pinner Followers'] : (p.pinner?.followers || 0),
    'Board Name': p['Board Name'] || p.boardName || p.board?.name || '',
    'Board Link': p['Board Link'] || p.boardUrl || p.board?.url || '',
    'Board Category': p['Board Category'] || p.boardCategory || '',
    'Board Image': p['Board Image'] || p.boardImage || '',
    'Creator Image': p['Creator Image'] || p.creator?.image || '',
    'Creator Username': p['Creator Username'] || p.creatorUsername || p.creator?.username || '',
    'Creator Name': p['Creator Name'] || p.creatorName || p.creator?.fullName || '',
    'Creator Location': p['Creator Location'] || p.creatorLocation || '',
    'Creator Link': p['Creator Link'] || p.creatorUrl || p.creator?.url || '',
    'Creator Followers': p['Creator Followers'] !== undefined ? p['Creator Followers'] : (p.creator?.followers || 0),
    'Promoter Image': p['Promoter Image'] || p.promoter?.image || '',
    'Promoter Username': p['Promoter Username'] || p.promoterUsername || p.promoter?.username || '',
    'Promoter Name': p['Promoter Name'] || p.promoterName || p.promoter?.fullName || '',
    'Promoter Location': p['Promoter Location'] || p.promoterLocation || '',
    'Promoter Link': p['Promoter Link'] || p.promoterUrl || p.promoter?.url || '',
    'Promoter Followers': p['Promoter Followers'] !== undefined ? p['Promoter Followers'] : (p.promoter?.followers || 0),
    'Annotations': p.Annotations || p.annotations || '',
    'main link': p['main link'] || p.pinUrl || p.url || '',
  };

  return colMap[colName] !== undefined ? colMap[colName] : '';
}

function getFilteredData(tableId, dataList) {
  let list = [...dataList];
  const quickSearch = (document.getElementById(`${tableId}FilterInput`)?.value || '').toLowerCase().trim();

  // Quick text search
  if (quickSearch) {
    list = list.filter((item) => JSON.stringify(item).toLowerCase().includes(quickSearch));
  }

  // Dedicated Pins AI Filter
  if (tableId === 'pins') {
    const aiFilter = document.getElementById('pinsAiFilter')?.value || 'all';
    if (aiFilter === 'ai-only') {
      list = list.filter((p) => p.isAiModified || p['Is AI Modified'] === 'YES');
    } else if (aiFilter === 'human-only') {
      list = list.filter((p) => !p.isAiModified && p['Is AI Modified'] !== 'YES');
    }
  }

  // Advanced Rules Filter
  const rules = state.filters[tableId] || [];
  for (const rule of rules) {
    list = list.filter((item) => {
      let fieldVal = item[rule.column];
      if ((fieldVal === undefined || fieldVal === null) && tableId === 'pins') {
        fieldVal = getPinValue(item, rule.column);
      }
      if (fieldVal === undefined || fieldVal === null) fieldVal = '';
      const targetVal = rule.value.toLowerCase().trim();

      if (typeof fieldVal === 'number') {
        const numTarget = parseFloat(targetVal);
        if (isNaN(numTarget)) return true;
        if (rule.op === 'gt') return fieldVal > numTarget;
        if (rule.op === 'lt') return fieldVal < numTarget;
        if (rule.op === 'gte') return fieldVal >= numTarget;
        if (rule.op === 'lte') return fieldVal <= numTarget;
        if (rule.op === 'equals') return fieldVal === numTarget;
      } else {
        const numField = parseFloat(String(fieldVal).replace(/,/g, ''));
        const numTarget = parseFloat(targetVal);
        if (!isNaN(numField) && !isNaN(numTarget) && ['gt', 'lt', 'gte', 'lte', 'equals'].includes(rule.op)) {
          if (rule.op === 'gt') return numField > numTarget;
          if (rule.op === 'lt') return numField < numTarget;
          if (rule.op === 'gte') return numField >= numTarget;
          if (rule.op === 'lte') return numField <= numTarget;
          if (rule.op === 'equals') return numField === numTarget;
        }

        const strVal = fieldVal.toString().toLowerCase();
        if (rule.op === 'contains') return strVal.includes(targetVal);
        if (rule.op === 'not_contains') return !strVal.includes(targetVal);
        if (rule.op === 'equals') return strVal === targetVal;
        if (rule.op === 'starts_with') return strVal.startsWith(targetVal);
        if (rule.op === 'ends_with') return strVal.endsWith(targetVal);
      }
      return true;
    });
  }

  return list;
}

function renderKeywords() {
  const tbody = document.getElementById('kwTableBody');
  const countEl = document.getElementById('kwCount');
  const selCountEl = document.getElementById('kwSelectedCount');

  if (state.keywords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-slate-400">Enter a seed keyword above and click Generate.</td></tr>`;
    if (countEl) countEl.textContent = '0';
    if (selCountEl) selCountEl.textContent = '0';
    return;
  }

  const filtered = getFilteredData('keywords', state.keywords);
  if (countEl) countEl.textContent = filtered.length;
  if (selCountEl) selCountEl.textContent = state.selected.keywords.size;

  updateFilterBadge('keywords');

  tbody.innerHTML = filtered
    .map((k, index) => {
      const isChecked = state.selected.keywords.has(k.keyword);
      const rowRank = k.rank !== undefined ? k.rank : (index + 1);
      return `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 ${isChecked ? 'bg-[#cce8ff]/40' : ''}" oncontextmenu="openKeywordContextMenu(event, '${escapeQuotes(k.keyword)}', '${escapeQuotes(k.seed || '')}')">
        <td class="py-1.5 px-2.5 text-center border-r border-slate-100">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleSelectRow('keywords', '${escapeQuotes(k.keyword)}', this.checked)">
        </td>
        <td class="py-1.5 px-3 text-center text-xs text-slate-600 font-mono col-kw-rank border-r border-slate-100">${rowRank}</td>
        <td class="py-1.5 px-3 text-center font-mono text-slate-700 col-kw-words border-r border-slate-100">${k.wordCount || 0}</td>
        <td class="py-1.5 px-3 text-center font-mono text-slate-700 col-kw-chars border-r border-slate-100">${k.charCount || 0}</td>
        <td class="py-1.5 px-3 text-xs text-slate-700 font-medium truncate max-w-xs col-kw-seed border-r border-slate-100">${escapeHtml(k.seed || '')}</td>
        <td class="py-1.5 px-4 font-semibold text-slate-900 col-kw-keyword border-r border-slate-100">${escapeHtml(k.keyword)}</td>
        <td class="py-1.5 px-3 text-center font-mono text-emerald-600 font-semibold col-kw-vol border-r border-slate-100">${k.vol !== undefined && k.vol !== '' ? Number(k.vol).toLocaleString() : ''}</td>
        <td class="py-1.5 px-3 text-center font-mono text-slate-700 col-kw-cpc border-r border-slate-100">${k.cpc !== undefined && k.cpc !== '' ? '$' + k.cpc : ''}</td>
        <td class="py-1.5 px-3 text-center font-mono text-slate-700 col-kw-comp border-r border-slate-100">${k.competition !== undefined ? k.competition : ''}</td>
      </tr>
    `;
    })
    .join('');

  applyColumnVisibility('keywords');
}

function sortKw(field) {
  if (state.kwSort.field === field) {
    state.kwSort.asc = !state.kwSort.asc;
  } else {
    state.kwSort.field = field;
    state.kwSort.asc = true;
  }
  state.keywords.sort((a, b) => {
    let valA = a[field] ?? '';
    let valB = b[field] ?? '';
    if (typeof valA === 'number' && typeof valB === 'number') {
      return state.kwSort.asc ? valA - valB : valB - valA;
    }
    const numA = parseFloat(valA);
    const numB = parseFloat(valB);
    if (!isNaN(numA) && !isNaN(numB)) {
      return state.kwSort.asc ? numA - numB : numB - numA;
    }
    const strA = valA.toString();
    const strB = valB.toString();
    return state.kwSort.asc ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });
  renderKeywords();
}

function clearKeywordsGrid() {
  if (confirm('Clear all keywords from grid?')) {
    state.keywords = [];
    state.selected.keywords.clear();
    renderKeywords();
    updateSelectionBar();
  }
}

// ----------------------------------------------------------------------
// KEYWORD CONTEXT MENU HANDLERS (100% Pin Inspector Parity)
// ----------------------------------------------------------------------
function openKeywordContextMenu(e, keyword, seed) {
  e.preventDefault();
  contextKeywordTerm = keyword;
  contextKeywordSeed = seed;

  const menu = document.getElementById('keywordContextMenu');
  if (!menu) return;

  menu.classList.remove('hidden');

  let x = e.clientX;
  let y = e.clientY;
  const menuWidth = 280;
  const menuHeight = 520;

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10;
  }

  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;
}

function closeKeywordContextMenu() {
  const menu = document.getElementById('keywordContextMenu');
  if (menu) menu.classList.add('hidden');
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('#keywordContextMenu')) {
    closeKeywordContextMenu();
  }
  if (!e.target.closest('#kwFileMenuContainer')) {
    const fm = document.getElementById('kwFileMenu');
    if (fm && !fm.classList.contains('hidden')) fm.classList.add('hidden');
  }
});

function getSelectedOrContextKeywords() {
  if (state.selected.keywords.size > 0) {
    return Array.from(state.selected.keywords);
  }
  return contextKeywordTerm ? [contextKeywordTerm] : [];
}

// 1. Send SELECTED to Trends tool
function kwSendSelectedToTrends() {
  closeKeywordContextMenu();
  const kws = getSelectedOrContextKeywords();
  if (kws.length === 0) return;
  switchTab('trends');
  if (kws.length === 1) {
    const input = document.getElementById('trendSearchInput');
    if (input) input.value = kws[0];
    generateTrends();
  } else {
    importTrendsKeywords(kws);
  }
}

// 2. Send ALL to Trends tool
function kwSendAllToTrends() {
  closeKeywordContextMenu();
  const allKws = state.keywords.map(k => k.keyword);
  if (allKws.length === 0) return;
  switchTab('trends');
  importTrendsKeywords(allKws);
}

// 3. Send to Pin search tool
function kwSendToPins() {
  closeKeywordContextMenu();
  const term = contextKeywordTerm || (state.selected.keywords.size > 0 ? Array.from(state.selected.keywords)[0] : '');
  if (!term) return;
  sendToPins(term);
}

// 4. Send to Boards search tool
function kwSendToBoards() {
  closeKeywordContextMenu();
  const term = contextKeywordTerm || (state.selected.keywords.size > 0 ? Array.from(state.selected.keywords)[0] : '');
  if (!term) return;
  sendToBoards(term);
}

// 5. Send to People search tool
function kwSendToPeople() {
  closeKeywordContextMenu();
  const term = contextKeywordTerm || (state.selected.keywords.size > 0 ? Array.from(state.selected.keywords)[0] : '');
  if (!term) return;
  sendToPeople(term);
}

// 6. Get Search Volume
function kwGetSearchVolume() {
  closeKeywordContextMenu();
  fetchKeywordsEverywhere('keywords');
}

// 7. Send SELECTED to Keywords Everywhere tool
function kwSendSelectedToKE() {
  closeKeywordContextMenu();
  fetchKeywordsEverywhere('keywords');
}

// 8. Send ALL to Keywords Everywhere tool
function kwSendAllToKE() {
  closeKeywordContextMenu();
  fetchKeywordsEverywhere('keywords');
}

// 9. Send SELECTED Keywords to Annotations tool
function kwSendSelectedToAnnotations() {
  closeKeywordContextMenu();
  const kws = getSelectedOrContextKeywords();
  if (kws.length === 0) return;
  sendToAnnotations(kws);
}

// 10. Send ALL Keywords to Annotations tool
function kwSendAllToAnnotations() {
  closeKeywordContextMenu();
  const allKws = state.keywords.map(k => k.keyword);
  if (allKws.length === 0) return;
  sendToAnnotations(allKws);
}

// Checkboxes Submenu
function kwCheckSelected() {
  closeKeywordContextMenu();
  if (contextKeywordTerm) state.selected.keywords.add(contextKeywordTerm);
  renderKeywords();
  updateSelectionBar();
}

function kwUncheckSelected() {
  closeKeywordContextMenu();
  if (contextKeywordTerm) state.selected.keywords.delete(contextKeywordTerm);
  renderKeywords();
  updateSelectionBar();
}

function kwCheckAll() {
  closeKeywordContextMenu();
  state.keywords.forEach(k => state.selected.keywords.add(k.keyword));
  renderKeywords();
  updateSelectionBar();
}

function kwUncheckAll() {
  closeKeywordContextMenu();
  state.selected.keywords.clear();
  renderKeywords();
  updateSelectionBar();
}

// Filters Submenu
function kwFilterSelected() {
  closeKeywordContextMenu();
  if (!contextKeywordTerm) return;
  const input = document.getElementById('keywordsFilterInput');
  if (input) {
    input.value = contextKeywordTerm;
    renderKeywords();
  }
}

function kwClearFilter() {
  closeKeywordContextMenu();
  const input = document.getElementById('keywordsFilterInput');
  if (input) input.value = '';
  state.filters.keywords = [];
  renderKeywords();
}

// Copy Submenu
function kwCopySelectedKeywords() {
  closeKeywordContextMenu();
  const kws = getSelectedOrContextKeywords();
  if (kws.length === 0) return;
  navigator.clipboard.writeText(kws.join('\n'));
}

function kwCopyAllKeywords() {
  closeKeywordContextMenu();
  const allKws = state.keywords.map(k => k.keyword);
  if (allKws.length === 0) return;
  navigator.clipboard.writeText(allKws.join('\n'));
}

function kwCopySelectedTSV() {
  closeKeywordContextMenu();
  const sel = state.selected.keywords;
  const rows = state.keywords.filter(k => sel.has(k.keyword) || k.keyword === contextKeywordTerm);
  const tsv = [
    ['Rank', 'Word Count', 'Character Count', 'Seed', 'Keyword', 'Search Volume', 'Cost Per Click', 'Competition'].join('\t'),
    ...rows.map(k => [k.rank ?? '', k.wordCount ?? '', k.charCount ?? '', k.seed ?? '', k.keyword, k.vol ?? '', k.cpc ?? '', k.competition ?? ''].join('\t'))
  ].join('\n');
  navigator.clipboard.writeText(tsv);
}

function kwCopyAllTSV() {
  closeKeywordContextMenu();
  const tsv = [
    ['Rank', 'Word Count', 'Character Count', 'Seed', 'Keyword', 'Search Volume', 'Cost Per Click', 'Competition'].join('\t'),
    ...state.keywords.map(k => [k.rank ?? '', k.wordCount ?? '', k.charCount ?? '', k.seed ?? '', k.keyword, k.vol ?? '', k.cpc ?? '', k.competition ?? ''].join('\t'))
  ].join('\n');
  navigator.clipboard.writeText(tsv);
}

// Search Submenu
function kwSearchOnPinterest() {
  closeKeywordContextMenu();
  if (!contextKeywordTerm) return;
  window.open(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(contextKeywordTerm)}`, '_blank');
}

function kwSearchOnGoogle() {
  closeKeywordContextMenu();
  if (!contextKeywordTerm) return;
  window.open(`https://www.google.com/search?q=${encodeURIComponent(contextKeywordTerm)}`, '_blank');
}

// Auto-fit & Reset
function kwAutoFitColumns() {
  closeKeywordContextMenu();
  const table = document.getElementById('table-keywords');
  if (table) table.style.width = '100%';
}

function kwResetColumns() {
  closeKeywordContextMenu();
  state.visibleColumns.keywords = {};
  applyColumnVisibility('keywords');
}

// Delete Submenu
function kwDeleteSelected() {
  closeKeywordContextMenu();
  const sel = state.selected.keywords;
  if (sel.size === 0 && contextKeywordTerm) sel.add(contextKeywordTerm);
  if (sel.size === 0) return;
  state.keywords = state.keywords.filter(k => !sel.has(k.keyword));
  sel.clear();
  renderKeywords();
  updateSelectionBar();
}

function kwDeleteUnselected() {
  closeKeywordContextMenu();
  const sel = state.selected.keywords;
  if (sel.size === 0) return;
  state.keywords = state.keywords.filter(k => sel.has(k.keyword));
  renderKeywords();
  updateSelectionBar();
}

function kwDeleteAll() {
  closeKeywordContextMenu();
  clearKeywordsGrid();
}

function toggleKwFileMenu() {
  const menu = document.getElementById('kwFileMenu');
  if (menu) menu.classList.toggle('hidden');
}

function exportKeywordsHTML() {
  const data = getFilteredData('keywords', state.keywords);
  if (!data || data.length === 0) return alert('No keywords to export.');

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pin Inspector - Keywords Export</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; color: #1e293b; background: #f8fafc; }
    h2 { margin-bottom: 4px; color: #0f172a; }
    p { margin-top: 0; color: #64748b; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; background: white; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
    th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-weight: 600; color: #334155; border-bottom: 2px solid #e2e8f0; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    tr:hover { background: #f8fafc; }
    .text-center { text-align: center; }
  </style>
</head>
<body>
  <h2>Pin Inspector - Generated Keywords (${data.length})</h2>
  <p>Generated: ${new Date().toLocaleString()}</p>
  <table>
    <thead>
      <tr>
        <th class="text-center">Rank</th>
        <th class="text-center">Word Count</th>
        <th class="text-center">Character Count</th>
        <th>Seed</th>
        <th>Keyword</th>
        <th class="text-center">Search Volume</th>
        <th class="text-center">CPC ($)</th>
        <th class="text-center">Competition</th>
      </tr>
    </thead>
    <tbody>
      ${data.map(k => `
        <tr>
          <td class="text-center">${k.rank ?? ''}</td>
          <td class="text-center">${k.wordCount ?? ''}</td>
          <td class="text-center">${k.charCount ?? ''}</td>
          <td>${escapeHtml(k.seed || '')}</td>
          <td><strong>${escapeHtml(k.keyword)}</strong></td>
          <td class="text-center">${k.vol !== undefined && k.vol !== '' ? Number(k.vol).toLocaleString() : ''}</td>
          <td class="text-center">${k.cpc !== undefined && k.cpc !== '' ? '$' + k.cpc : ''}</td>
          <td class="text-center">${k.competition !== undefined ? k.competition : ''}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `keywords_report_${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ----------------------------------------------------------------------
// 2. PINS ANALYZER (PinGrid implementation unified in Section below)
// ----------------------------------------------------------------------


// ----------------------------------------------------------------------
// 3. BOARDS ANALYZER (BoardGrid - 100% Delphi Parity)
// ----------------------------------------------------------------------
let contextBoardId = null;

document.getElementById('boardsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('boardsInput').value.trim();
  if (!query) return;

  const count = document.getElementById('boardsTotalSelect')?.value || '50';
  const btn = document.getElementById('boardsSearchBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Searching...`;

  try {
    const res = await fetch(`/api/boards?query=${encodeURIComponent(query)}&count=${encodeURIComponent(count)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.boards = data.boards || [];
    state.selected.boards.clear();
    renderBoards();
  } catch (err) {
    alert(`Failed to search boards: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

function renderBoards() {
  const tbody = document.getElementById('boardsTableBody');
  const statsBar = document.getElementById('boardsStatsBar');
  const imgSize = state.boardsImageSize || 30;

  if (state.boards.length === 0) {
    tbody.innerHTML = `<tr><td colspan="19" class="py-12 text-center text-slate-400">Search for boards to inspect their analytics.</td></tr>`;
    statsBar?.classList.add('hidden');
    return;
  }

  statsBar?.classList.remove('hidden');
  const filtered = getFilteredData('boards', state.boards);

  document.getElementById('boardsCount').textContent = filtered.length;
  const totalFollowers = filtered.reduce((acc, b) => acc + (b.followerCount || 0), 0);
  document.getElementById('boardsTotalFollowers').textContent = totalFollowers.toLocaleString();

  updateFilterBadge('boards');

  tbody.innerHTML = filtered
    .map((b) => {
      const isChecked = state.selected.boards.has(b.id);
      const coverUrl = b.coverImage || b.image;
      const ownerUser = b.ownerUsername || '';
      const ownerName = b.ownerName || ownerUser;
      const boardUrl = b.url || (b.id ? `https://www.pinterest.com/board/${b.id}/` : '#');

      return `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 ${isChecked ? 'bg-red-50/50' : ''}" oncontextmenu="openBoardContextMenu(event, '${b.id}')">
        <td class="py-2 px-3 text-center border-r border-slate-100">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleSelectRow('boards', '${b.id}', this.checked)">
        </td>
        <td class="py-1.5 px-3 text-center col-boards-cover border-r border-slate-100">
          ${
            coverUrl
              ? `<a href="${boardUrl}" target="_blank" class="inline-block rounded overflow-hidden bg-slate-100 shadow-xs border border-slate-200" style="width:${imgSize}px; height:${imgSize}px;">
                  <img src="${coverUrl}" alt="cover" class="w-full h-full object-cover">
                </a>`
              : `<span class="text-[10px] text-slate-300">No cover</span>`
          }
        </td>
        <td class="py-2 px-3 text-xs font-mono text-slate-500 col-boards-id border-r border-slate-100">
          <a href="${boardUrl}" target="_blank" class="text-blue-600 hover:underline font-mono">${escapeHtml(b.id || '')}</a>
        </td>
        <td class="py-2 px-3 font-semibold text-slate-900 col-boards-name border-r border-slate-100">
          <a href="${boardUrl}" target="_blank" class="hover:text-red-600">${escapeHtml(b.name || '')}</a>
        </td>
        <td class="py-2 px-3 text-center font-mono font-bold text-red-600 col-boards-followers border-r border-slate-100">${(Number(b.followerCount) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-700 col-boards-pins border-r border-slate-100">${(Number(b.pinCount) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 col-boards-link border-r border-slate-100">
          <a href="${boardUrl}" target="_blank" class="text-blue-600 hover:underline font-mono text-[11px] truncate max-w-[220px] inline-block align-middle">${escapeHtml(boardUrl)}</a>
        </td>
        <td class="py-2 px-3 text-xs text-slate-700 col-boards-desc border-r border-slate-100">
          <span class="truncate max-w-[240px] inline-block align-middle" title="${escapeQuotes(b.description || '')}">${escapeHtml(b.description || 'not-given')}</span>
        </td>
        <td class="py-2 px-3 text-center font-semibold text-xs text-slate-700 col-boards-join border-r border-slate-100">${b.canJoin || 'NO'}</td>
        <td class="py-2 px-3 text-center font-semibold text-xs text-slate-700 col-boards-isgroup border-r border-slate-100">${b.isGroup || 'NO'}</td>
        <td class="py-2 px-3 text-xs text-slate-600 col-boards-topic border-r border-slate-100">${escapeHtml(b.topic || 'not-given')}</td>
        <td class="py-2 px-3 text-xs text-slate-500 font-mono col-boards-modified border-r border-slate-100 whitespace-nowrap">${escapeHtml(b.lastModified || '—')}</td>
        <td class="py-2 px-3 text-xs text-slate-700 col-boards-ownername border-r border-slate-100">${escapeHtml(ownerName)}</td>
        <td class="py-2 px-3 text-center font-mono text-xs text-slate-600 col-boards-ownerfollowers border-r border-slate-100">${(Number(b.ownerFollowers) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-xs text-slate-700 col-boards-owner border-r border-slate-100">
          ${ownerUser ? `<button type="button" onclick="analyzeUserPins('${escapeQuotes(ownerUser)}')" class="hover:underline font-medium text-blue-600">@${escapeHtml(ownerUser)}</button>` : '—'}
        </td>
        <td class="py-2 px-3 text-xs text-slate-600 col-boards-ownercountry border-r border-slate-100">${escapeHtml(b.ownerCountry || 'not-given')}</td>
        <td class="py-2 px-3 text-xs text-slate-600 col-boards-ownerurl border-r border-slate-100">
          ${b.ownerUrl ? `<a href="${b.ownerUrl}" target="_blank" class="text-blue-600 hover:underline text-[11px] truncate max-w-[180px] inline-block align-middle">${escapeHtml(b.ownerUrl)}</a>` : '—'}
        </td>
        <td class="py-2 px-3 text-xs text-slate-600 col-boards-interests border-r border-slate-100">
          <span class="truncate max-w-[200px] inline-block align-middle" title="${escapeQuotes(b.relatedInterests || '')}">${escapeHtml(b.relatedInterests || '—')}</span>
        </td>
        <td class="py-2 px-3 text-right space-x-1 whitespace-nowrap col-boards-actions">
          <button type="button" onclick="openAnalyzeBoardPinsModal('${b.id}', '${escapeQuotes(b.name)}', ${b.pinCount || 0})" class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 font-medium" title="Analyze Board Pins">
            <i class="ph ph-push-pin"></i> Pins
          </button>
          <button type="button" onclick="addBookmark('board', { id: '${b.id}', title: '${escapeQuotes(b.name)}', url: '${boardUrl}' })" class="inline-flex items-center p-1 rounded text-slate-400 hover:text-amber-500" title="Bookmark Board">
            <i class="ph ph-star text-sm"></i>
          </button>
          <a href="${boardUrl}" target="_blank" class="inline-flex items-center p-1 rounded text-slate-400 hover:text-slate-600" title="Open on Pinterest">
            <i class="ph ph-arrow-square-out text-sm"></i>
          </a>
        </td>
      </tr>
    `;
    })
    .join('');

  applyColumnVisibility('boards');
}

function sortBoards(field) {
  if (state.boardsSort.field === field) {
    state.boardsSort.asc = !state.boardsSort.asc;
  } else {
    state.boardsSort.field = field;
    state.boardsSort.asc = false;
  }
  state.boards.sort((a, b) => (state.boardsSort.asc ? (a[field] ?? 0) - (b[field] ?? 0) : (b[field] ?? 0) - (a[field] ?? 0)));
  renderBoards();
}

function clearBoardsGrid() {
  if (confirm('Clear all boards from grid?')) {
    state.boards = [];
    state.selected.boards.clear();
    renderBoards();
    updateSelectionBar();
  }
}

function changeBoardsImageSize(val) {
  state.boardsImageSize = parseInt(val, 10) || 30;
  const label = document.getElementById('boardsImageSizeLabel');
  if (label) label.textContent = `${state.boardsImageSize} px`;
  renderBoards();
}

function toggleBoardsWrapText(wrapped) {
  const table = document.getElementById('table-boards');
  if (table) {
    if (wrapped) {
      table.classList.remove('whitespace-nowrap');
    } else {
      table.classList.add('whitespace-nowrap');
    }
  }
}

function openBoardBrowser() {
  const query = document.getElementById('boardsInput')?.value.trim();
  const url = query ? `https://www.pinterest.com/search/boards/?q=${encodeURIComponent(query)}` : 'https://www.pinterest.com/';
  window.open(url, '_blank');
}

// ----------------------------------------------------------------------
// BOARD CONTEXT MENU & MODALS (Delphi 100% Parity)
// ----------------------------------------------------------------------
function openBoardContextMenu(e, boardId) {
  e.preventDefault();
  contextBoardId = boardId;
  const menu = document.getElementById('boardContextMenu');
  if (!menu) return;

  menu.classList.remove('hidden');
  const x = Math.min(e.clientX, window.innerWidth - 280);
  const y = Math.min(e.clientY, window.innerHeight - 380);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;
}

function closeBoardContextMenu() {
  const menu = document.getElementById('boardContextMenu');
  if (menu) menu.classList.add('hidden');
}

function toggleBoardsFileMenu() {
  const fm = document.getElementById('boardsFileMenu');
  if (fm) fm.classList.toggle('hidden');
}

function boardContextAction(action) {
  closeBoardContextMenu();
  const b = state.boards.find((item) => item.id === contextBoardId) || state.boards[0];
  if (!b) return;

  if (action === 'analyze-pins') {
    openAnalyzeBoardPinsModal(b.id, b.name, b.pinCount);
  } else if (action === 'send-selected-interests') {
    sendSelectedInterestsToAnnotations();
  } else if (action === 'send-all-interests') {
    sendAllInterestsToAnnotations();
  }
}

function openAnalyzeBoardPinsModal(boardId, boardName, pinCount) {
  let b = state.boards.find((item) => item.id === boardId);
  if (!b && state.boards.length > 0) b = state.boards[0];
  const bId = boardId || b?.id || '';
  const bName = boardName || b?.name || 'Selected Board';
  const bPins = pinCount !== undefined ? pinCount : (b?.pinCount || 0);

  document.getElementById('analyzeBoardTargetId').value = bId;
  document.getElementById('analyzeBoardTargetName').value = bName;
  document.getElementById('analyzeBoardPinsFoundCount').textContent = Number(bPins).toLocaleString();
  document.getElementById('analyzeBoardPinsModal')?.classList.remove('hidden');
}

function closeAnalyzeBoardPinsModal() {
  document.getElementById('analyzeBoardPinsModal')?.classList.add('hidden');
}

async function executeAnalyzeBoardPins() {
  const boardId = document.getElementById('analyzeBoardTargetId')?.value;
  const boardName = document.getElementById('analyzeBoardTargetName')?.value || 'Board';
  const count = document.getElementById('analyzeBoardPinsCount')?.value || '50';
  if (!boardId) return;

  const btn = document.getElementById('analyzeBoardPinsSubmitBtn');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Extracting links...';
  }

  try {
    const res = await fetch(`/api/board-pins?boardId=${encodeURIComponent(boardId)}&count=${encodeURIComponent(count)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    closeAnalyzeBoardPinsModal();

    const links = data.links || [];
    const pinIds = data.pinIds || [];

    if (pinIds.length === 0) {
      alert(`No pins found for board "${boardName}".`);
      return;
    }

    // Switch to Pins tab & Browse-Scrape subtab (Delphi Pin Inspector 2 Parity)
    switchTab('pins');
    switchPinsSubTab('browse-scrape');

    // Populate Browse & Scrape pin links in textarea
    const textarea = document.getElementById('browseScrapeLinksInput');
    if (textarea) {
      textarea.value = links.join('\n');
      updateBrowseScrapeLinksCount();
    }

    state.currentPinsQuery = `Board: ${boardName}`;

    // Start live deep extraction matching Delphi TAnalyzePinsForm.GoBtnClick
    const pinItems = pinIds.map((id) => ({
      id: String(id),
      url: `https://www.pinterest.com/pin/${id}/`,
    }));

    await startBrowseScrape(pinItems);

    const statusBar = document.getElementById('pinsStatusBarStatus');
    if (statusBar) statusBar.textContent = `Extracted ${pinIds.length} pins from board "${boardName}"`;
  } catch (err) {
    alert(`Failed to extract pins for board: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

function sendSelectedInterestsToAnnotations() {
  closeBoardContextMenu();
  const sel = state.selected.boards;
  let targetBoards = state.boards.filter((b) => sel.has(b.id));
  if (targetBoards.length === 0 && contextBoardId) {
    const single = state.boards.find((b) => b.id === contextBoardId);
    if (single) targetBoards = [single];
  }
  if (targetBoards.length === 0) {
    alert('No boards selected.');
    return;
  }

  const interestsSet = new Set();
  targetBoards.forEach((b) => {
    if (b.relatedInterests) {
      b.relatedInterests.split(',').forEach((item) => {
        const cleaned = item.trim();
        if (cleaned) interestsSet.add(cleaned);
      });
    }
  });

  if (interestsSet.size === 0) {
    alert('No related interests found in selected board(s).');
    return;
  }

  const lines = Array.from(interestsSet);
  switchTab('annotations');
  switchAnnSubTab('keywords');
  const kwInput = document.getElementById('annKeywordsInput');
  if (kwInput) {
    kwInput.value = lines.join('\n');
  }
}

function sendAllInterestsToAnnotations() {
  closeBoardContextMenu();
  if (state.boards.length === 0) {
    alert('No boards in grid.');
    return;
  }

  const interestsSet = new Set();
  state.boards.forEach((b) => {
    if (b.relatedInterests) {
      b.relatedInterests.split(',').forEach((item) => {
        const cleaned = item.trim();
        if (cleaned) interestsSet.add(cleaned);
      });
    }
  });

  if (interestsSet.size === 0) {
    alert('No related interests found in current boards.');
    return;
  }

  const lines = Array.from(interestsSet);
  switchTab('annotations');
  switchAnnSubTab('keywords');
  const kwInput = document.getElementById('annKeywordsInput');
  if (kwInput) {
    kwInput.value = lines.join('\n');
  }
}

// Checkboxes Submenu
function boardSelectAll() {
  closeBoardContextMenu();
  state.boards.forEach((b) => state.selected.boards.add(b.id));
  renderBoards();
}

function boardUnselectAll() {
  closeBoardContextMenu();
  state.selected.boards.clear();
  renderBoards();
}

function boardInvertSelection() {
  closeBoardContextMenu();
  state.boards.forEach((b) => {
    if (state.selected.boards.has(b.id)) {
      state.selected.boards.delete(b.id);
    } else {
      state.selected.boards.add(b.id);
    }
  });
  renderBoards();
}

// Filters Submenu
function boardClearFilters() {
  closeBoardContextMenu();
  state.filters.boards = [];
  const input = document.getElementById('boardsFilterInput');
  if (input) input.value = '';
  renderBoards();
}

// Copy Submenu
function boardCopySelectedRows() {
  closeBoardContextMenu();
  const sel = state.selected.boards;
  const items = state.boards.filter((b) => sel.has(b.id));
  if (items.length === 0) {
    alert('No selected boards to copy.');
    return;
  }
  const text = items.map((b) => [b.id, b.name, b.followerCount, b.pinCount, b.url, b.description, b.canJoin, b.isGroup, b.topic, b.lastModified, b.ownerName, b.ownerFollowers, b.ownerUsername].join('\t')).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${items.length} selected row(s) copied to clipboard!`);
}

function boardCopyAllRows() {
  closeBoardContextMenu();
  if (state.boards.length === 0) {
    alert('No rows to copy.');
    return;
  }
  const text = state.boards.map((b) => [b.id, b.name, b.followerCount, b.pinCount, b.url, b.description, b.canJoin, b.isGroup, b.topic, b.lastModified, b.ownerName, b.ownerFollowers, b.ownerUsername].join('\t')).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${state.boards.length} row(s) copied to clipboard!`);
}

function boardCopyBoardId() {
  closeBoardContextMenu();
  const b = state.boards.find((x) => x.id === contextBoardId);
  if (!b || !b.id) return;
  navigator.clipboard.writeText(b.id);
  alert(`Board ID "${b.id}" copied to clipboard!`);
}

function boardCopyBoardName() {
  closeBoardContextMenu();
  const b = state.boards.find((x) => x.id === contextBoardId);
  if (!b || !b.name) return;
  navigator.clipboard.writeText(b.name);
  alert(`Board Name "${b.name}" copied to clipboard!`);
}

function boardCopyBoardLink() {
  closeBoardContextMenu();
  const b = state.boards.find((x) => x.id === contextBoardId);
  const link = b?.url || `https://www.pinterest.com/board/${contextBoardId}/`;
  navigator.clipboard.writeText(link);
  alert(`Board Link copied to clipboard!`);
}

// Search Submenu
function boardSearchWeb(engine) {
  closeBoardContextMenu();
  const b = state.boards.find((x) => x.id === contextBoardId);
  if (!b) return;
  const encName = encodeURIComponent(b.name);
  if (engine === 'pinterest') window.open(b.url || `https://www.pinterest.com/search/boards/?q=${encName}`, '_blank');
  else if (engine === 'google') window.open(`https://www.google.com/search?q=${encName}+pinterest+board`, '_blank');
  else if (engine === 'bing') window.open(`https://www.bing.com/search?q=${encName}+pinterest+board`, '_blank');
}

// Preview Submenu
function boardPreviewBrowser() {
  closeBoardContextMenu();
  const b = state.boards.find((x) => x.id === contextBoardId);
  if (!b) return;
  window.open(b.url, '_blank');
}

// Auto Fit & Reset Column Widths
function boardAutoFitWidths() {
  closeBoardContextMenu();
  const table = document.getElementById('table-boards');
  if (table) table.style.tableLayout = 'auto';
}

function boardResetWidths() {
  closeBoardContextMenu();
  const table = document.getElementById('table-boards');
  if (table) table.style.tableLayout = '';
}

// Delete Submenu
function boardDeleteSelected() {
  closeBoardContextMenu();
  const sel = state.selected.boards;
  if (sel.size === 0) {
    alert('No rows selected to delete.');
    return;
  }
  state.boards = state.boards.filter((b) => !sel.has(b.id));
  sel.clear();
  renderBoards();
}

function exportBoardsCSV() {
  if (state.boards.length === 0) {
    alert('No boards to export.');
    return;
  }
  const headers = [
    'Image', 'Board ID', 'Board Name', 'Board Followers', 'Pin Count', 'Board Link',
    'Description', 'Can Join Board', 'Is Group Board', 'Topic', 'Last Modified',
    'Owner Name', 'Owner Followers', 'Owner Username', 'Owner Country', 'Owner Url',
    'Related Interests'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = state.boards.map((b) => [
    escapeCSV(b.coverImage || b.image || ''),
    escapeCSV(b.id || ''),
    escapeCSV(b.name || ''),
    escapeCSV(b.followerCount || 0),
    escapeCSV(b.pinCount || 0),
    escapeCSV(b.url || ''),
    escapeCSV(b.description || 'not-given'),
    escapeCSV(b.canJoin || 'NO'),
    escapeCSV(b.isGroup || 'NO'),
    escapeCSV(b.topic || 'not-given'),
    escapeCSV(b.lastModified || '—'),
    escapeCSV(b.ownerName || ''),
    escapeCSV(b.ownerFollowers || 0),
    escapeCSV(b.ownerUsername || ''),
    escapeCSV(b.ownerCountry || 'not-given'),
    escapeCSV(b.ownerUrl || ''),
    escapeCSV(b.relatedInterests || ''),
  ].join(','));

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  downloadFile(`PinInspector_Boards_${Date.now()}.csv`, csvContent, 'text/csv;charset=utf-8;');
}

function exportBoardsHTML() {
  if (state.boards.length === 0) {
    alert('No boards to export.');
    return;
  }
  const rows = state.boards.map((b) => `
    <tr>
      <td>${b.coverImage ? `<img src="${b.coverImage}" width="30" height="30" style="object-fit:cover;">` : ''}</td>
      <td>${escapeHtml(b.id || '')}</td>
      <td>${escapeHtml(b.name || '')}</td>
      <td>${(Number(b.followerCount) || 0).toLocaleString()}</td>
      <td>${(Number(b.pinCount) || 0).toLocaleString()}</td>
      <td><a href="${b.url}" target="_blank">${escapeHtml(b.url || '')}</a></td>
      <td>${escapeHtml(b.description || 'not-given')}</td>
      <td>${b.canJoin || 'NO'}</td>
      <td>${b.isGroup || 'NO'}</td>
      <td>${escapeHtml(b.topic || 'not-given')}</td>
      <td>${escapeHtml(b.lastModified || '')}</td>
      <td>${escapeHtml(b.ownerName || '')}</td>
      <td>${(Number(b.ownerFollowers) || 0).toLocaleString()}</td>
      <td>@${escapeHtml(b.ownerUsername || '')}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pin Inspector - Boards Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
  </style>
</head>
<body>
  <h2>Pin Inspector - Boards Report (${state.boards.length} Boards)</h2>
  <table>
    <thead>
      <tr>
        <th>Image</th><th>Board ID</th><th>Board Name</th><th>Followers</th><th>Pins</th><th>Link</th><th>Description</th><th>Can Join</th><th>Is Group</th><th>Topic</th><th>Modified</th><th>Owner</th><th>Owner Followers</th><th>Username</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
  downloadFile(`PinInspector_Boards_${Date.now()}.html`, html, 'text/html');
}

function saveBoardsProject() {
  const data = {
    type: 'PinInspectorBoardsProject',
    createdAt: new Date().toISOString(),
    boards: state.boards,
  };
  downloadFile(`PinInspector_Boards_${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

// ----------------------------------------------------------------------
// 4. PEOPLE / ACCOUNTS ANALYZER (UserGrid)
// ----------------------------------------------------------------------
async function searchUsers() {
  const query = (document.getElementById('usersInput')?.value || '').trim();
  if (!query) {
    alert('Please enter a search phrase.');
    return;
  }
  const count = document.getElementById('usersTotalSelect')?.value || '50';

  const btn = document.getElementById('usersSearchBtn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Searching...`;
  }

  try {
    const res = await fetch(`/api/users?query=${encodeURIComponent(query)}&count=${encodeURIComponent(count)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.users = data.users || [];
    state.selected.users.clear();
    renderUsers();
  } catch (err) {
    alert(`Failed to search users: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

document.getElementById('usersForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  searchUsers();
});

function changeUsersImageSize(val) {
  state.usersImageSize = parseInt(val, 10) || 25;
  const label = document.getElementById('usersImageSizeLabel');
  if (label) label.textContent = `${state.usersImageSize} px`;
  renderUsers();
}

function toggleUsersWrapText(checked) {
  const table = document.getElementById('table-users');
  if (table) {
    if (checked) {
      table.classList.remove('whitespace-nowrap');
      table.classList.add('break-words');
    } else {
      table.classList.add('whitespace-nowrap');
      table.classList.remove('break-words');
    }
  }
}

function openUserBrowser() {
  const query = (document.getElementById('usersInput')?.value || '').trim();
  const url = query ? `https://www.pinterest.com/search/users/?q=${encodeURIComponent(query)}` : 'https://www.pinterest.com/';
  window.open(url, '_blank');
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  const statsBar = document.getElementById('usersStatsBar');
  const imgSize = state.usersImageSize || 25;

  if (state.users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="23" class="py-12 text-center text-slate-400">No accounts in view.</td></tr>`;
    statsBar?.classList.add('hidden');
    return;
  }

  statsBar?.classList.remove('hidden');
  const filtered = getFilteredData('users', state.users);

  document.getElementById('usersCount').textContent = filtered.length;
  const totalFollowers = filtered.reduce((acc, u) => acc + (u.followers || 0), 0);
  document.getElementById('usersTotalFollowers').textContent = totalFollowers.toLocaleString();
  const totalViews = filtered.reduce((acc, u) => acc + (u.profileViews || 0), 0);
  const totalViewsEl = document.getElementById('usersTotalViews');
  if (totalViewsEl) totalViewsEl.textContent = totalViews.toLocaleString();
  const totalReach = filtered.reduce((acc, u) => acc + (u.profileReach || 0), 0);
  const totalReachEl = document.getElementById('usersTotalReach');
  if (totalReachEl) totalReachEl.textContent = totalReach.toLocaleString();

  updateFilterBadge('users');

  tbody.innerHTML = filtered
    .map((u, index) => {
      const isChecked = state.selected.users.has(u.username);
      const userUrl = u.url || `https://www.pinterest.com/${u.username}/`;
      const userId = u.id || u.userId || '';
      const pinCountNum = Number(u.pinCount) || 0;
      const boardCountNum = Number(u.boardCount) || 0;

      return `
      <tr oncontextmenu="openUserContextMenu(event, '${escapeQuotes(u.username)}')" class="hover:bg-slate-50 transition-colors border-b border-slate-100 cursor-context-menu ${isChecked ? 'bg-red-50/50' : ''}">
        <td class="py-2 px-3 text-center border-r border-slate-100">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleSelectRow('users', '${escapeQuotes(u.username)}', this.checked)">
        </td>
        <td class="py-2 px-2.5 text-center text-xs text-slate-400 font-mono col-users-rank border-r border-slate-100">${index + 1}</td>
        <td class="py-1.5 px-3 text-center col-users-avatar border-r border-slate-100">
          <a href="${userUrl}" target="_blank" class="inline-block rounded-full overflow-hidden bg-slate-100 shadow-xs border border-slate-200" style="width:${imgSize}px; height:${imgSize}px;">
            <img src="${u.image || 'https://assets.pinterest.com/images/user/default_140.png'}" alt="avatar" referrerpolicy="no-referrer" class="w-full h-full object-cover">
          </a>
        </td>
        <td class="py-2 px-3 font-mono text-xs col-users-id border-r border-slate-100">
          <a href="${userUrl}" target="_blank" class="text-blue-600 hover:underline font-bold">${escapeHtml(userId)}</a>
        </td>
        <td class="py-2 px-3 font-medium text-slate-900 col-users-user border-r border-slate-100">
          <a href="${userUrl}" target="_blank" class="hover:text-red-600 font-semibold">${escapeHtml(u.username)}</a>
        </td>
        <td class="py-2 px-3 text-slate-800 col-users-name border-r border-slate-100">${escapeHtml(u.fullName || u.name || u.username)}</td>
        <td class="py-2 px-3 text-center font-mono font-bold text-red-600 col-users-followers border-r border-slate-100">${(Number(u.followers) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-600 col-users-following border-r border-slate-100">${(Number(u.following) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-600 col-users-boards border-r border-slate-100">${boardCountNum.toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono font-bold text-slate-800 col-users-pins border-r border-slate-100">${pinCountNum.toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-600 col-users-videopins border-r border-slate-100">${(Number(u.videoPinCount) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-600 col-users-storepins border-r border-slate-100">${(Number(u.storePinCount) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-600 col-users-interests border-r border-slate-100">${(Number(u.interestCount) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono font-semibold text-slate-800 col-users-profileviews border-r border-slate-100">${(Number(u.profileViews) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono font-semibold text-slate-800 col-users-profilereach border-r border-slate-100">${(Number(u.profileReach) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-600 col-users-groupboards border-r border-slate-100">${(Number(u.groupBoardCount) || 0).toLocaleString()}</td>
        <td class="py-2 px-3 text-slate-600 truncate max-w-[140px] col-users-lastpin border-r border-slate-100" title="${escapeQuotes(u.lastPin || '')}">${escapeHtml(u.lastPin || '')}</td>
        <td class="py-2 px-3 text-slate-600 truncate max-w-[120px] col-users-location border-r border-slate-100" title="${escapeQuotes(u.location || '')}">${escapeHtml(u.location || '')}</td>
        <td class="py-2 px-3 text-blue-600 truncate max-w-[140px] col-users-website border-r border-slate-100">
          ${u.website ? `<a href="${u.website.startsWith('http') ? u.website : 'http://' + u.website}" target="_blank" class="hover:underline">${escapeHtml(u.website)}</a>` : ''}
        </td>
        <td class="py-2 px-3 text-center col-users-domainverified border-r border-slate-100">
          ${u.domainVerified ? '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">YES</span>' : '<span class="text-slate-400">NO</span>'}
        </td>
        <td class="py-2 px-3 text-center col-users-merchantverified border-r border-slate-100">
          ${u.merchantVerified ? '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">YES</span>' : '<span class="text-slate-400">NO</span>'}
        </td>
        <td class="py-2 px-3 text-slate-600 truncate max-w-[200px] col-users-about border-r border-slate-100" title="${escapeQuotes(u.about || '')}">${escapeHtml(u.about || '')}</td>
        <td class="py-2 px-3 text-right space-x-1 whitespace-nowrap col-users-actions">
          <button onclick="openAnalyzeUserPinsModal('${escapeQuotes(u.username)}', ${pinCountNum})" class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-semibold shadow-xs transition-colors" title="Extract Pins for Given User">
            <i class="ph ph-push-pin"></i> Pins
          </button>
          <button onclick="openAnalyzeUserBoardsModal('${escapeQuotes(u.username)}', ${boardCountNum})" class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-medium" title="Analyze User Boards">
            <i class="ph ph-squares-four"></i> Boards
          </button>
          <button onclick="addBookmark('user', { username: '${escapeQuotes(u.username)}', title: '${escapeQuotes(u.fullName || u.username)}', url: '${userUrl}' })" class="inline-flex items-center p-1 rounded text-slate-400 hover:text-amber-500" title="Bookmark User">
            <i class="ph ph-star text-sm"></i>
          </button>
        </td>
      </tr>
    `;
    })
    .join('');

  applyColumnVisibility('users');
}

function sortUsers(field) {
  if (state.usersSort.field === field) {
    state.usersSort.asc = !state.usersSort.asc;
  } else {
    state.usersSort.field = field;
    state.usersSort.asc = false;
  }
  state.users.sort((a, b) => {
    const valA = a[field] ?? 0;
    const valB = b[field] ?? 0;
    if (typeof valA === 'string' || typeof valB === 'string') {
      return state.usersSort.asc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    }
    return state.usersSort.asc ? (Number(valA) || 0) - (Number(valB) || 0) : (Number(valB) || 0) - (Number(valA) || 0);
  });
  renderUsers();
}

function clearUsersGrid() {
  if (confirm('Clear all accounts from grid?')) {
    state.users = [];
    state.selected.users.clear();
    renderUsers();
    updateSelectionBar();
  }
}

// ----------------------------------------------------------------------
// 5. PIN ANNOTATIONS (AnnotationGrid - 100% Pin Inspector 2 Parity)
// ----------------------------------------------------------------------
let currentAnnAbortController = null;
let currentAnnSubTab = 'search';

function switchAnnSubTab(tab) {
  currentAnnSubTab = tab;
  ['search', 'pins', 'keywords'].forEach((t) => {
    const btn = document.getElementById(`subtab-ann-${t}`);
    const pane = document.getElementById(`ann-pane-${t}`);
    if (t === tab) {
      btn?.classList.add('border-red-600', 'text-red-600');
      btn?.classList.remove('border-transparent', 'text-slate-500');
      pane?.classList.remove('hidden');
    } else {
      btn?.classList.remove('border-red-600', 'text-red-600');
      btn?.classList.add('border-transparent', 'text-slate-500');
      pane?.classList.add('hidden');
    }
  });
}

async function startAnnotationsSearch() {
  const phrase = document.getElementById('annSearchPhrase').value.trim();
  const count = document.getElementById('annTotalResults').value;
  const searchIn = document.getElementById('annSearchIn').value;

  if (!phrase) return alert('Please enter a search phrase.');

  const searchBtn = document.getElementById('annSearchBtn');
  const stopBtn = document.getElementById('annStopBtn');
  const progContainer = document.getElementById('annProgressContainer');
  const progBar = document.getElementById('annProgressBar');
  const progText = document.getElementById('annProgressText');
  const progPercent = document.getElementById('annProgressPercent');

  searchBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  progContainer.classList.remove('hidden');
  progBar.style.width = '0%';
  progPercent.textContent = '0%';
  progText.textContent = 'Harvesting candidate pins from Pinterest...';

  state.annotations = [];
  state.selected.annotations.clear();
  renderAnnotations();

  currentAnnAbortController = new AbortController();

  try {
    const url = `/api/annotations/search?phrase=${encodeURIComponent(phrase)}&count=${count}&searchIn=${searchIn}&stream=true`;
    const response = await fetch(url, { signal: currentAnnAbortController.signal });

    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'progress') {
            progText.textContent = event.message;
            const pct = Math.min(100, Math.round((event.current / event.total) * 100));
            progBar.style.width = `${pct}%`;
            progPercent.textContent = `${pct}%`;
          } else if (event.type === 'row') {
            state.annotations.push(event.row);
            const pct = Math.min(100, Math.round((event.current / event.total) * 100));
            progBar.style.width = `${pct}%`;
            progPercent.textContent = `${pct}%`;
            progText.textContent = `Enriched annotation ${event.current} of ${event.total}: ${event.row.annotation}`;
            renderAnnotations();
          } else if (event.type === 'done') {
            progBar.style.width = '100%';
            progPercent.textContent = '100%';
            progText.textContent = `Done. Successfully extracted ${event.total} annotations.`;
          } else if (event.type === 'error') {
            alert(`Error: ${event.error}`);
          }
        } catch (e) {
          console.error('Error parsing SSE event:', e);
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      alert(`Search error: ${err.message}`);
    }
  } finally {
    searchBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    currentAnnAbortController = null;
    renderAnnotations();
  }
}

function stopAnnotationsSearch() {
  if (currentAnnAbortController) {
    currentAnnAbortController.abort();
    currentAnnAbortController = null;
    document.getElementById('annProgressText').textContent = 'Extraction stopped by user.';
  }
}

async function extractAnnotationsFromPinsLinks() {
  const text = document.getElementById('annPinsLinksInput').value.trim();
  if (!text) {
    return alert('There are no pin links provided. Enter one pin link per line.');
  }

  const links = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (links.length === 0) return;

  const btn = document.getElementById('annPinsExtractBtn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Extracting...`;

  try {
    const res = await fetch('/api/annotations/from-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newRows = data.results || [];
    if (newRows.length === 0) {
      alert('No annotations found for the provided pin link(s).');
    } else {
      state.annotations = newRows;
    }
    state.selected.annotations.clear();
    renderAnnotations();
  } catch (err) {
    alert(`Failed to extract from pin links: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function extractAnnotationsFromKeywords() {
  const text = document.getElementById('annKeywordsInput').value.trim();
  if (!text) {
    return alert('Enter at least one keyword (one per line).');
  }

  const keywords = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (keywords.length === 0) return;

  const btn = document.getElementById('annKeywordsExtractBtn');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Extracting...`;

  try {
    const res = await fetch('/api/annotations/from-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newRows = data.results || [];
    if (newRows.length === 0) {
      alert('No annotations found for the provided keyword(s).');
    } else {
      state.annotations = newRows;
    }
    state.selected.annotations.clear();
    renderAnnotations();
  } catch (err) {
    alert(`Failed to extract from keywords: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

let highlightedAnnotation = null;

function setHighlightedAnnotation(name) {
  highlightedAnnotation = name;
  const rows = document.querySelectorAll('#annTableBody tr');
  rows.forEach((r) => {
    const tag = r.querySelector('.col-ann-tag')?.textContent?.trim();
    if (tag === name) {
      r.classList.add('bg-blue-100/70');
    } else {
      r.classList.remove('bg-blue-100/70');
    }
  });
}

function openAnnotationContextMenu(e, annotationName) {
  e.preventDefault();
  setHighlightedAnnotation(annotationName);

  const menu = document.getElementById('annotationContextMenu');
  if (!menu) return;

  menu.classList.remove('hidden');

  let x = e.clientX;
  let y = e.clientY;
  const menuWidth = 280;
  const menuHeight = 480;

  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 10;
  }

  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;
}

function closeAnnotationContextMenu() {
  document.getElementById('annotationContextMenu')?.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#annotationContextMenu')) {
    closeAnnotationContextMenu();
  }
});

async function executeGetRelated(selectedItems) {
  if (!selectedItems || selectedItems.length === 0) return;

  const btn = document.getElementById('btnGetRelated');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Extracting...`;
  }

  try {
    const res = await fetch('/api/annotations/related', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: selectedItems }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newRows = data.results || [];
    if (newRows.length === 0) {
      return alert('No related annotation keywords were found for the selected annotations.');
    }

    const seen = new Set(state.annotations.map((a) => a.annotation.toLowerCase()));
    let added = 0;
    for (const r of newRows) {
      if (!seen.has(r.annotation.toLowerCase())) {
        seen.add(r.annotation.toLowerCase());
        state.annotations.push(r);
        added++;
      }
    }
    renderAnnotations();
    alert(`Successfully added ${added} related annotations to the data grid.`);
  } catch (err) {
    alert(`Error getting related annotations: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function executeGetAdditions(selectedItems) {
  if (!selectedItems || selectedItems.length === 0) return;

  const btn = document.getElementById('btnGetAdditions');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Extracting...`;
  }

  try {
    const res = await fetch('/api/annotations/additions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: selectedItems }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const newRows = data.results || [];
    if (newRows.length === 0) {
      return alert('No additional attached words were found for the selected annotations.');
    }

    const seen = new Set(state.annotations.map((a) => a.annotation.toLowerCase()));
    let added = 0;
    for (const r of newRows) {
      if (!seen.has(r.annotation.toLowerCase())) {
        seen.add(r.annotation.toLowerCase());
        state.annotations.push(r);
        added++;
      }
    }
    renderAnnotations();
    alert(`Successfully added ${added} additions to the data grid.`);
  } catch (err) {
    alert(`Error getting additions: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

async function getRelatedAnnotations() {
  if (state.annotations.length === 0) {
    return alert('No data in the data grid. You must first generate a list of annotations before extracting related annotations.');
  }
  let selectedItems = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selectedItems.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selectedItems = [t];
  }
  if (selectedItems.length === 0) {
    return alert('No rows are selected. You must click the checkboxes in the first column or right-click an annotation row.');
  }
  await executeGetRelated(selectedItems);
}

async function getAdditionsAnnotations() {
  if (state.annotations.length === 0) {
    return alert('No data in the data grid. You must first generate a list of annotations before extracting additions.');
  }
  let selectedItems = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selectedItems.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selectedItems = [t];
  }
  if (selectedItems.length === 0) {
    return alert('No rows are selected. You must click the checkboxes in the first column or right-click an annotation row.');
  }
  await executeGetAdditions(selectedItems);
}

function annContextGetRelated() {
  closeAnnotationContextMenu();
  getRelatedAnnotations();
}

function annContextGetAdditions() {
  closeAnnotationContextMenu();
  getAdditionsAnnotations();
}

async function reExtractAnnotations(targetRows) {
  if (!targetRows || targetRows.length === 0) return;
  const keywords = targetRows.map((r) => r.annotation);
  try {
    const res = await fetch('/api/annotations/from-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords }),
    });
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const updatedMap = new Map(data.results.map((r) => [r.annotation.toLowerCase(), r]));
      for (let i = 0; i < state.annotations.length; i++) {
        const match = updatedMap.get(state.annotations[i].annotation.toLowerCase());
        if (match) {
          state.annotations[i] = match;
        }
      }
      renderAnnotations();
      alert(`Successfully re-extracted ${data.results.length} annotation(s)!`);
    }
  } catch (e) {
    alert(`Re-extraction failed: ${e.message}`);
  }
}

async function annContextReExtractZero() {
  closeAnnotationContextMenu();
  const zeroRows = state.annotations.filter((a) => !a.searchVolume || Number(a.searchVolume) === 0);
  if (zeroRows.length === 0) {
    return alert('No rows with zero search volume found in the data grid.');
  }
  await reExtractAnnotations(zeroRows);
}

async function annContextReExtractSelected() {
  closeAnnotationContextMenu();
  let selected = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selected.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selected = [t];
  }
  if (selected.length === 0) return alert('No rows selected to re-extract.');
  await reExtractAnnotations(selected);
}

async function annContextReExtractAll() {
  closeAnnotationContextMenu();
  if (state.annotations.length === 0) return alert('No rows to re-extract.');
  await reExtractAnnotations(state.annotations);
}

function annContextSendSelectedToTrends() {
  closeAnnotationContextMenu();
  let selected = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selected.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selected = [t];
  }
  if (selected.length === 0) return alert('No rows selected.');
  const terms = selected.map((a) => a.annotation);
  sendToTrends(terms);
}

function annContextSendAllToTrends() {
  closeAnnotationContextMenu();
  if (state.annotations.length === 0) return alert('No rows to send.');
  const terms = state.annotations.map((a) => a.annotation);
  sendToTrends(terms);
}

function annContextSendSelectedToKeywords() {
  closeAnnotationContextMenu();
  let selected = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selected.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selected = [t];
  }
  if (selected.length === 0) return alert('No rows selected.');
  const terms = selected.map((a) => a.annotation);
  switchTab('keywords');
  const input = document.getElementById('kwInput');
  if (input) input.value = terms.join(', ');
}

function annSelectAll() {
  closeAnnotationContextMenu();
  state.annotations.forEach((a) => state.selected.annotations.add(a.annotation));
  renderAnnotations();
}

function annUnselectAll() {
  closeAnnotationContextMenu();
  state.selected.annotations.clear();
  renderAnnotations();
}

function annContextSelectHighlighted() {
  closeAnnotationContextMenu();
  if (highlightedAnnotation) {
    state.selected.annotations.add(highlightedAnnotation);
    renderAnnotations();
  }
}

function annContextUnselectHighlighted() {
  closeAnnotationContextMenu();
  if (highlightedAnnotation) {
    state.selected.annotations.delete(highlightedAnnotation);
    renderAnnotations();
  }
}

function annCopySelectedAnnotations() {
  closeAnnotationContextMenu();
  let selected = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selected.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selected = [t];
  }
  if (selected.length === 0) return alert('No rows selected.');
  navigator.clipboard.writeText(selected.map((a) => a.annotation).join('\n'));
  alert(`Copied ${selected.length} annotation(s) to clipboard!`);
}

function annCopyAllAnnotations() {
  closeAnnotationContextMenu();
  if (state.annotations.length === 0) return alert('No rows to copy.');
  navigator.clipboard.writeText(state.annotations.map((a) => a.annotation).join('\n'));
  alert(`Copied ${state.annotations.length} annotation(s) to clipboard!`);
}

function annCopySelectedRows() {
  closeAnnotationContextMenu();
  let selected = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  if (selected.length === 0 && highlightedAnnotation) {
    const t = state.annotations.find((a) => a.annotation === highlightedAnnotation);
    if (t) selected = [t];
  }
  if (selected.length === 0) return alert('No rows selected.');
  const tsv = selected
    .map((a) =>
      [
        a.annotation,
        a.wordCount || 0,
        a.charCount || 0,
        a.searchVolume || 0,
        a.followerCount || 0,
        a.lastUpdated || '',
        a.annotationId || '',
        a.categoryTree || '',
        a.annotationLink || '',
      ].join('\t')
    )
    .join('\n');
  navigator.clipboard.writeText(tsv);
  alert(`Copied ${selected.length} row(s) to clipboard!`);
}

function annCopyAllRows() {
  closeAnnotationContextMenu();
  if (state.annotations.length === 0) return alert('No rows to copy.');
  const tsv = state.annotations
    .map((a) =>
      [
        a.annotation,
        a.wordCount || 0,
        a.charCount || 0,
        a.searchVolume || 0,
        a.followerCount || 0,
        a.lastUpdated || '',
        a.annotationId || '',
        a.categoryTree || '',
        a.annotationLink || '',
      ].join('\t')
    )
    .join('\n');
  navigator.clipboard.writeText(tsv);
  alert(`Copied ${state.annotations.length} row(s) to clipboard!`);
}

function annSearchWeb(engine) {
  closeAnnotationContextMenu();
  const term = highlightedAnnotation || (state.selected.annotations.size > 0 ? Array.from(state.selected.annotations)[0] : '');
  if (!term) return;
  const q = encodeURIComponent(term);
  if (engine === 'google') window.open(`https://www.google.com/search?q=${q}`, '_blank');
  else if (engine === 'trends') window.open(`https://trends.google.com/trends/explore?q=${q}`, '_blank');
  else if (engine === 'shopping') window.open(`https://www.google.com/search?tbm=shop&q=${q}`, '_blank');
  else if (engine === 'amazon') window.open(`https://www.amazon.com/s?k=${q}`, '_blank');
  else if (engine === 'etsy') window.open(`https://www.etsy.com/search?q=${q}`, '_blank');
  else if (engine === 'ebay') window.open(`https://www.ebay.com/sch/i.html?_nkw=${q}`, '_blank');
}

function annDeleteSelected() {
  closeAnnotationContextMenu();
  if (state.selected.annotations.size === 0 && !highlightedAnnotation) return alert('No rows selected.');
  const toDelete = new Set(state.selected.annotations);
  if (toDelete.size === 0 && highlightedAnnotation) toDelete.add(highlightedAnnotation);
  state.annotations = state.annotations.filter((a) => !toDelete.has(a.annotation));
  state.selected.annotations.clear();
  highlightedAnnotation = null;
  renderAnnotations();
}

function annDeleteUnselected() {
  closeAnnotationContextMenu();
  if (state.selected.annotations.size === 0) return alert('No rows selected.');
  state.annotations = state.annotations.filter((a) => state.selected.annotations.has(a.annotation));
  renderAnnotations();
}

function annRemoveDuplicates() {
  closeAnnotationContextMenu();
  const seen = new Set();
  const unique = [];
  for (const a of state.annotations) {
    const k = a.annotation.toLowerCase().trim();
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(a);
    }
  }
  state.annotations = unique;
  renderAnnotations();
  alert(`Removed duplicates. ${unique.length} unique annotations remaining.`);
}

let sortAnnCol = null;
let sortAnnAsc = true;
function sortAnnotations(col) {
  if (sortAnnCol === col) {
    sortAnnAsc = !sortAnnAsc;
  } else {
    sortAnnCol = col;
    sortAnnAsc = true;
  }
  state.annotations.sort((a, b) => {
    let va = a[col] ?? '';
    let vb = b[col] ?? '';
    if (typeof va === 'number' && typeof vb === 'number') {
      return sortAnnAsc ? va - vb : vb - va;
    }
    va = String(va).toLowerCase();
    vb = String(vb).toLowerCase();
    if (va < vb) return sortAnnAsc ? -1 : 1;
    if (va > vb) return sortAnnAsc ? 1 : -1;
    return 0;
  });
  renderAnnotations();
}

function renderAnnotations() {
  const tbody = document.getElementById('annTableBody');
  const countEl = document.getElementById('annCount');
  const selEl = document.getElementById('annSelectedCount');

  if (state.annotations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="py-12 text-center text-slate-400">Enter a search phrase and click Search to extract Pinterest annotations.</td></tr>`;
    if (countEl) countEl.textContent = '0';
    if (selEl) selEl.textContent = '0';
    return;
  }

  const filtered = getFilteredData('annotations', state.annotations);
  if (countEl) countEl.textContent = filtered.length;
  if (selEl) selEl.textContent = state.selected.annotations.size;
  updateFilterBadge('annotations');

  tbody.innerHTML = filtered
    .map((a) => {
      const isChecked = state.selected.annotations.has(a.annotation);
      const isHighlighted = highlightedAnnotation === a.annotation;
      const sv = a.searchVolume !== undefined && a.searchVolume !== null ? Number(a.searchVolume).toLocaleString('en-US') : '0';
      const fc = a.followerCount !== undefined && a.followerCount !== null ? Number(a.followerCount).toLocaleString('en-US') : '0';
      const link = a.annotationLink || (a.annotationId ? `https://www.pinterest.com/ideas/${encodeURIComponent(a.annotation.toLowerCase().replace(/\s+/g, '-'))}/${a.annotationId}/` : '');

      return `
      <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 ${isChecked ? 'bg-red-50/50' : (isHighlighted ? 'bg-blue-100/70 font-medium' : '')}"
          oncontextmenu="openAnnotationContextMenu(event, '${escapeQuotes(a.annotation)}')"
          onclick="setHighlightedAnnotation('${escapeQuotes(a.annotation)}')">
        <td class="py-3 px-3 text-center border-r border-slate-100">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleSelectRow('annotations', '${escapeQuotes(a.annotation)}', this.checked)">
        </td>
        <td class="py-3 px-4 font-semibold text-slate-900 col-ann-tag border-r border-slate-100">${escapeHtml(a.annotation)}</td>
        <td class="py-3 px-3 text-center font-mono text-slate-600 col-ann-words border-r border-slate-100">${a.wordCount ?? 0}</td>
        <td class="py-3 px-3 text-center font-mono text-slate-600 col-ann-chars border-r border-slate-100">${a.charCount ?? 0}</td>
        <td class="py-3 px-3 text-center font-mono text-slate-800 font-semibold col-ann-vol border-r border-slate-100">${sv}</td>
        <td class="py-3 px-3 text-center font-mono text-slate-700 col-ann-followers border-r border-slate-100">${fc}</td>
        <td class="py-3 px-3 text-center text-xs text-slate-600 font-mono col-ann-updated border-r border-slate-100">${escapeHtml(a.lastUpdated || '')}</td>
        <td class="py-3 px-3 text-center font-mono text-xs text-slate-500 col-ann-id border-r border-slate-100">${escapeHtml(a.annotationId || '')}</td>
        <td class="py-3 px-4 text-xs text-slate-700 col-ann-tree border-r border-slate-100" title="${escapeHtml(a.categoryTree || '')}">${escapeHtml(a.categoryTree || '')}</td>
        <td class="py-3 px-4 text-center col-ann-link">
          ${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-slate-100 text-red-600 hover:bg-slate-200 font-medium transition-colors"><i class="ph ph-arrow-square-out text-sm"></i> Link</a>` : '<span class="text-slate-300">—</span>'}
        </td>
      </tr>
    `;
    })
    .join('');

  applyColumnVisibility('annotations');
}

function clearAnnotationsGrid() {
  if (confirm('Clear all annotations from grid?')) {
    state.annotations = [];
    state.selected.annotations.clear();
    highlightedAnnotation = null;
    renderAnnotations();
    updateSelectionBar();
  }
}

// ----------------------------------------------------------------------
// 6. PINTEREST TRENDS (TrendGrid - 100% Reverse-Engineered Delphi Implementation)
// ----------------------------------------------------------------------
let trendsAbortController = null;

function renderSparklineSvg(counts, width = 110, height = 30) {
  if (!counts || !Array.isArray(counts) || counts.length < 2) {
    return '<span class="text-slate-300 text-[10px]">—</span>';
  }
  const paddingX = 2;
  const paddingY = 3;
  const usableW = width - paddingX * 2;
  const usableH = height - paddingY * 2;
  const step = usableW / (counts.length - 1);

  const points = counts.map((c, i) => {
    const x = (paddingX + i * step).toFixed(1);
    const clamped = Math.max(0, Math.min(100, Number(c) || 0));
    const y = (height - paddingY - (clamped / 100) * usableH).toFixed(1);
    return `${x},${y}`;
  });

  const d = `M ${points.join(' L ')}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="block mx-auto overflow-visible">
    <path d="${d}" fill="none" stroke="#e53935" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

async function generateTrends() {
  const phraseInput = document.getElementById('trendSearchInput');
  const phrase = (phraseInput?.value || '').trim();
  const country = document.getElementById('trendCountrySelect')?.value || 'US';

  if (!phrase) {
    alert('Please enter a Seed Search Phrase.');
    phraseInput?.focus();
    return;
  }

  // Clear previous results
  state.trends = [];
  state.selected.trends.clear();
  renderTrends();

  const progressContainer = document.getElementById('trendProgressContainer');
  const progressBar = document.getElementById('trendProgressBar');
  const progressLabel = document.getElementById('trendProgressLabel');
  const statusCenter = document.getElementById('trendStatusCenter');

  if (progressContainer) progressContainer.classList.remove('hidden');
  if (progressBar) progressBar.style.width = '0%';
  if (progressLabel) progressLabel.textContent = `Starting seed: "${phrase}"...`;
  if (statusCenter) statusCenter.textContent = 'Generating...';

  if (trendsAbortController) {
    trendsAbortController.abort();
  }
  trendsAbortController = new AbortController();

  try {
    const streamUrl = `/api/trends/generate?phrase=${encodeURIComponent(phrase)}&country=${country}&stream=true`;
    const response = await fetch(streamUrl, { signal: trendsAbortController.signal });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.type === 'progress') {
            const pct = Math.round((payload.current / payload.total) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressLabel) progressLabel.textContent = payload.message;
            if (statusCenter) statusCenter.textContent = payload.message;
          } else if (payload.type === 'items') {
            for (const item of payload.items) {
              state.trends.push(item);
            }
            renderTrends();
          } else if (payload.type === 'done') {
            if (progressBar) progressBar.style.width = '100%';
            if (progressLabel) progressLabel.textContent = payload.message || 'Done';
            if (statusCenter) statusCenter.textContent = `Seed: "${phrase}" ( 37 of 37 )`;
          } else if (payload.type === 'error') {
            alert(`Trends error: ${payload.error}`);
          }
        } catch (e) {
          console.error('Error parsing trends event:', e);
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('generateTrends error:', err);
      alert(`Trends generation failed: ${err.message}`);
    }
  } finally {
    trendsAbortController = null;
    if (progressContainer) progressContainer.classList.add('hidden');
    renderTrends();
  }
}

function stopTrends() {
  if (trendsAbortController) {
    trendsAbortController.abort();
    trendsAbortController = null;
  }
  const progressContainer = document.getElementById('trendProgressContainer');
  if (progressContainer) progressContainer.classList.add('hidden');
  const statusCenter = document.getElementById('trendStatusCenter');
  if (statusCenter) statusCenter.textContent = 'Stopped';
}

async function loadLatestTrends() {
  const country = document.getElementById('trendCountrySelect')?.value || 'US';
  const tbody = document.getElementById('trendsTableBody');
  const statusCenter = document.getElementById('trendStatusCenter');
  if (statusCenter) statusCenter.textContent = 'Loading latest trends...';
  tbody.innerHTML = `<tr><td colspan="12" class="py-12 text-center text-slate-400"><i class="ph ph-spinner animate-spin text-xl inline-block mr-2"></i> Loading official Pinterest Latest Trends...</td></tr>`;

  try {
    const res = await fetch(`/api/trends/latest?country=${country}&count=50`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.trends = data.items || [];
    state.selected.trends.clear();
    if (statusCenter) statusCenter.textContent = `Loaded ${state.trends.length} latest trends`;
    renderTrends();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="py-12 text-center text-red-500">Failed to load latest trends: ${err.message}</td></tr>`;
  }
}

function openTrendsImportModal() {
  const input = prompt('Enter keywords to import into Trends (one per line):');
  if (!input) return;
  const keywords = input.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  if (keywords.length === 0) return;
  importTrendsKeywords(keywords);
}

async function importTrendsKeywords(keywords) {
  const country = document.getElementById('trendCountrySelect')?.value || 'US';
  const statusCenter = document.getElementById('trendStatusCenter');
  if (statusCenter) statusCenter.textContent = `Importing ${keywords.length} keywords...`;

  try {
    const res = await fetch('/api/trends/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords, country }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    for (const it of (data.items || [])) {
      state.trends.push(it);
    }
    if (statusCenter) statusCenter.textContent = `Imported ${data.items.length} trend keywords`;
    renderTrends();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
}

function sortTrends(field) {
  if (!state.trendSort) state.trendSort = { field: null, asc: true };
  if (state.trendSort.field === field) {
    state.trendSort.asc = !state.trendSort.asc;
  } else {
    state.trendSort.field = field;
    state.trendSort.asc = true;
  }

  const cols = ['term', 'seed', 'country', 'wordCount', 'charCount', 'avg1m', 'avg3m', 'avg6m', 'avgTot', 'trendSlope', 'trendingSpike'];
  for (const c of cols) {
    const el = document.getElementById(`sort-trend-${c}`);
    if (el) {
      if (c === field) {
        el.textContent = state.trendSort.asc ? '▲' : '▼';
        el.classList.add('text-red-600', 'font-bold');
      } else {
        el.textContent = '';
      }
    }
  }

  renderTrends();
}

function renderTrends() {
  const tbody = document.getElementById('trendsTableBody');
  if (!tbody) return;

  if (state.trends.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="py-12 text-center text-slate-400">Enter a seed search phrase and click Generate to extract Pinterest trends.</td></tr>`;
    const tot = document.getElementById('trendTotalCount');
    if (tot) tot.textContent = '0';
    const sel = document.getElementById('trendSelectedCount');
    if (sel) sel.textContent = '0';
    return;
  }

  let list = [...state.trends];

  // Apply sorting if active
  if (state.trendSort && state.trendSort.field) {
    const field = state.trendSort.field;
    const asc = state.trendSort.asc ? 1 : -1;
    list.sort((a, b) => {
      let valA = a[field];
      let valB = b[field];
      if (typeof valA === 'string' && valA.includes(',')) {
        valA = parseFloat(valA.replace(',', '.'));
      }
      if (typeof valB === 'string' && valB.includes(',')) {
        valB = parseFloat(valB.replace(',', '.'));
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * asc;
      }
      return String(valA || '').localeCompare(String(valB || '')) * asc;
    });
  }

  const filtered = getFilteredData('trends', list);
  const tot = document.getElementById('trendTotalCount');
  if (tot) tot.textContent = filtered.length;
  const sel = document.getElementById('trendSelectedCount');
  if (sel) sel.textContent = state.selected.trends.size;
  updateFilterBadge('trends');

  tbody.innerHTML = filtered
    .map((t) => {
      const isSelected = state.selected.trends.has(t.term);
      const rowClass = isSelected
        ? 'bg-red-100/70 border-b border-red-200 cursor-pointer transition-colors'
        : 'hover:bg-slate-50 border-b border-slate-100 cursor-pointer transition-colors';

      return `
      <tr class="${rowClass}" onclick="toggleTrendRowSelect('${escapeQuotes(t.term)}', event)" ondblclick="openTopPinsModal('${escapeQuotes(t.term)}', '${escapeQuotes(t.country || 'US')}')" oncontextmenu="handleTrendContextMenu(event, '${escapeQuotes(t.term)}'); return false;">
        <td class="py-2 px-3 text-center col-trend-chart">
          ${renderSparklineSvg(t.counts)}
        </td>
        <td class="py-2 px-3 font-medium text-slate-800 col-trend-keyword">
          <div class="flex items-center justify-between gap-1 group/kw">
            <span class="hover:text-red-600 hover:underline transition-colors cursor-pointer flex items-center gap-1.5" onclick="event.stopPropagation(); openTopPinsModal('${escapeQuotes(t.term)}', '${escapeQuotes(t.country || 'US')}');" title="Click to view 9 Top Popular Pins">
              <i class="ph-fill ph-push-pin text-red-500 text-xs"></i>
              ${escapeHtml(t.term)}
            </span>
            <button type="button" onclick="event.stopPropagation(); openTopPinsModal('${escapeQuotes(t.term)}', '${escapeQuotes(t.country || 'US')}');" class="opacity-0 group-hover/kw:opacity-100 hover:scale-105 px-1.5 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-700 text-[10px] font-bold transition-all flex items-center gap-1 shadow-xs" title="View 9 Top Popular Pins">
              Top Pins
            </button>
          </div>
        </td>
        <td class="py-2 px-3 text-slate-600 col-trend-seed">${escapeHtml(t.seed || '')}</td>
        <td class="py-2 px-3 text-center text-slate-600 font-mono col-trend-country">${escapeHtml(t.country || '')}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-700 col-trend-words">${t.wordCount || 0}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-700 col-trend-chars">${t.charCount || 0}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-800 font-semibold col-trend-avg1m">${t.avg1m || 0}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-800 font-semibold col-trend-avg3m">${t.avg3m || 0}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-800 font-semibold col-trend-avg6m">${t.avg6m || 0}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-800 font-semibold col-trend-avgtot">${t.avgTot || 0}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-700 col-trend-slope">${escapeHtml(t.trendSlope || '0,00')}</td>
        <td class="py-2 px-3 text-center font-mono text-slate-700 col-trend-spike">${escapeHtml(t.trendingSpike || '0,00')}</td>
      </tr>
      `;
    })
    .join('');

  applyColumnVisibility('trends');
}

function toggleTrendRowSelect(term, event) {
  if (state.selected.trends.has(term)) {
    state.selected.trends.delete(term);
  } else {
    state.selected.trends.add(term);
  }
  const sel = document.getElementById('trendSelectedCount');
  if (sel) sel.textContent = state.selected.trends.size;
  updateSelectionBar();
  renderTrends();
}

// ----------------------------------------------------------------------
// TRENDS CONTEXT MENU SYSTEM (Exact 1:1 Delphi PopupMenu Clone)
// ----------------------------------------------------------------------
let contextTrendTerm = '';

function handleTrendContextMenu(event, term) {
  event.preventDefault();
  event.stopPropagation();
  contextTrendTerm = term;

  // Highlight this row if not selected
  if (!state.selected.trends.has(term) && state.selected.trends.size === 0) {
    state.selected.trends.add(term);
    renderTrends();
  }

  const menu = document.getElementById('trendContextMenu');
  if (!menu) return;

  menu.classList.remove('hidden');

  const menuW = 270;
  const menuH = 460;
  let posX = event.clientX;
  let posY = event.clientY;

  if (posX + menuW > window.innerWidth) {
    posX = Math.max(10, window.innerWidth - menuW - 15);
  }
  if (posY + menuH > window.innerHeight) {
    posY = Math.max(10, window.innerHeight - menuH - 15);
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;
}

function closeTrendContextMenu() {
  const menu = document.getElementById('trendContextMenu');
  if (menu) menu.classList.add('hidden');
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('#trendContextMenu')) {
    closeTrendContextMenu();
  }
});

// ----------------------------------------------------------------------
// POPULAR PINS (9 TOP PINS) FOR TREND KEYWORD
// ----------------------------------------------------------------------
let currentTopPinsData = [];
let currentTopPinsTerm = '';
let currentTopPinsCountry = 'US';

function trendShowTopPins() {
  const term = contextTrendTerm || (state.selected.trends.size > 0 ? Array.from(state.selected.trends)[0] : '');
  if (!term) return;
  closeTrendContextMenu();
  const trendObj = state.trends.find((t) => t.term.toLowerCase() === term.toLowerCase());
  const country = trendObj?.country || 'US';
  openTopPinsModal(term, country);
}

async function openTopPinsModal(term, country = 'US') {
  if (!term) return;
  currentTopPinsTerm = term;
  currentTopPinsCountry = country;

  const modal = document.getElementById('topPinsModal');
  const title = document.getElementById('topPinsModalTitle');
  const subtitle = document.getElementById('topPinsModalSubtitle');
  const countryEl = document.getElementById('topPinsModalCountry');
  const loading = document.getElementById('topPinsLoading');
  const content = document.getElementById('topPinsContent');

  if (!modal) return;
  modal.classList.remove('hidden');

  if (title) title.textContent = `Popular Pins - "${term}"`;
  if (subtitle) subtitle.textContent = `Browse popular Pins based on "${term}" (9 Top Pins extracted with Pin ID & saves)`;
  if (countryEl) countryEl.textContent = country.toUpperCase();

  if (loading) {
    loading.innerHTML = `
      <div class="w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
      <p class="text-sm font-semibold text-slate-700">Identifying Top 9 Popular Pins & Resolving Pin IDs...</p>
      <p class="text-xs text-slate-500">Matching Pinterest Trends visual signatures with Pin repository</p>
    `;
    loading.classList.remove('hidden');
  }
  if (content) content.classList.add('hidden');

  try {
    const res = await fetch(`/api/trends/top-pins?term=${encodeURIComponent(term)}&country=${encodeURIComponent(country)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentTopPinsData = data.pins || [];

    renderTopPinsModal(currentTopPinsData, term);

    if (loading) loading.classList.add('hidden');
    if (content) content.classList.remove('hidden');
  } catch (err) {
    if (loading) {
      loading.innerHTML = `
        <div class="text-red-500 text-3xl mb-2"><i class="ph-bold ph-warning-circle"></i></div>
        <p class="text-sm font-semibold text-slate-800">Failed to load top pins</p>
        <p class="text-xs text-slate-500">${escapeHtml(err.message)}</p>
        <button type="button" onclick="openTopPinsModal('${escapeQuotes(term)}', '${escapeQuotes(country)}')" class="mt-3 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold">
          Retry
        </button>
      `;
    }
  }
}

function closeTopPinsModal() {
  const modal = document.getElementById('topPinsModal');
  if (modal) modal.classList.add('hidden');
}

let currentTopPinsView = 'collage';

function switchTopPinsView(mode) {
  currentTopPinsView = mode;
  const collageEl = document.getElementById('topPinsCollageView');
  const gridEl = document.getElementById('topPinsVisualGrid');
  const btnCollage = document.getElementById('topPinsViewBtnCollage');
  const btnGrid = document.getElementById('topPinsViewBtnGrid');

  if (mode === 'collage') {
    if (collageEl) collageEl.classList.remove('hidden');
    if (gridEl) gridEl.classList.add('hidden');
    if (btnCollage) {
      btnCollage.className = 'px-2.5 py-1 rounded-md font-semibold text-xs transition-all bg-white text-slate-800 shadow-xs flex items-center gap-1';
    }
    if (btnGrid) {
      btnGrid.className = 'px-2.5 py-1 rounded-md font-semibold text-xs transition-all text-slate-600 hover:text-slate-900 flex items-center gap-1';
    }
  } else {
    if (collageEl) collageEl.classList.add('hidden');
    if (gridEl) gridEl.classList.remove('hidden');
    if (btnCollage) {
      btnCollage.className = 'px-2.5 py-1 rounded-md font-semibold text-xs transition-all text-slate-600 hover:text-slate-900 flex items-center gap-1';
    }
    if (btnGrid) {
      btnGrid.className = 'px-2.5 py-1 rounded-md font-semibold text-xs transition-all bg-white text-slate-800 shadow-xs flex items-center gap-1';
    }
  }
}

function renderCollagePinCard(p, rankNum, heightPct, isTop = false) {
  if (!p) return '<div class="w-full bg-slate-200 rounded-xl" style="height: ' + heightPct + '%;"></div>';
  const pinId = p['Pin ID'] || p.id || '';
  const pinUrl = p.pinUrl || p['main link'] || `https://www.pinterest.com/pin/${pinId}/`;
  const savesFormatted = p.saves ? Number(p.saves).toLocaleString() : '0';
  const img = p.image || p.thumbnail;
  const colBadge = p.trendColumn ? `Col ${p.trendColumn}` : '';
  const posBadge = p.trendPosition && p.trendPosition !== 'full' ? ` • ${p.trendPosition.toUpperCase()}` : '';

  return `
    <div class="relative w-full rounded-xl overflow-hidden group/collage cursor-pointer bg-slate-200 shadow-xs border border-slate-200 hover:shadow-lg transition-all ${isTop ? 'mb-2' : ''}" style="height: ${heightPct}%;" onclick="window.open('${escapeQuotes(pinUrl)}', '_blank')">
      <img src="${escapeHtml(img)}" alt="${escapeHtml(p.title || 'Popular Pin')}" class="w-full h-full object-cover group-hover/collage:scale-105 transition-transform duration-300" loading="lazy" onerror="this.src='https://placehold.co/236x300/f1f5f9/94a3b8?text=Pin'">
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 opacity-70 group-hover/collage:opacity-90 transition-opacity"></div>
      
      <!-- Top badges: Rank & Column -->
      <div class="absolute top-2 left-2 flex items-center gap-1.5 z-10">
        <span class="px-2 py-0.5 rounded-md bg-red-600 text-white text-[11px] font-extrabold shadow-sm">
          #${rankNum}
        </span>
        <span class="px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-white text-[10px] font-semibold">
          ${colBadge}${posBadge}
        </span>
      </div>

      <!-- Bottom overlay info -->
      <div class="absolute bottom-2 inset-x-2 text-white z-10">
        <div class="font-bold text-[11px] leading-tight line-clamp-1 drop-shadow-sm" title="${escapeHtml(p.title)}">
          ${escapeHtml(p.title || 'Untitled Pin')}
        </div>
        <div class="flex items-center justify-between mt-1 text-[10px] text-slate-200">
          <span class="font-mono truncate">ID: ${escapeHtml(pinId)}</span>
          <span class="font-semibold flex items-center gap-0.5 text-red-300"><i class="ph-fill ph-heart text-red-400"></i> ${savesFormatted}</span>
        </div>
      </div>
    </div>
  `;
}

function renderTopPinsModal(pins, term) {
  // 1. Render Authentic 5-Column Pinterest Trends Collage View
  const collageView = document.getElementById('topPinsCollageView');
  if (collageView) {
    if (pins.length >= 9) {
      collageView.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 h-[460px]">
          <!-- Column 1: Rank #1 (Full Height) -->
          <div class="h-full flex flex-col">
            ${renderCollagePinCard(pins[0], pins[0].trendRank || 1, 100, false)}
          </div>
          <!-- Column 2: Rank #2 (Top 58%) & Rank #3 (Bottom 40%) -->
          <div class="h-full flex flex-col justify-between">
            ${renderCollagePinCard(pins[1], pins[1].trendRank || 2, 58, true)}
            ${renderCollagePinCard(pins[2], pins[2].trendRank || 3, 40, false)}
          </div>
          <!-- Column 3: Rank #4 (Top 40%) & Rank #5 (Bottom 58%) -->
          <div class="h-full flex flex-col justify-between">
            ${renderCollagePinCard(pins[3], pins[3].trendRank || 4, 40, true)}
            ${renderCollagePinCard(pins[4], pins[4].trendRank || 5, 58, false)}
          </div>
          <!-- Column 4: Rank #6 (Top 58%) & Rank #7 (Bottom 40%) -->
          <div class="h-full flex flex-col justify-between">
            ${renderCollagePinCard(pins[5], pins[5].trendRank || 6, 58, true)}
            ${renderCollagePinCard(pins[6], pins[6].trendRank || 7, 40, false)}
          </div>
          <!-- Column 5: Rank #8 (Top 40%) & Rank #9 (Bottom 58%) -->
          <div class="h-full flex flex-col justify-between">
            ${renderCollagePinCard(pins[7], pins[7].trendRank || 8, 40, true)}
            ${renderCollagePinCard(pins[8], pins[8].trendRank || 9, 58, false)}
          </div>
        </div>
      `;
    } else {
      collageView.innerHTML = `
        <div class="py-8 text-center text-slate-500 text-xs">
          ${pins.length} pins loaded. Switch to 9-Card Grid view for single-card display.
        </div>
      `;
    }
  }

  // 2. Render Visual Photo Grid (9-card layout)
  const visualGrid = document.getElementById('topPinsVisualGrid');
  if (visualGrid) {
    visualGrid.innerHTML = pins
      .map((p, idx) => {
        const pinId = p['Pin ID'] || p.id || '';
        const pinUrl = p.pinUrl || p['main link'] || `https://www.pinterest.com/pin/${pinId}/`;
        const savesFormatted = p.saves ? Number(p.saves).toLocaleString() : '0';
        const rank = p.trendRank || (idx + 1);
        const colBadge = p.trendColumn ? `Col ${p.trendColumn}` : '';

        return `
        <div class="group/card relative bg-slate-100 rounded-xl overflow-hidden border border-slate-200 shadow-xs hover:shadow-md transition-all flex flex-col">
          <div class="relative aspect-[3/4] overflow-hidden bg-slate-200 cursor-pointer" onclick="window.open('${escapeQuotes(pinUrl)}', '_blank')">
            <img src="${escapeHtml(p.image || p.thumbnail)}" alt="${escapeHtml(p.title)}" class="w-full h-full object-cover group-hover/card:scale-105 transition-transform duration-300" loading="lazy" onerror="this.src='https://placehold.co/236x300/f1f5f9/94a3b8?text=Pin'">
            <div class="absolute top-1.5 left-1.5 flex items-center gap-1">
              <span class="px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold">
                #${rank}
              </span>
              ${colBadge ? `<span class="px-1 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-white text-[9px] font-medium">${colBadge}</span>` : ''}
            </div>
            <div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-xs text-white text-[10px] font-semibold flex items-center gap-1">
              <i class="ph-fill ph-heart text-red-500"></i> ${savesFormatted}
            </div>
          </div>
          <div class="p-2 flex-1 flex flex-col justify-between text-[11px] bg-white">
            <div class="font-bold text-slate-800 line-clamp-1" title="${escapeHtml(p.title)}">${escapeHtml(p.title || 'Untitled Pin')}</div>
            <div class="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between gap-1">
              <span class="font-mono text-[10px] text-red-700 font-semibold truncate" title="Pin ID: ${escapeHtml(pinId)}">
                ID: ${escapeHtml(pinId)}
              </span>
              <button type="button" onclick="navigator.clipboard.writeText('${escapeQuotes(pinId)}'); alert('Copied Pin ID: ${escapeQuotes(pinId)}');" class="text-slate-400 hover:text-slate-700 p-0.5" title="Copy Pin ID">
                <i class="ph-bold ph-copy text-xs"></i>
              </button>
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  }

  // 3. Render Data Table
  const tbody = document.getElementById('topPinsTableBody');
  if (tbody) {
    tbody.innerHTML = pins
      .map((p, idx) => {
        const pinId = p['Pin ID'] || p.id || '';
        const pinUrl = p.pinUrl || p['main link'] || `https://www.pinterest.com/pin/${pinId}/`;
        const saves = Number(p.saves) || 0;
        const rxCount = Number(p.reactionCount || p.totalReactions) || 0;
        const comments = Number(p.comments) || 0;
        const rank = p.trendRank || (idx + 1);
        const colPos = p.trendColumn ? `Col ${p.trendColumn}${p.trendPosition && p.trendPosition !== 'full' ? ` (${p.trendPosition})` : ''}` : '';

        return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-2 px-3 text-center">
            <div class="font-extrabold text-slate-900 text-sm">#${rank}</div>
            ${colPos ? `<div class="text-[9px] text-slate-400 whitespace-nowrap mt-0.5">${escapeHtml(colPos)}</div>` : ''}
          </td>
          <td class="py-2 px-3 text-center">
            <img src="${escapeHtml(p.thumbnail || p.image)}" class="w-9 h-12 object-cover rounded shadow-xs mx-auto border border-slate-200 cursor-pointer" onclick="window.open('${escapeQuotes(pinUrl)}', '_blank')" loading="lazy">
          </td>
          <td class="py-2 px-3 font-mono text-red-700 font-semibold">
            <div class="flex items-center gap-1.5">
              <a href="${escapeHtml(pinUrl)}" target="_blank" class="hover:underline flex items-center gap-1 text-slate-900 font-bold">
                ${escapeHtml(pinId)}
                <i class="ph-bold ph-arrow-square-out text-slate-400 text-xs"></i>
              </a>
              <button type="button" onclick="navigator.clipboard.writeText('${escapeQuotes(pinId)}'); alert('Copied Pin ID: ${escapeQuotes(pinId)}');" class="text-slate-400 hover:text-slate-700" title="Copy Pin ID">
                <i class="ph-bold ph-copy text-xs"></i>
              </button>
            </div>
          </td>
          <td class="py-2 px-3 font-medium text-slate-800 max-w-xs">
            <div class="line-clamp-2" title="${escapeHtml(p.title)}">${escapeHtml(p.title || 'Untitled Pin')}</div>
            <div class="text-[10px] text-slate-400 truncate mt-0.5">${escapeHtml(p.domain || 'pinterest.com')}</div>
          </td>
          <td class="py-2 px-3 text-center font-bold font-mono text-slate-900">${saves.toLocaleString()}</td>
          <td class="py-2 px-3 text-center font-mono text-slate-700">${rxCount.toLocaleString()}</td>
          <td class="py-2 px-3 text-center font-mono text-slate-700">${comments.toLocaleString()}</td>
          <td class="py-2 px-3 text-slate-700 text-[11px]">
            <div class="font-medium text-slate-900 truncate" title="${escapeHtml(p.pinnerName || '')}">${escapeHtml(p.pinnerName || 'Anonymous')}</div>
            <div class="text-[10px] text-slate-500 truncate" title="${escapeHtml(p.boardName || '')}">${escapeHtml(p.boardName || 'Board')}</div>
          </td>
          <td class="py-2 px-3 text-center">
            <button type="button" onclick="sendSingleTopPinToAnalyzer(${idx})" class="p-1 rounded hover:bg-red-50 text-red-600 font-semibold" title="Send to Pins Analyzer">
              <i class="ph-bold ph-push-pin text-sm"></i>
            </button>
          </td>
        </tr>
      `;
      })
      .join('');
  }
}

function sendTopPinsToAnalyzer() {
  if (!currentTopPinsData || currentTopPinsData.length === 0) {
    alert('No top pins loaded to send.');
    return;
  }
  // Add pins directly to Pins Analyzer state
  currentTopPinsData.forEach((p) => {
    if (!state.pins.some((existing) => (existing['Pin ID'] || existing.id) === (p['Pin ID'] || p.id))) {
      state.pins.unshift(p);
    }
  });

  closeTopPinsModal();
  switchTab('pins');
  renderPins();
  alert(`Added ${currentTopPinsData.length} Popular Pins to Pins Analyzer!`);
}

function sendSingleTopPinToAnalyzer(idx) {
  const pin = currentTopPinsData[idx];
  if (!pin) return;
  if (!state.pins.some((existing) => (existing['Pin ID'] || existing.id) === (pin['Pin ID'] || pin.id))) {
    state.pins.unshift(pin);
  }
  closeTopPinsModal();
  switchTab('pins');
  renderPins();
}

function copyTopPinsIds() {
  if (!currentTopPinsData || currentTopPinsData.length === 0) return;
  const ids = currentTopPinsData.map((p) => p['Pin ID'] || p.id).filter(Boolean);
  navigator.clipboard.writeText(ids.join('\n'));
  alert(`Copied ${ids.length} Pin IDs to clipboard:\n${ids.join(', ')}`);
}

function exportTopPinsCSV() {
  if (!currentTopPinsData || currentTopPinsData.length === 0) return;
  const headers = ['Rank', 'Column', 'Position', 'Pin ID', 'Title', 'Saves', 'Reactions', 'Comments', 'Pinner', 'Board', 'Domain', 'Pin URL', 'Image URL'];
  const rows = currentTopPinsData.map((p, i) => [
    p.trendRank || (i + 1),
    p.trendColumn || '',
    p.trendPosition || '',
    `"${(p['Pin ID'] || p.id || '').replace(/"/g, '""')}"`,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    p.saves || 0,
    p.reactionCount || p.totalReactions || 0,
    p.comments || 0,
    `"${(p.pinnerName || '').replace(/"/g, '""')}"`,
    `"${(p.boardName || '').replace(/"/g, '""')}"`,
    `"${(p.domain || '').replace(/"/g, '""')}"`,
    `"${(p.pinUrl || p['main link'] || '').replace(/"/g, '""')}"`,
    `"${(p.image || p.thumbnail || '').replace(/"/g, '""')}"`,
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `popular_pins_${currentTopPinsTerm.replace(/[^a-z0-9_-]/gi, '_')}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function trendSendToPins() {
  const term = contextTrendTerm || (state.selected.trends.size > 0 ? Array.from(state.selected.trends)[0] : '');
  if (!term) return;
  closeTrendContextMenu();
  sendToPins(term);
}

function trendSendToBoards() {
  const term = contextTrendTerm || (state.selected.trends.size > 0 ? Array.from(state.selected.trends)[0] : '');
  if (!term) return;
  closeTrendContextMenu();
  sendToBoards(term);
}

function trendSendToPeople() {
  const term = contextTrendTerm || (state.selected.trends.size > 0 ? Array.from(state.selected.trends)[0] : '');
  if (!term) return;
  closeTrendContextMenu();
  const input = document.getElementById('usersInput');
  if (input) input.value = term;
  switchTab('users');
  document.getElementById('usersForm')?.dispatchEvent(new Event('submit'));
}

function trendGetSearchVolume() {
  closeTrendContextMenu();
  getTrendsSearchVolume();
}

function trendSendSelectedToKE() {
  closeTrendContextMenu();
  sendTrendsToKeywordsEverywhere();
}

function trendSendAllToKE() {
  closeTrendContextMenu();
  if (!state.trends || state.trends.length === 0) {
    return alert('No keywords available to send.');
  }
  fetchKeywordsEverywhere('trends', state.trends.map((t) => t.term));
}

function trendSendSelectedToAnnotations() {
  closeTrendContextMenu();
  const sel = state.selected.trends;
  const terms = sel.size > 0 ? Array.from(sel) : (contextTrendTerm ? [contextTrendTerm] : []);
  if (terms.length === 0) {
    alert('No keywords selected.');
    return;
  }
  switchTab('annotations');
  switchAnnSubTab('keywords');
  const input = document.getElementById('annKeywordsInput');
  if (input) input.value = terms.join('\n');
  extractAnnotationsFromKeywords();
}

function trendSendAllToAnnotations() {
  closeTrendContextMenu();
  const terms = state.trends.map((t) => t.term);
  if (terms.length === 0) {
    alert('No keywords in trends table.');
    return;
  }
  switchTab('annotations');
  switchAnnSubTab('keywords');
  const input = document.getElementById('annKeywordsInput');
  if (input) input.value = terms.join('\n');
  extractAnnotationsFromKeywords();
}

// Checkboxes Submenu
function trendSelectHighlighted() {
  closeTrendContextMenu();
  if (contextTrendTerm) {
    state.selected.trends.add(contextTrendTerm);
    renderTrends();
  }
}

function trendUnselectHighlighted() {
  closeTrendContextMenu();
  if (contextTrendTerm) {
    state.selected.trends.delete(contextTrendTerm);
    renderTrends();
  }
}

function trendSelectAll() {
  closeTrendContextMenu();
  state.trends.forEach((t) => state.selected.trends.add(t.term));
  renderTrends();
}

function trendUnselectAll() {
  closeTrendContextMenu();
  state.selected.trends.clear();
  renderTrends();
}

// Filters Submenu
function trendClearFilters() {
  closeTrendContextMenu();
  state.filters.trends = [];
  renderTrends();
}

// Copy Submenu
function trendCopySelectedRows() {
  closeTrendContextMenu();
  const sel = state.selected.trends;
  const items = state.trends.filter((t) => sel.has(t.term));
  if (items.length === 0) {
    alert('No selected rows to copy.');
    return;
  }
  const text = items.map((t) => [t.term, t.seed, t.country, t.wordCount, t.charCount, t.avg1m, t.avg3m, t.avg6m, t.avgTot, t.trendSlope, t.trendingSpike].join('\t')).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${items.length} selected row(s) copied to clipboard!`);
}

function trendCopyAllRows() {
  closeTrendContextMenu();
  if (state.trends.length === 0) {
    alert('No rows to copy.');
    return;
  }
  const text = state.trends.map((t) => [t.term, t.seed, t.country, t.wordCount, t.charCount, t.avg1m, t.avg3m, t.avg6m, t.avgTot, t.trendSlope, t.trendingSpike].join('\t')).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${state.trends.length} row(s) copied to clipboard!`);
}

function trendCopyHighlightedRow() {
  closeTrendContextMenu();
  const item = state.trends.find((t) => t.term === contextTrendTerm);
  if (!item) return;
  const text = [item.term, item.seed, item.country, item.wordCount, item.charCount, item.avg1m, item.avg3m, item.avg6m, item.avgTot, item.trendSlope, item.trendingSpike].join('\t');
  navigator.clipboard.writeText(text);
  alert(`Highlighted row "${item.term}" copied to clipboard!`);
}

// Search Submenu
function trendSearchWeb(engine) {
  closeTrendContextMenu();
  const kw = contextTrendTerm || (state.selected.trends.size > 0 ? Array.from(state.selected.trends)[0] : '');
  if (!kw) return;
  const enc = encodeURIComponent(kw);
  const urls = {
    'google-trends': `https://trends.google.com/trends/explore?q=${enc}`,
    'google': `https://www.google.com/search?q=${enc}`,
    'bing': `https://www.bing.com/search?q=${enc}`,
    'shopping': `https://www.google.com/search?tbm=shop&q=${enc}`,
    'amazon': `https://www.amazon.com/s?k=${enc}`,
    'ebay': `https://www.ebay.com/sch/i.html?_nkw=${enc}`,
    'etsy': `https://www.etsy.com/search?q=${enc}`,
    'aliexpress': `https://www.aliexpress.com/wholesale?SearchText=${enc}`,
    'alibaba': `https://www.alibaba.com/trade/search?SearchText=${enc}`,
    'wish': `https://www.wish.com/search/${enc}`,
  };
  const targetUrl = urls[engine];
  if (targetUrl) {
    window.open(targetUrl, '_blank');
  }
}

// Auto Fit & Reset Column Widths
function trendAutoFitWidths() {
  closeTrendContextMenu();
  const table = document.getElementById('table-trends');
  if (table) table.style.tableLayout = 'auto';
}

function trendResetWidths() {
  closeTrendContextMenu();
  const table = document.getElementById('table-trends');
  if (table) table.style.tableLayout = '';
}

// Delete Submenu
function trendRemoveDuplicates() {
  closeTrendContextMenu();
  const seen = new Set();
  const unique = [];
  for (const t of state.trends) {
    const k = t.term.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(t);
    }
  }
  const removed = state.trends.length - unique.length;
  state.trends = unique;
  renderTrends();
  alert(`Removed ${removed} duplicate item(s).`);
}

function trendDeleteSelected() {
  closeTrendContextMenu();
  const sel = state.selected.trends;
  if (sel.size === 0) {
    alert('No rows selected to delete.');
    return;
  }
  state.trends = state.trends.filter((t) => !sel.has(t.term));
  sel.clear();
  renderTrends();
}

function trendDeleteUnselected() {
  closeTrendContextMenu();
  const sel = state.selected.trends;
  if (sel.size === 0) {
    alert('No rows selected.');
    return;
  }
  state.trends = state.trends.filter((t) => sel.has(t.term));
  renderTrends();
}

function trendDeleteHighlighted() {
  closeTrendContextMenu();
  if (!contextTrendTerm) return;
  state.trends = state.trends.filter((t) => t.term !== contextTrendTerm);
  state.selected.trends.delete(contextTrendTerm);
  renderTrends();
}

function clearTrendsGrid() {
  if (confirm('Clear all trend data?')) {
    state.trends = [];
    state.selected.trends.clear();
    const statusCenter = document.getElementById('trendStatusCenter');
    if (statusCenter) statusCenter.textContent = '';
    renderTrends();
  }
}

function toggleTrendFileMenu() {
  const dd = document.getElementById('trendFileDropdown');
  if (dd) dd.classList.toggle('hidden');
}

function closeTrendFileMenu() {
  const dd = document.getElementById('trendFileDropdown');
  if (dd) dd.classList.add('hidden');
}

function exportTrendsTXT() {
  if (!state.trends || state.trends.length === 0) {
    alert('No trend data to export.');
    return;
  }
  const content = state.trends.map(t => t.term).join('\n');
  downloadFile(`trends_keywords_${Date.now()}.txt`, content, 'text/plain;charset=utf-8;');
}

function copyAllTrendKeywords() {
  if (!state.trends || state.trends.length === 0) {
    alert('No trend data to copy.');
    return;
  }
  const text = state.trends.map(t => t.term).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${state.trends.length} trend keywords copied to clipboard!`);
}

function copySelectedTrendKeywords() {
  const sel = state.selected.trends;
  if (!sel || sel.size === 0) {
    alert('There are no selected rows. Click rows to select them.');
    return;
  }
  const text = Array.from(sel).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${sel.size} selected trend keywords copied to clipboard!`);
}

function getTrendsSearchVolume() {
  sendTrendsToKeywordsEverywhere();
}

function sendTrendsToKeywordsEverywhere() {
  const sel = state.selected.trends;
  const terms = sel.size > 0 ? Array.from(sel) : state.trends.map(t => t.term);
  if (terms.length === 0) {
    alert('No keywords available to send.');
    return;
  }
  fetchKeywordsEverywhere('trends', terms);
}

// ----------------------------------------------------------------------
// 7. TREND CHART MODAL (TChartForm - Searches Over Time)
// ----------------------------------------------------------------------
async function openTrendChartModal(term) {
  currentChartTerm = term;
  document.getElementById('chartTermTitle').textContent = `Searches Over Time: "${term}"`;
  document.getElementById('trendChartModal').classList.remove('hidden');

  const country = document.getElementById('trendCountrySelect')?.value || 'US';
  try {
    const res = await fetch(`/api/trend-history?term=${encodeURIComponent(term)}&country=${country}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('chartCurrentScore').textContent = data.currentScore || 100;
    const wowVal = data.weeklyGrowth !== undefined ? (data.weeklyGrowth * 100).toFixed(0) : '0';
    document.getElementById('chartWeeklyGrowth').textContent = (wowVal > 0 ? '+' : '') + wowVal + '%';
    const yoyVal = data.yoyGrowth !== undefined ? (data.yoyGrowth * 100).toFixed(0) : '0';
    document.getElementById('chartYoYGrowth').textContent = (yoyVal > 0 ? '+' : '') + yoyVal + '%';
    document.getElementById('chartSeasonality').textContent = (data.seasonalityScore > 0.6 ? 'High' : data.seasonalityScore > 0.3 ? 'Moderate' : 'Steady');

    renderChartJS(data.timeline || []);
  } catch (err) {
    console.error('Trend chart fetch error:', err);
  }
}

function renderChartJS(timeline) {
  const ctx = document.getElementById('trendChartCanvas').getContext('2d');
  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  const labels = timeline.map((t) => t.label);
  const dataPoints = timeline.map((t) => t.index);

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(230, 0, 35, 0.35)');
  gradient.addColorStop(1, 'rgba(230, 0, 35, 0.0)');

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Pinterest Search Volume Index',
          data: dataPoints,
          borderColor: '#E60023',
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#E60023',
          pointBorderColor: '#fff',
          pointRadius: 4,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { size: 12 },
          bodyFont: { size: 13, weight: 'bold' },
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (context) => `Volume Index: ${context.parsed.y} / 100`,
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11, family: 'monospace' } },
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
}

function closeTrendChartModal() {
  document.getElementById('trendChartModal').classList.add('hidden');
}

function sendChartTermToPins() {
  if (currentChartTerm) {
    closeTrendChartModal();
    sendToPins(currentChartTerm);
  }
}

// ----------------------------------------------------------------------
// 8. COLUMN CUSTOMIZATION (TColumnsForm)
// ----------------------------------------------------------------------
const tableColumnDefinitions = {
  keywords: [
    { id: 'col-kw-rank', name: 'Rank' },
    { id: 'col-kw-words', name: 'Word Count' },
    { id: 'col-kw-chars', name: 'Character Count' },
    { id: 'col-kw-seed', name: 'Seed' },
    { id: 'col-kw-keyword', name: 'Keyword' },
    { id: 'col-kw-vol', name: 'Search Volume' },
    { id: 'col-kw-cpc', name: 'Cost Per Click' },
    { id: 'col-kw-comp', name: 'Competition' },
  ],
  pins: [
    { id: 'col-pin-0', name: 'Rank (#)' },
    { id: 'col-pin-1', name: 'Image' },
    { id: 'col-pin-2', name: 'Pin ID' },
    { id: 'col-pin-3', name: 'Title' },
    { id: 'col-pin-4', name: 'Saves' },
    { id: 'col-pin-5', name: 'Shares' },
    { id: 'col-pin-6', name: 'Repins' },
    { id: 'col-pin-7', name: 'Comments' },
    { id: 'col-pin-8', name: 'Removes' },
    { id: 'col-pin-9', name: 'Good Idea' },
    { id: 'col-pin-10', name: 'Love' },
    { id: 'col-pin-11', name: 'Thanks' },
    { id: 'col-pin-12', name: 'Wow' },
    { id: 'col-pin-13', name: 'Laughing' },
    { id: 'col-pin-14', name: 'Total Reactions' },
    { id: 'col-pin-15', name: 'Description' },
    { id: 'col-pin-16', name: 'Category' },
    { id: 'col-pin-17', name: 'Hashtags' },
    { id: 'col-pin-18', name: 'Created' },
    { id: 'col-pin-19', name: 'Method' },
    { id: 'col-pin-20', name: 'Domain' },
    { id: 'col-pin-21', name: 'Site Name' },
    { id: 'col-pin-22', name: 'Link' },
    { id: 'col-pin-23', name: 'Dominant Color' },
    { id: 'col-pin-24', name: 'Image Signature' },
    { id: 'col-pin-25', name: 'Is Repin' },
    { id: 'col-pin-26', name: 'Is Promoted' },
    { id: 'col-pin-27', name: 'Is Video' },
    { id: 'col-pin-28', name: 'Is Story' },
    { id: 'col-pin-29', name: 'Is Group Board' },
    { id: 'col-pin-30', name: 'Is AI Modified' },
    { id: 'col-pin-31', name: 'Video link' },
    { id: 'col-pin-32', name: 'Video Length' },
    { id: 'col-pin-33', name: 'Video Thumbnail' },
    { id: 'col-pin-34', name: 'Pinner Image' },
    { id: 'col-pin-35', name: 'Pinner Username' },
    { id: 'col-pin-36', name: 'Pinner Name' },
    { id: 'col-pin-37', name: 'Pinner Location' },
    { id: 'col-pin-38', name: 'Pinner Followers' },
    { id: 'col-pin-39', name: 'Board Name' },
    { id: 'col-pin-40', name: 'Board Link' },
    { id: 'col-pin-41', name: 'Board Category' },
    { id: 'col-pin-42', name: 'Board Image' },
    { id: 'col-pin-43', name: 'Creator Image' },
    { id: 'col-pin-44', name: 'Creator Username' },
    { id: 'col-pin-45', name: 'Creator Name' },
    { id: 'col-pin-46', name: 'Creator Location' },
    { id: 'col-pin-47', name: 'Creator Link' },
    { id: 'col-pin-48', name: 'Creator Followers' },
    { id: 'col-pin-49', name: 'Promoter Image' },
    { id: 'col-pin-50', name: 'Promoter Username' },
    { id: 'col-pin-51', name: 'Promoter Name' },
    { id: 'col-pin-52', name: 'Promoter Location' },
    { id: 'col-pin-53', name: 'Promoter Link' },
    { id: 'col-pin-54', name: 'Promoter Followers' },
    { id: 'col-pin-55', name: 'Annotations' },
    { id: 'col-pin-56', name: 'main link' },
  ],
  boards: [
    { id: 'col-boards-cover', name: 'Image' },
    { id: 'col-boards-id', name: 'Board ID' },
    { id: 'col-boards-name', name: 'Board Name' },
    { id: 'col-boards-followers', name: 'Board Followers' },
    { id: 'col-boards-pins', name: 'Pin Count' },
    { id: 'col-boards-link', name: 'Board Link' },
    { id: 'col-boards-desc', name: 'Description' },
    { id: 'col-boards-join', name: 'Can Join Board' },
    { id: 'col-boards-isgroup', name: 'Is Group Board' },
    { id: 'col-boards-topic', name: 'Topic' },
    { id: 'col-boards-modified', name: 'Last Modified' },
    { id: 'col-boards-ownername', name: 'Owner Name' },
    { id: 'col-boards-ownerfollowers', name: 'Owner Followers' },
    { id: 'col-boards-owner', name: 'Owner Username' },
    { id: 'col-boards-ownercountry', name: 'Owner Country' },
    { id: 'col-boards-ownerurl', name: 'Owner Url' },
    { id: 'col-boards-interests', name: 'Related Interests' },
    { id: 'col-boards-actions', name: 'Actions' },
  ],
  users: [
    { id: 'col-users-rank', name: 'Rank (#)' },
    { id: 'col-users-avatar', name: 'User Avatar' },
    { id: 'col-users-id', name: 'User ID' },
    { id: 'col-users-name', name: 'Full Name' },
    { id: 'col-users-user', name: 'Username' },
    { id: 'col-users-followers', name: 'Followers' },
    { id: 'col-users-following', name: 'Following' },
    { id: 'col-users-boards', name: 'Board Count' },
    { id: 'col-users-pins', name: 'Pin Count' },
    { id: 'col-users-videopins', name: 'Video Pin Count' },
    { id: 'col-users-storepins', name: 'Store Pin Count' },
    { id: 'col-users-interests', name: 'Interest Count' },
    { id: 'col-users-profileviews', name: 'Profile Views' },
    { id: 'col-users-profilereach', name: 'Profile Reach' },
    { id: 'col-users-groupboards', name: 'Group Board Count' },
    { id: 'col-users-lastpin', name: 'Last Pin' },
    { id: 'col-users-location', name: 'Location' },
    { id: 'col-users-website', name: 'Website' },
    { id: 'col-users-domainverified', name: 'Domain Verified' },
    { id: 'col-users-merchantverified', name: 'Merchant Verified' },
    { id: 'col-users-about', name: 'About' },
    { id: 'col-users-actions', name: 'Actions' },
  ],
  annotations: [
    { id: 'col-ann-tag', name: 'Annotation' },
    { id: 'col-ann-words', name: 'Word Count' },
    { id: 'col-ann-chars', name: 'Character Count' },
    { id: 'col-ann-vol', name: 'Search Volume' },
    { id: 'col-ann-followers', name: 'Follower Count' },
    { id: 'col-ann-updated', name: 'Last Updated' },
    { id: 'col-ann-id', name: 'Annotation Id' },
    { id: 'col-ann-tree', name: 'Category Tree' },
    { id: 'col-ann-link', name: 'Link' },
  ],
  trends: [
    { id: 'col-trend-chart', name: 'Chart' },
    { id: 'col-trend-keyword', name: 'Keyword' },
    { id: 'col-trend-seed', name: 'Seed' },
    { id: 'col-trend-country', name: 'Country' },
    { id: 'col-trend-words', name: 'Word Count' },
    { id: 'col-trend-chars', name: 'Character Count' },
    { id: 'col-trend-avg1m', name: '1 Month Average' },
    { id: 'col-trend-avg3m', name: '3 Month Average' },
    { id: 'col-trend-avg6m', name: '6 Month Average' },
    { id: 'col-trend-avgtot', name: 'Total Average' },
    { id: 'col-trend-slope', name: 'Trend Slope' },
    { id: 'col-trend-spike', name: 'Trending Spike' },
  ],
};

function openColumnsModal(tableId) {
  activeColumnsTable = tableId;
  const cols = tableColumnDefinitions[tableId] || [];
  const saved = state.visibleColumns[tableId] || {};

  const container = document.getElementById('columnsChecklist');
  container.innerHTML = cols
    .map((col) => {
      const isVisible = saved[col.id] !== false;
      return `
      <label class="flex items-center space-x-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer text-xs">
        <input type="checkbox" data-col="${col.id}" ${isVisible ? 'checked' : ''} onchange="toggleColumnVisibility('${tableId}', '${col.id}', this.checked)" class="rounded text-red-600 focus:ring-red-500">
        <span class="text-slate-700 font-medium">${escapeHtml(col.name)}</span>
      </label>
    `;
    })
    .join('');

  document.getElementById('columnsModal').classList.remove('hidden');
}

function closeColumnsModal() {
  document.getElementById('columnsModal').classList.add('hidden');
}

function toggleColumnVisibility(tableId, colId, isVisible) {
  if (!state.visibleColumns[tableId]) state.visibleColumns[tableId] = {};
  state.visibleColumns[tableId][colId] = isVisible;
  localStorage.setItem('piw_visible_cols', JSON.stringify(state.visibleColumns));
  applyColumnVisibility(tableId);
}

function selectAllColumns(val) {
  const inputs = document.querySelectorAll('#columnsChecklist input[type="checkbox"]');
  inputs.forEach((input) => {
    input.checked = val;
    const colId = input.getAttribute('data-col');
    if (colId) {
      if (!state.visibleColumns[activeColumnsTable]) state.visibleColumns[activeColumnsTable] = {};
      state.visibleColumns[activeColumnsTable][colId] = val;
    }
  });
  localStorage.setItem('piw_visible_cols', JSON.stringify(state.visibleColumns));
  applyColumnVisibility(activeColumnsTable);
}

function applyColumnVisibility(tableId) {
  const saved = state.visibleColumns[tableId] || {};
  const cols = tableColumnDefinitions[tableId] || [];
  cols.forEach((col) => {
    const isVisible = saved[col.id] !== false;
    document.querySelectorAll(`.${col.id}`).forEach((el) => {
      if (isVisible) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
  });
}

function applyAllSavedColumns() {
  Object.keys(tableColumnDefinitions).forEach((tid) => applyColumnVisibility(tid));
}

// ----------------------------------------------------------------------
// 9. ADVANCED FILTERING SYSTEM (TFilterForm)
// ----------------------------------------------------------------------
const tableFilterFields = {
  keywords: [
    { key: 'rank', label: 'Rank (Number)' },
    { key: 'wordCount', label: 'Word Count (Number)' },
    { key: 'charCount', label: 'Character Count (Number)' },
    { key: 'seed', label: 'Seed (Text)' },
    { key: 'keyword', label: 'Keyword (Text)' },
    { key: 'vol', label: 'Search Volume (Number)' },
    { key: 'cpc', label: 'Cost Per Click (Number)' },
    { key: 'competition', label: 'Competition (Number)' },
  ],
  pins: [
    { key: 'title', label: 'Title / Description (Text)' },
    { key: 'saves', label: 'Saves / Repins (Number)' },
    { key: 'reactionCount', label: 'Total Reactions (Number)' },
    { key: 'videoDuration', label: 'Video Length Sec (Number)' },
    { key: 'domain', label: 'Outbound Domain (Text)' },
    { key: 'boardName', label: 'Board Name (Text)' },
    { key: 'pinnerUsername', label: 'Pinner Username (Text)' },
  ],
  boards: [
    { key: 'name', label: 'Board Name (Text)' },
    { key: 'pinCount', label: 'Pin Count (Number)' },
    { key: 'followerCount', label: 'Followers (Number)' },
    { key: 'ownerUsername', label: 'Owner Username (Text)' },
  ],
  users: [
    { key: 'fullName', label: 'Full Name (Text)' },
    { key: 'username', label: 'Username (Text)' },
    { key: 'followers', label: 'Followers (Number)' },
    { key: 'following', label: 'Following (Number)' },
    { key: 'boardCount', label: 'Board Count (Number)' },
    { key: 'pinCount', label: 'Pins (Number)' },
    { key: 'videoPinCount', label: 'Video Pin Count (Number)' },
    { key: 'storePinCount', label: 'Store Pin Count (Number)' },
    { key: 'interestCount', label: 'Interest Count (Number)' },
    { key: 'profileViews', label: 'Profile Views (Number)' },
    { key: 'profileReach', label: 'Profile Reach (Number)' },
    { key: 'groupBoardCount', label: 'Group Board Count (Number)' },
    { key: 'location', label: 'Location (Text)' },
    { key: 'website', label: 'Website (Text)' },
  ],
  annotations: [
    { key: 'annotation', label: 'Annotation (Text)' },
    { key: 'wordCount', label: 'Word Count (Number)' },
    { key: 'charCount', label: 'Character Count (Number)' },
    { key: 'searchVolume', label: 'Search Volume (Number)' },
    { key: 'followerCount', label: 'Follower Count (Number)' },
    { key: 'lastUpdated', label: 'Last Updated (Text)' },
    { key: 'annotationId', label: 'Annotation Id (Text)' },
    { key: 'categoryTree', label: 'Category Tree (Text)' },
  ],
  trends: [
    { key: 'term', label: 'Keyword (Text)' },
    { key: 'seed', label: 'Seed (Text)' },
    { key: 'country', label: 'Country (Text)' },
    { key: 'wordCount', label: 'Word Count (Number)' },
    { key: 'charCount', label: 'Character Count (Number)' },
    { key: 'avg1m', label: '1 Month Average (Number)' },
    { key: 'avg3m', label: '3 Month Average (Number)' },
    { key: 'avg6m', label: '6 Month Average (Number)' },
    { key: 'avgTot', label: 'Total Average (Number)' },
    { key: 'trendSlope', label: 'Trend Slope (Text/Number)' },
    { key: 'trendingSpike', label: 'Trending Spike (Text/Number)' },
  ],
};

function openFilterModal(tableId) {
  activeFilterTable = tableId;
  const fields = tableFilterFields[tableId] || [];
  const colSelect = document.getElementById('filterColumnSelect');
  colSelect.innerHTML = fields.map((f) => `<option value="${f.key}">${f.label}</option>`).join('');

  renderActiveFilterRules();
  document.getElementById('filterModal').classList.remove('hidden');
}

function closeFilterModal() {
  document.getElementById('filterModal').classList.add('hidden');
}

function addFilterRule() {
  const col = document.getElementById('filterColumnSelect').value;
  const op = document.getElementById('filterOperatorSelect').value;
  const val = document.getElementById('filterValueInput').value.trim();
  if (!val) return;

  if (!state.filters[activeFilterTable]) state.filters[activeFilterTable] = [];
  state.filters[activeFilterTable].push({ column: col, op, value: val });
  document.getElementById('filterValueInput').value = '';

  renderActiveFilterRules();
  triggerRerenderTable(activeFilterTable);
}

function removeFilterRule(index) {
  state.filters[activeFilterTable].splice(index, 1);
  renderActiveFilterRules();
  triggerRerenderTable(activeFilterTable);
}

function clearAllFilterRules() {
  state.filters[activeFilterTable] = [];
  renderActiveFilterRules();
  triggerRerenderTable(activeFilterTable);
}

function renderActiveFilterRules() {
  const list = document.getElementById('activeRulesList');
  const rules = state.filters[activeFilterTable] || [];

  if (rules.length === 0) {
    list.innerHTML = `<span class="text-xs text-slate-400">No active filters applied. Showing all rows.</span>`;
    return;
  }

  list.innerHTML = rules
    .map(
      (r, i) => `
    <div class="flex items-center justify-between p-2 rounded-lg bg-slate-100 text-xs text-slate-800">
      <span class="font-medium">${r.column} <span class="text-red-600 font-bold">${r.op}</span> "${escapeHtml(r.value)}"</span>
      <button onclick="removeFilterRule(${i})" class="text-slate-400 hover:text-red-600"><i class="ph ph-trash"></i></button>
    </div>
  `
    )
    .join('');
}

function updateFilterBadge(tableId) {
  const badge = document.getElementById(`${tableId}FilterBadge`);
  if (!badge) return;
  const count = (state.filters[tableId] || []).length;
  if (count > 0) {
    badge.textContent = `Filters (${count})`;
    badge.parentElement.classList.add('bg-red-50', 'text-red-700', 'border-red-200');
  } else {
    badge.textContent = `Filters`;
    badge.parentElement.classList.remove('bg-red-50', 'text-red-700', 'border-red-200');
  }
}

function triggerRerenderTable(tableId) {
  if (tableId === 'keywords') renderKeywords();
  else if (tableId === 'pins') renderPins();
  else if (tableId === 'boards') renderBoards();
  else if (tableId === 'users') renderUsers();
  else if (tableId === 'annotations') renderAnnotations();
  else if (tableId === 'trends') renderTrends();
}

// ----------------------------------------------------------------------
// 10. MEDIA DOWNLOADER (TDownloadMediaForm & JSZip Export)
// ----------------------------------------------------------------------
function openDownloadMediaModal(selectedOnly = false) {
  const scopeSelect = document.getElementById('dlTargetScope');
  if (selectedOnly) scopeSelect.value = 'selected';
  else scopeSelect.value = 'all';

  document.getElementById('dlProgressContainer').classList.add('hidden');
  document.getElementById('downloadMediaModal').classList.remove('hidden');
}

function closeDownloadMediaModal() {
  document.getElementById('downloadMediaModal').classList.add('hidden');
}

async function executeMediaDownload() {
  const mediaType = document.getElementById('dlMediaType').value;
  const scope = document.getElementById('dlTargetScope').value;
  const naming = document.getElementById('dlNamingFormat').value;

  let targetPins = [...state.pins];
  if (scope === 'selected') {
    targetPins = targetPins.filter((p) => state.selected.pins.has(p.id));
    if (targetPins.length === 0) {
      alert('Please select at least one pin from the table first.');
      return;
    }
  }

  if (targetPins.length === 0) {
    alert('No pins available to download.');
    return;
  }

  const btn = document.getElementById('startDownloadBtn');
  btn.disabled = true;
  document.getElementById('dlProgressContainer').classList.remove('hidden');

  const zip = new JSZip();
  const folder = zip.folder('PinInspector_Media');

  let completed = 0;
  const total = targetPins.length;

  for (let i = 0; i < targetPins.length; i++) {
    const pin = targetPins[i];
    const rank = i + 1;
    let safeTitle = (pin.title || pin.description || 'pin').replace(/[/\\?%*:|"<>]/g, '').trim().substring(0, 40);

    let filenameBase = `${rank}_${pin.id}_${safeTitle}`;
    if (naming === 'id_title') filenameBase = `${pin.id}_${safeTitle}`;
    if (naming === 'id') filenameBase = `${pin.id}`;

    // Download Image
    const pinImgUrl = getPinImageUrl(pin, false);
    if ((mediaType === 'both' || mediaType === 'images') && pinImgUrl) {
      try {
        const resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(pinImgUrl)}`);
        if (resp.ok) {
          const blob = await resp.blob();
          folder.file(`${filenameBase}.jpg`, blob);
        }
      } catch (err) {
        console.warn('Failed image download:', pin.id, err);
      }
    }

    // Video media if available (route via proxy to avoid CDN CORS blocks)
    const pinVideoUrl = pin.videoUrl || (pin['Video link'] && pin['Video link'] !== 'not-given' ? pin['Video link'] : '');
    if ((mediaType === 'both' || mediaType === 'videos') && pinVideoUrl) {
      try {
        const vResp = await fetch(`/api/proxy-image?url=${encodeURIComponent(pinVideoUrl)}`);
        if (vResp.ok) {
          const vBlob = await vResp.blob();
          folder.file(`${filenameBase}.mp4`, vBlob);
        }
      } catch (err) {
        console.warn('Failed video download:', pin.id || pin['Pin ID'], err);
      }
    }

    completed++;
    const pct = Math.round((completed / total) * 100);
    document.getElementById('dlProgressBar').style.width = `${pct}%`;
    document.getElementById('dlProgressPercent').textContent = `${pct}%`;
    document.getElementById('dlProgressText').textContent = `Processing pin ${completed} of ${total}...`;
  }

  document.getElementById('dlProgressText').textContent = `Packaging ZIP archive...`;
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `PinInspector_Media_${Date.now()}.zip`);

  btn.disabled = false;
  closeDownloadMediaModal();
  alert(`Downloaded ${completed} items successfully in ZIP archive!`);
}

function downloadSinglePinMedia(pinId) {
  const pin = state.pins.find((p) => (p.id || p['Pin ID']) === pinId);
  const pinImgUrl = getPinImageUrl(pin, false);
  if (!pin || !pinImgUrl) return;
  const link = document.createElement('a');
  link.href = `/api/proxy-image?url=${encodeURIComponent(pinImgUrl)}`;
  link.download = `pin_${pinId}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ----------------------------------------------------------------------
// 11. HTML FEED PREVIEW & STANDALONE HTML REPORT (PreviewHtmlFeed)
// ----------------------------------------------------------------------
function openFeedPreviewModal() {
  const filtered = getFilteredData('pins', state.pins);
  const container = document.getElementById('feedMasonryContainer');

  if (filtered.length === 0) {
    container.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400">No pins to preview in feed.</div>`;
  } else {
    container.innerHTML = filtered
      .map(
        (p) => {
          const pinUrl = p.url || p.pinUrl || (p.id ? `https://www.pinterest.com/pin/${p.id}/` : '#');
          const saves = Number(p.saves) || 0;
          const imgUrl = getPinImageUrl(p, false);
          return `
      <div class="masonry-item bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow border border-slate-200">
        <a href="${pinUrl}" target="_blank" class="block relative group">
          <img src="${imgUrl}" alt="pin" loading="lazy" referrerpolicy="no-referrer" class="w-full object-cover group-hover:opacity-95 transition-opacity" onerror="this.src='https://placehold.co/200x300?text=No+Img'">
          <div class="absolute top-2 right-2 bg-red-600 text-white text-xs px-2.5 py-0.5 rounded-full font-bold shadow-md">
            ${saves.toLocaleString()} saves
          </div>
        </a>
        <div class="p-3.5 space-y-2">
          <h4 class="font-semibold text-slate-900 text-xs line-clamp-2 leading-snug">${escapeHtml(p.title || p.description || 'Pinterest Pin')}</h4>
          <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            <span>❤️ ${p.reactions?.love || 0}</span>
            <span>😲 ${p.reactions?.goodIdea || p.reactions?.wow || 0}</span>
            <span class="truncate max-w-[120px] font-mono text-blue-600">${escapeHtml(p.domain || '')}</span>
          </div>
        </div>
      </div>
    `;
        }
      )
      .join('');
  }

  document.getElementById('feedPreviewModal').classList.remove('hidden');
}

function closeFeedPreviewModal() {
  document.getElementById('feedPreviewModal').classList.add('hidden');
}

function exportFeedHTMLFile() {
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pin Inspector - Pinterest Feed Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px; }
    h1 { text-align: center; color: #0f172a; margin-bottom: 24px; }
    .grid { column-count: 4; column-gap: 16px; max-width: 1200px; margin: 0 auto; }
    .card { break-inside: avoid; margin-bottom: 16px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
    .card img { width: 100%; display: block; }
    .card-body { padding: 12px; }
    .title { font-size: 13px; font-weight: 600; color: #1e293b; margin: 0 0 8px 0; }
    .meta { font-size: 11px; color: #64748b; display: flex; justify-content: space-between; border-top: 1px solid #f1f5f9; padding-top: 8px; }
    .saves { color: #e60023; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Pinterest Pin Inspector Report - ${escapeHtml(state.currentPinsQuery || '')}</h1>
  <div class="grid">
    ${document.getElementById('feedMasonryContainer').innerHTML}
  </div>
</body>
</html>`;

  downloadFile(`PinInspector_Feed_${Date.now()}.html`, htmlContent, 'text/html');
}

function openTablePreviewModal() {
  const filtered = getFilteredData('pins', state.pins);
  const container = document.getElementById('tablePreviewContainer');

  container.innerHTML = `
    <table class="w-full text-left border-collapse text-xs border border-slate-200">
      <thead class="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
        <tr>
          <th class="p-2 border">#</th>
          <th class="p-2 border">Pin ID</th>
          <th class="p-2 border">Title</th>
          <th class="p-2 border">Saves</th>
          <th class="p-2 border">Reactions</th>
          <th class="p-2 border">Love</th>
          <th class="p-2 border">Video</th>
          <th class="p-2 border">Domain</th>
          <th class="p-2 border">Board</th>
          <th class="p-2 border">Pinner</th>
        </tr>
      </thead>
      <tbody>
        ${filtered
          .map(
            (p, idx) => `
          <tr class="border-b hover:bg-slate-50">
            <td class="p-2 border text-center font-mono">${idx + 1}</td>
            <td class="p-2 border font-mono">${p.id}</td>
            <td class="p-2 border font-medium">${escapeHtml(p.title || p.description || '—')}</td>
            <td class="p-2 border text-center font-bold text-red-600">${(Number(p.saves) || 0).toLocaleString()}</td>
            <td class="p-2 border text-center">${(Number(p.reactionCount ?? p.totalReactions) || 0).toLocaleString()}</td>
            <td class="p-2 border text-center">${p.reactions?.love || 0}</td>
            <td class="p-2 border text-center">${p.isVideo ? 'Yes' : 'No'}</td>
            <td class="p-2 border">${escapeHtml(p.domain || '—')}</td>
            <td class="p-2 border">${escapeHtml(p.boardName || p.board?.name || '—')}</td>
            <td class="p-2 border">@${escapeHtml(p.pinnerUsername || p.pinner?.username || '—')}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('tablePreviewModal').classList.remove('hidden');
}

function closeTablePreviewModal() {
  document.getElementById('tablePreviewModal').classList.add('hidden');
}

function exportTableHTMLFile() {
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pin Inspector - Data Table Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; background: #fff; }
    h1 { font-size: 20px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>Pin Inspector Intelligence Table - ${escapeHtml(state.currentPinsQuery || '')} (${new Date().toLocaleDateString()})</h1>
  ${document.getElementById('tablePreviewContainer').innerHTML}
</body>
</html>`;

  downloadFile(`PinInspector_Report_${Date.now()}.html`, htmlContent, 'text/html');
}

// ----------------------------------------------------------------------
// 12. PROJECT FILE SAVE / LOAD (.pin / .json)
// ----------------------------------------------------------------------
function saveProjectFile() {
  const projectData = {
    version: '2.0.0',
    type: 'PinInspectorProject',
    createdAt: new Date().toISOString(),
    keywords: state.keywords,
    pins: state.pins,
    boards: state.boards,
    users: state.users,
    annotations: state.annotations,
    trends: state.trends,
    winnerPins: state.winnerPins,
    winnerQuery: state.winnerQuery,
    winnerPinType: state.winnerPinType,
    winnerCountry: state.winnerCountry,
    winnerFilter: state.winnerFilter,
    filters: state.filters,
    currentPinsQuery: state.currentPinsQuery,
  };

  const jsonStr = JSON.stringify(projectData, null, 2);
  downloadFile(`PinInspector_Project_${Date.now()}.pin`, jsonStr, 'application/json');
}

function loadProjectFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.keywords) state.keywords = data.keywords;
      if (data.pins) state.pins = data.pins;
      if (data.boards) state.boards = data.boards;
      if (data.users) state.users = data.users;
      if (data.annotations) state.annotations = data.annotations;
      if (data.trends) state.trends = data.trends;
      if (Array.isArray(data.winnerPins)) state.winnerPins = data.winnerPins;
      if (typeof data.winnerQuery === 'string') {
        state.winnerQuery = data.winnerQuery;
        const wkInput = document.getElementById('winnerKeywordInput');
        if (wkInput) wkInput.value = data.winnerQuery;
      }
      if (typeof data.winnerPinType === 'string') {
        state.winnerPinType = data.winnerPinType;
        const ptSelect = document.getElementById('winnerSearchInSelect');
        if (ptSelect) ptSelect.value = data.winnerPinType;
      }
      if (typeof data.winnerCountry === 'string') {
        state.winnerCountry = data.winnerCountry;
        const cSelect = document.getElementById('winnerCountrySelect');
        if (cSelect) cSelect.value = data.winnerCountry;
      }
      if (data.winnerFilter && typeof data.winnerFilter === 'object') {
        state.winnerFilter = { ...state.winnerFilter, ...data.winnerFilter };
        applyWinnerFilterToControls();
      }
      if (data.filters) state.filters = data.filters;
      if (data.currentPinsQuery) state.currentPinsQuery = data.currentPinsQuery;

      renderKeywords();
      renderPins();
      renderBoards();
      renderUsers();
      renderAnnotations();
      renderTrends();
      renderWinnerPins();

      alert('Project session restored successfully!');
    } catch (err) {
      alert(`Invalid project file format: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// ----------------------------------------------------------------------
// 13. BULK IMPORT MODAL (TImportForm)
// ----------------------------------------------------------------------
function openImportModal(tool) {
  activeImportTool = tool;
  const title = document.getElementById('importModalTitle');
  const desc = document.getElementById('importModalDesc');
  const txt = document.getElementById('importTextarea');
  txt.value = '';

  if (tool === 'pins') {
    title.innerHTML = `<i class="ph ph-push-pin text-xl text-red-600"></i> Bulk Import Pins`;
    desc.textContent = 'Paste Pinterest Pin URLs or numeric Pin IDs (one per line):';
    txt.placeholder = 'https://www.pinterest.com/pin/1011902603761825634/\n1011902603761825635';
  } else if (tool === 'boards') {
    title.innerHTML = `<i class="ph ph-squares-four text-xl text-red-600"></i> Bulk Import Boards`;
    desc.textContent = 'Paste Board URLs or Board IDs (one per line):';
    txt.placeholder = 'https://www.pinterest.com/username/boho-decor/\n1011902603761825634';
  } else if (tool === 'users') {
    title.innerHTML = `<i class="ph ph-users text-xl text-red-600"></i> Bulk Import Creators`;
    desc.textContent = 'Paste Pinterest profile URLs or usernames (one per line):';
    txt.placeholder = 'https://www.pinterest.com/foodnetwork/\nmarthastewart';
  }

  document.getElementById('importModal').classList.remove('hidden');
}

function closeImportModal() {
  document.getElementById('importModal').classList.add('hidden');
}

async function executeBulkImport() {
  const raw = document.getElementById('importTextarea').value;
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return;

  closeImportModal();

  if (activeImportTool === 'pins') {
    switchTab('pins');
    switchPinsSubTab('browse-scrape');
    const textarea = document.getElementById('browseScrapeLinksInput');
    if (textarea) {
      textarea.value = lines.join('\n');
      updateBrowseScrapeLinksCount();
    }
    startBrowseScrape();
  } else if (activeImportTool === 'users') {
    const usernames = lines
      .map((l) => l.replace(/^https?:\/\/(?:www\.)?pinterest\.[^/]+\//i, '').split(/[/?#]/)[0].replace(/^@/, '').trim())
      .filter(Boolean);
    if (usernames.length === 1) {
      analyzeUserPins(usernames[0]);
    } else if (usernames.length > 1) {
      state.selected.users = new Set(usernames);
      await analyzeSelectedUsersPins();
    }
  } else if (activeImportTool === 'boards') {
    document.getElementById('boardsInput').value = lines[0];
    switchTab('boards');
    document.getElementById('boardsForm')?.dispatchEvent(new Event('submit'));
  }
}

// ----------------------------------------------------------------------
// 14. SEED KEYWORDS CLEAN TOOL (SeedsCleanMIClick)
// ----------------------------------------------------------------------
function openSeedsModal() {
  document.getElementById('seedsTextarea').value = document.getElementById('kwInput').value.replace(/,/g, '\n');
  document.getElementById('seedsModal').classList.remove('hidden');
}

function closeSeedsModal() {
  document.getElementById('seedsModal').classList.add('hidden');
}

function cleanSeeds(action) {
  const textarea = document.getElementById('seedsTextarea');
  let lines = textarea.value.split('\n').map((l) => l.trim()).filter(Boolean);

  if (action === 'dedupe') {
    lines = Array.from(new Set(lines.map((l) => l.toLowerCase())));
  } else if (action === 'lowercase') {
    lines = lines.map((l) => l.toLowerCase());
  } else if (action === 'trim') {
    lines = lines.map((l) => l.replace(/[^a-zA-Z0-9\s]/g, '').trim());
  } else if (action === 'clear') {
    lines = [];
  }

  textarea.value = lines.join('\n');
}

function applySeedsToKeywordInput() {
  const lines = document.getElementById('seedsTextarea').value.split('\n').map((l) => l.trim()).filter(Boolean);
  document.getElementById('kwInput').value = lines.join(', ');
  closeSeedsModal();
}

// ----------------------------------------------------------------------
// 15. BOOKMARKS SYSTEM (TBookmarkForm)
// ----------------------------------------------------------------------
function openBookmarksDrawer() {
  renderBookmarks();
  document.getElementById('bookmarksDrawer').classList.remove('hidden');
}

function closeBookmarksDrawer() {
  document.getElementById('bookmarksDrawer').classList.add('hidden');
}

function addBookmark(type, item) {
  const bookmark = {
    id: Date.now().toString(),
    type,
    title: item.title || item.name || item.username || item.id,
    url: item.url || '',
    img: item.img || null,
    addedAt: new Date().toLocaleDateString(),
  };

  state.bookmarks.unshift(bookmark);
  localStorage.setItem('piw_bookmarks', JSON.stringify(state.bookmarks));
  updateBookmarksBadge();
  alert(`Added "${bookmark.title}" to Bookmarks!`);
}

function removeBookmark(id) {
  state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
  localStorage.setItem('piw_bookmarks', JSON.stringify(state.bookmarks));
  updateBookmarksBadge();
  renderBookmarks();
}

function renderBookmarks() {
  const container = document.getElementById('bookmarksList');
  const query = (document.getElementById('bookmarkFilterInput')?.value || '').toLowerCase();
  const list = state.bookmarks.filter((b) => b.title.toLowerCase().includes(query));

  if (list.length === 0) {
    container.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs">No bookmarks found. Click the star icon on any keyword, pin, board, or user to save it here.</div>`;
    return;
  }

  container.innerHTML = list
    .map(
      (b) => `
    <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs">
      <div class="flex items-center space-x-2.5 overflow-hidden">
        <span class="p-1.5 rounded-lg bg-amber-100 text-amber-800 font-bold uppercase text-[10px]">${b.type}</span>
        <div class="truncate">
          <span class="font-semibold text-slate-900 block truncate">${escapeHtml(b.title)}</span>
          <span class="text-[10px] text-slate-400 font-mono">${b.addedAt}</span>
        </div>
      </div>
      <div class="flex items-center space-x-1 shrink-0">
        ${b.url ? `<a href="${b.url}" target="_blank" class="p-1 text-slate-400 hover:text-slate-600"><i class="ph ph-arrow-square-out text-sm"></i></a>` : ''}
        <button onclick="removeBookmark('${b.id}')" class="p-1 text-slate-400 hover:text-red-600"><i class="ph ph-trash text-sm"></i></button>
      </div>
    </div>
  `
    )
    .join('');
}

function updateBookmarksBadge() {
  const badge = document.getElementById('bookmarksCountBadge');
  if (badge) badge.textContent = state.bookmarks.length;
}

function exportBookmarksJSON() {
  downloadFile(`PinInspector_Bookmarks_${Date.now()}.json`, JSON.stringify(state.bookmarks, null, 2), 'application/json');
}

// ----------------------------------------------------------------------
// 16. SELECTION & BATCH ACTIONS
// ----------------------------------------------------------------------
function toggleSelectRow(tableId, id, isChecked) {
  if (isChecked) state.selected[tableId].add(id);
  else state.selected[tableId].delete(id);
  updateSelectionBar();
  triggerRerenderTable(tableId);
}

function toggleSelectAll(tableId, isChecked) {
  const data = getFilteredData(tableId, state[tableId]);
  if (isChecked) {
    data.forEach((item) => {
      const id = item.id || item.keyword || item.username || item.annotation || item.term;
      state.selected[tableId].add(id);
    });
  } else {
    state.selected[tableId].clear();
  }
  updateSelectionBar();
  triggerRerenderTable(tableId);
}

function invertSelection() {
  const tableId = state.currentTab;
  const data = getFilteredData(tableId, state[tableId]);
  data.forEach((item) => {
    const id = item.id || item.keyword || item.username || item.annotation || item.term;
    if (state.selected[tableId].has(id)) state.selected[tableId].delete(id);
    else state.selected[tableId].add(id);
  });
  updateSelectionBar();
  triggerRerenderTable(tableId);
}

function clearSelection() {
  state.selected[state.currentTab].clear();
  updateSelectionBar();
  triggerRerenderTable(state.currentTab);
}

function deleteSelectedRows() {
  const tableId = state.currentTab;
  const sel = state.selected[tableId];
  if (sel.size === 0) return;

  if (confirm(`Delete ${sel.size} selected row(s)?`)) {
    state[tableId] = state[tableId].filter((item) => {
      const id = item.id || item.keyword || item.username || item.annotation || item.term;
      return !sel.has(id);
    });
    sel.clear();
    updateSelectionBar();
    triggerRerenderTable(tableId);
  }
}

function updateSelectionBar() {
  const bar = document.getElementById('selectionBar');
  const tableId = state.currentTab;
  const count = state.selected[tableId]?.size || 0;

  if (count > 0) {
    bar.classList.remove('hidden');
    document.getElementById('selectedCountText').textContent = `${count} rows selected`;
    const batchDlBtn = document.getElementById('batchDownloadMediaBtn');
    const batchUserPinsBtn = document.getElementById('batchAnalyzeUserPinsBtn');
    const batchUserBoardsBtn = document.getElementById('batchAnalyzeUserBoardsBtn');

    if (tableId === 'pins') batchDlBtn?.classList.remove('hidden');
    else batchDlBtn?.classList.add('hidden');

    if (tableId === 'users') {
      batchUserPinsBtn?.classList.remove('hidden');
      batchUserBoardsBtn?.classList.remove('hidden');
    } else {
      batchUserPinsBtn?.classList.add('hidden');
      batchUserBoardsBtn?.classList.add('hidden');
    }
  } else {
    bar.classList.add('hidden');
  }
}

function exportSelectedCSV() {
  const tableId = state.currentTab;
  const sel = state.selected[tableId];
  let data = state[tableId].filter((item) => {
    const id = item.id || item.keyword || item.username || item.annotation || item.term;
    return sel.has(id);
  });
  exportDataToCSV(`${tableId}_selected_${Date.now()}.csv`, data);
}

// ----------------------------------------------------------------------
// 17. SETTINGS MODAL (TSettingsForm)
// ----------------------------------------------------------------------
function openSettingsModal() {
  document.getElementById('keApiKeyInput').value = state.keApiKey;
  document.getElementById('keCountrySelect').value = state.keCountry;
  document.getElementById('keCurrencySelect').value = state.keCurrency;
  document.getElementById('customCookiesInput').value = state.customCookies;
  document.getElementById('downloadThreadsSelect').value = state.downloadThreads;
  document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

function switchSettingsTab(tab) {
  ['ke', 'session', 'threads'].forEach((t) => {
    document.getElementById(`setTab-${t}`).className = t === tab ? 'pb-2 border-b-2 border-red-600 text-red-600' : 'pb-2 border-b-2 border-transparent text-slate-500 hover:text-slate-800';
    const panel = document.getElementById(`setPanel-${t}`);
    if (t === tab) panel.classList.remove('hidden');
    else panel.classList.add('hidden');
  });
}

async function saveAllSettings() {
  state.keApiKey = document.getElementById('keApiKeyInput').value.trim();
  state.keCountry = document.getElementById('keCountrySelect').value;
  state.keCurrency = document.getElementById('keCurrencySelect').value;
  state.customCookies = document.getElementById('customCookiesInput').value.trim();
  state.downloadThreads = parseInt(document.getElementById('downloadThreadsSelect').value, 10);

  localStorage.setItem('piw_ke_api_key', state.keApiKey);
  localStorage.setItem('piw_ke_country', state.keCountry);
  localStorage.setItem('piw_ke_currency', state.keCurrency);
  localStorage.setItem('piw_custom_cookies', state.customCookies);
  localStorage.setItem('piw_dl_threads', state.downloadThreads);

  if (state.keApiKey) document.getElementById('keBadge')?.classList.remove('hidden');
  else document.getElementById('keBadge')?.classList.add('hidden');

  // Push session cookies to server
  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: state.customCookies }),
    });
    checkSessionStatus();
  } catch (err) {
    console.error('Failed to sync session cookies:', err);
  }

  closeSettingsModal();
  alert('Settings saved successfully!');
}

async function resetToAutoSession() {
  document.getElementById('customCookiesInput').value = '';
  state.customCookies = '';
  localStorage.removeItem('piw_custom_cookies');
  await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: '' }),
  });
  checkSessionStatus();
  alert('Reset to automatic anonymous session!');
}

// ----------------------------------------------------------------------
// 18. CROSS-TOOL ACTIONS & HELPERS
// ----------------------------------------------------------------------
function sendToPins(term) {
  if (!term) return;
  switchTab('pins');
  switchPinsSubTab('search');
  const input = document.getElementById('pinsSearchPhrase');
  if (input) input.value = term;
  startPinsSearch();
}

function sendToBoards(term) {
  if (!term) return;
  switchTab('boards');
  const input = document.getElementById('boardsInput');
  if (input) input.value = term;
  document.getElementById('boardsForm')?.dispatchEvent(new Event('submit'));
}

function sendToPeople(term) {
  if (!term) return;
  switchTab('users');
  const input = document.getElementById('usersInput');
  if (input) input.value = term;
  document.getElementById('usersForm')?.dispatchEvent(new Event('submit'));
}

function sendToKeywords(term) {
  if (!term) return;
  switchTab('keywords');
  const input = document.getElementById('kwInput');
  if (input) input.value = term;
  document.getElementById('keywordForm')?.dispatchEvent(new Event('submit'));
}

function sendToAnnotations(term) {
  if (!term) return;
  switchTab('annotations');
  switchAnnSubTab('keywords');
  const input = document.getElementById('annKeywordsInput');
  if (input) input.value = Array.isArray(term) ? term.join('\n') : term;
  extractAnnotationsFromKeywords();
}

function sendToTrends(term) {
  if (!term) return;
  switchTab('trends');
  if (Array.isArray(term) && term.length > 1) {
    importTrendsKeywords(term);
  } else {
    const single = Array.isArray(term) ? term[0] : term;
    const input = document.getElementById('trendSearchInput');
    if (input) input.value = single;
    generateTrends();
  }
}

// ----------------------------------------------------------------------
// PINS ANALYZER (Delphi Pin Inspector 2 Parity - 56 Columns & 3 Subtabs)
// ----------------------------------------------------------------------
const PIN_56_COLUMNS = [
  "Image", "Pin ID", "Title", "Saves", "Shares", "Repins", "Comments", "Removes",
  "Good Idea", "Love", "Thanks", "Wow", "Laughing", "Total Reactions",
  "Description", "Category", "Hashtags", "Created", "Method", "Domain",
  "Site Name", "Link", "Dominant Color", "Image Signature", "Is Repin",
  "Is Promoted", "Is Video", "Is Story", "Is Group Board", "Is AI Modified",
  "Video link", "Video Length", "Video Thumbnail", "Pinner Image",
  "Pinner Username", "Pinner Name", "Pinner Location", "Pinner Followers",
  "Board Name", "Board Link", "Board Category", "Board Image",
  "Creator Image", "Creator Username", "Creator Name", "Creator Location",
  "Creator Link", "Creator Followers", "Promoter Image", "Promoter Username",
  "Promoter Name", "Promoter Location", "Promoter Link", "Promoter Followers",
  "Annotations", "main link"
];

const PIN_CATEGORIES_38 = [
  { id: 'animals', name: 'Animals' },
  { id: 'architecture', name: 'Architecture' },
  { id: 'art', name: 'Art' },
  { id: 'cars_motorcycles', name: 'Cars and Motorcycles' },
  { id: 'celebrities', name: 'Celebrities' },
  { id: 'collage', name: 'Collage' },
  { id: 'cycling', name: 'Cycling' },
  { id: 'design', name: 'Design' },
  { id: 'dessert', name: 'Dessert' },
  { id: 'diy_crafts', name: 'Diy Crafts' },
  { id: 'education', name: 'Education' },
  { id: 'film_music_books', name: 'Film Music and Books' },
  { id: 'food_drink', name: 'Food and Drink' },
  { id: 'gardening', name: 'Gardening' },
  { id: 'geek', name: 'Geek' },
  { id: 'gifts', name: 'Gifts' },
  { id: 'hair_beauty', name: 'Hair and Beauty' },
  { id: 'health_fitness', name: 'Health and Fitness' },
  { id: 'history', name: 'History' },
  { id: 'holidays_events', name: 'Holidays and Events' },
  { id: 'home_decor', name: 'Home Decor' },
  { id: 'humor', name: 'Humor' },
  { id: 'illustrations_posters', name: 'Illustrations and Posters' },
  { id: 'kids', name: 'Kids' },
  { id: 'makeup', name: 'Makeup' },
  { id: 'mens_fashion', name: 'Mens Fashion' },
  { id: 'other', name: 'Other' },
  { id: 'outdoors', name: 'Outdoors' },
  { id: 'photography', name: 'Photography' },
  { id: 'products', name: 'Products' },
  { id: 'quotes', name: 'Quotes' },
  { id: 'science_nature', name: 'Science and Nature' },
  { id: 'sports', name: 'Sports' },
  { id: 'tattoos', name: 'Tattoos' },
  { id: 'technology', name: 'Technology' },
  { id: 'travel', name: 'Travel' },
  { id: 'weddings', name: 'Weddings' },
  { id: 'womens_fashion', name: 'Womens Fashion' },
];

function initCategoriesChecklist() {
  const container = document.getElementById('pinsCategoriesChecklist');
  if (!container) return;
  container.innerHTML = PIN_CATEGORIES_38.map(cat => `
    <label class="flex items-center gap-2 p-1 rounded hover:bg-slate-100 cursor-pointer select-none">
      <input type="checkbox" value="${cat.id}" onchange="updateCategoriesSelectedCount()" class="pins-cat-checkbox text-red-600 focus:ring-red-500 rounded">
      <span class="text-slate-700">${cat.name}</span>
    </label>
  `).join('');
  updateCategoriesSelectedCount();
}

function selectAllCategories(checked) {
  const checkboxes = document.querySelectorAll('.pins-cat-checkbox');
  checkboxes.forEach(cb => { cb.checked = checked; });
  updateCategoriesSelectedCount();
}

function updateCategoriesSelectedCount() {
  const checkboxes = document.querySelectorAll('.pins-cat-checkbox:checked');
  const countEl = document.getElementById('pinsCategoriesSelectedCount');
  if (countEl) countEl.textContent = `Selected: ${checkboxes.length}`;
}

function switchPinsSubTab(subTabId) {
  state.currentPinsSubTab = subTabId;
  const tabs = ['search', 'category', 'browse-scrape'];
  tabs.forEach((tab) => {
    const btn = document.getElementById(`pinsSubTab-${tab}`);
    const panel = document.getElementById(`pinsSubPanel-${tab}`);
    if (tab === subTabId) {
      if (btn) {
        btn.className = 'pins-subtab-btn px-4 py-2 text-xs font-bold rounded-lg bg-red-600 text-white shadow-xs transition-colors flex items-center gap-1.5';
      }
      if (panel) panel.classList.remove('hidden');
    } else {
      if (btn) {
        btn.className = 'pins-subtab-btn px-4 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors flex items-center gap-1.5';
      }
      if (panel) panel.classList.add('hidden');
    }
  });
}

async function startPinsSearch() {
  if (state.pinsRunning) return;

  const phrase = (document.getElementById('pinsSearchPhrase')?.value || '').trim();
  if (!phrase) {
    alert('Please enter a search phrase.');
    return;
  }

  const count = parseInt(document.getElementById('pinsTotalCountSelect')?.value, 10) || 50;
  const searchIn = document.getElementById('pinsSearchInSelect')?.value || 'pins';

  state.pinsRunning = true;
  state.pinsCancelled = false;
  state.pinsAbortController = new AbortController();

  const stopBtn = document.getElementById('pinsStopBtn');
  const searchBtn = document.getElementById('pinsSearchSubmitBtn');
  const progressBar = document.getElementById('pinsProgressBar');
  const progressText = document.getElementById('pinsProgressText');
  const statusBar = document.getElementById('pinsStatusBarStatus');

  if (stopBtn) stopBtn.disabled = false;
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = `Harvesting pins for "${phrase}"...`;
  if (statusBar) statusBar.textContent = `Harvesting pins...`;

  state.pins = [];
  renderPins();

  try {
    const url = `/api/pins?query=${encodeURIComponent(phrase)}&count=${count}&searchIn=${encodeURIComponent(searchIn)}&stream=true`;
    const res = await fetch(url, { signal: state.pinsAbortController.signal });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const rawEv of events) {
        if (!rawEv.trim() || !rawEv.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(rawEv.slice(6));
          if (ev.type === 'start') {
            if (progressText) progressText.textContent = `Harvesting pin IDs (target: ${ev.targetCount})...`;
          } else if (ev.type === 'harvested') {
            if (progressText) progressText.textContent = `Harvested ${ev.total} pins. Extracting analytics...`;
          } else if (ev.type === 'pin' && ev.pin) {
            state.pins.push(ev.pin);
            const pct = Math.round((ev.completed / ev.total) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `Extracting pin ${ev.completed} of ${ev.total} (${pct}%)`;
            if (statusBar) statusBar.textContent = `Extracting pin ${ev.completed} of ${ev.total}`;
            renderPins();
          } else if (ev.type === 'done') {
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = `Completed (${ev.total} pins extracted)`;
            if (statusBar) statusBar.textContent = 'Done';
          }
        } catch (err) {
          console.warn('Error parsing SSE event:', err);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || state.pinsCancelled) {
      if (progressText) progressText.textContent = 'Extraction Stopped';
      if (statusBar) statusBar.textContent = 'Stopped';
    } else {
      alert(`Search failed: ${err.message}`);
      if (progressText) progressText.textContent = 'Error';
      if (statusBar) statusBar.textContent = 'Error';
    }
  } finally {
    state.pinsRunning = false;
    state.pinsAbortController = null;
    if (stopBtn) stopBtn.disabled = true;
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    renderPins();
  }
}

async function startPinsCategorySearch() {
  if (state.pinsRunning) return;

  const checkboxes = document.querySelectorAll('.pins-cat-checkbox:checked');
  const selectedCats = Array.from(checkboxes).map(cb => cb.value);

  if (selectedCats.length === 0) {
    alert('You must select at least one category checkbox');
    return;
  }

  const count = parseInt(document.getElementById('pinsCategoryCountSelect')?.value, 10) || 10;

  state.pinsRunning = true;
  state.pinsCancelled = false;
  state.pinsAbortController = new AbortController();

  const stopBtn = document.getElementById('pinsStopBtn');
  const searchBtn = document.getElementById('pinsCategorySubmitBtn');
  const progressBar = document.getElementById('pinsProgressBar');
  const progressText = document.getElementById('pinsProgressText');
  const statusBar = document.getElementById('pinsStatusBarStatus');

  if (stopBtn) stopBtn.disabled = false;
  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = `Harvesting category pins...`;
  if (statusBar) statusBar.textContent = `Harvesting pins...`;

  state.pins = [];
  renderPins();

  try {
    const url = `/api/pins/category?categories=${encodeURIComponent(selectedCats.join(','))}&count=${count}&stream=true`;
    const res = await fetch(url, { signal: state.pinsAbortController.signal });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const rawEv of events) {
        if (!rawEv.trim() || !rawEv.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(rawEv.slice(6));
          if (ev.type === 'start') {
            if (progressText) progressText.textContent = `Harvesting category pins (target: ${ev.targetCount} per cat)...`;
          } else if (ev.type === 'harvested') {
            if (progressText) progressText.textContent = `Harvested ${ev.total} pins. Extracting analytics...`;
          } else if (ev.type === 'pin' && ev.pin) {
            state.pins.push(ev.pin);
            const pct = Math.round((ev.completed / ev.total) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `Extracting pin ${ev.completed} of ${ev.total} (${pct}%)`;
            if (statusBar) statusBar.textContent = `Extracting pin ${ev.completed} of ${ev.total}`;
            renderPins();
          } else if (ev.type === 'done') {
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) progressText.textContent = `Completed (${ev.total} pins extracted)`;
            if (statusBar) statusBar.textContent = 'Done';
          }
        } catch (err) {
          console.warn('Error parsing SSE event:', err);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || state.pinsCancelled) {
      if (progressText) progressText.textContent = 'Extraction Stopped';
      if (statusBar) statusBar.textContent = 'Stopped';
    } else {
      alert(`Category search failed: ${err.message}`);
      if (progressText) progressText.textContent = 'Error';
      if (statusBar) statusBar.textContent = 'Error';
    }
  } finally {
    state.pinsRunning = false;
    state.pinsAbortController = null;
    if (stopBtn) stopBtn.disabled = true;
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    renderPins();
  }
}

async function startBrowseScrape(presetPins = null) {
  if (state.pinsRunning) return;

  let pinItems = [];
  if (presetPins && Array.isArray(presetPins) && presetPins.length > 0) {
    pinItems = presetPins.map(p => ({
      id: String(p.id),
      url: p.pinUrl || `https://www.pinterest.com/pin/${p.id}/`
    }));
  } else {
    const rawText = document.getElementById('browseScrapeLinksInput')?.value || '';
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      alert('Please enter at least one pin link in the text area.');
      return;
    }
    for (const line of lines) {
      const match = line.match(/pin\/(\d+)/) || line.match(/(\d{10,25})/);
      const id = match ? match[1] : '';
      if (id) {
        pinItems.push({
          id,
          url: line.startsWith('http') ? line : `https://www.pinterest.com/pin/${id}/`
        });
      }
    }
    if (pinItems.length === 0) {
      alert('Could not detect any valid Pinterest Pin IDs in the input.');
      return;
    }
  }

  state.pinsRunning = true;
  state.pinsCancelled = false;
  state.pinsAbortController = new AbortController();

  const stopBtn = document.getElementById('pinsStopBtn');
  const analyzeBtn = document.getElementById('browseScrapeAnalyzeBtn');
  const progressBar = document.getElementById('pinsProgressBar');
  const progressText = document.getElementById('pinsProgressText');
  const statusBar = document.getElementById('pinsStatusBarStatus');

  if (stopBtn) stopBtn.disabled = false;
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }

  state.pins = pinItems.map((item, idx) => {
    const preset = (presetPins && Array.isArray(presetPins)) ? presetPins[idx] : null;
    const presetImg = getPinImageUrl(preset, false);
    const presetThumb = getPinImageUrl(preset, true);
    const initObj = {};
    for (const col of PIN_56_COLUMNS) {
      if (col === 'Image') initObj[col] = presetImg || 'Extracting...';
      else if (col === 'Pin ID') initObj[col] = item.id;
      else if (col === 'main link') initObj[col] = item.url;
      else if (col === 'Title') initObj[col] = preset?.Title || preset?.title || 'Extracting...';
      else if (col === 'Board') initObj[col] = preset?.board || 'not-extracted';
      else if (col === 'Pinner Name') initObj[col] = preset?.pinner || preset?.author || 'not-extracted';
      else if (col === 'Pinner Username') initObj[col] = preset?.pinnerUsername || 'not-extracted';
      else if (col === 'Saves') initObj[col] = preset?.saves ?? 'not-extracted';
      else if (col.startsWith('Is ')) initObj[col] = 'NO';
      else initObj[col] = 'not-extracted';
    }
    initObj.id = item.id;
    initObj.title = preset?.Title || preset?.title || 'Extracting...';
    initObj.image = presetImg || '';
    initObj.thumbnail = presetThumb || presetImg || '';
    initObj.url = item.url;
    initObj.pinUrl = item.url;
    return initObj;
  });

  renderPins();

  const total = pinItems.length;
  let completed = 0;

  // Throttle renderPins to avoid full DOM reflow thrashing
  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderPins();
    });
  }

  // Batch configuration matching Delphi Pin Inspector 2 multithreaded architecture
  const BATCH_SIZE = 10;
  const chunks = [];
  for (let i = 0; i < total; i += BATCH_SIZE) {
    chunks.push({
      startIdx: i,
      items: pinItems.slice(i, i + BATCH_SIZE),
    });
  }

  let chunkIdx = 0;
  const chunkConcurrency = Math.min(2, chunks.length);

  async function batchWorker() {
    while (chunkIdx < chunks.length && !state.pinsCancelled) {
      const chunk = chunks[chunkIdx++];
      const ids = chunk.items.map((it) => it.id);
      try {
        const res = await fetch('/api/scrape-pins-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pins: ids }),
          signal: state.pinsAbortController.signal,
        });

        if (res.ok) {
          const data = await res.json();
          const map = data.resultsMap || {};
          for (let k = 0; k < chunk.items.length; k++) {
            const item = chunk.items[k];
            const globalIdx = chunk.startIdx + k;
            if (map[item.id]) {
              const prevImg = getPinImageUrl(state.pins[globalIdx], false);
              const scrapedPin = map[item.id];
              if (!getPinImageUrl(scrapedPin, false) && prevImg) {
                scrapedPin.Image = prevImg;
                scrapedPin.image = prevImg;
                scrapedPin.thumbnail = getPinImageUrl(state.pins[globalIdx], true) || prevImg;
              }
              state.pins[globalIdx] = scrapedPin;
            }
          }
        } else {
          throw new Error('Batch scrape returned status ' + res.status);
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        console.warn('Batch chunk failed, falling back to individual scrape:', err);
        await Promise.all(
          chunk.items.map(async (item, k) => {
            if (state.pinsCancelled) return;
            try {
              const res = await fetch(`/api/scrape-pin?pinId=${encodeURIComponent(item.id)}`, {
                signal: state.pinsAbortController.signal,
              });
              if (res.ok) {
                const data = await res.json();
                if (data.pin) {
                  const globalIdx = chunk.startIdx + k;
                  const prevImg = getPinImageUrl(state.pins[globalIdx], false);
                  if (!getPinImageUrl(data.pin, false) && prevImg) {
                    data.pin.Image = prevImg;
                    data.pin.image = prevImg;
                    data.pin.thumbnail = getPinImageUrl(state.pins[globalIdx], true) || prevImg;
                  }
                  state.pins[globalIdx] = data.pin;
                }
              }
            } catch (e) {
              // ignore
            }
          })
        );
      } finally {
        completed += chunk.items.length;
        const pct = Math.min(100, Math.round((completed / total) * 100));
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `Extracting pin ${Math.min(completed, total)} of ${total} (${pct}%)`;
        if (statusBar) statusBar.textContent = `Extracting pin ${Math.min(completed, total)} of ${total}`;
        scheduleRender();
      }
    }
  }

  const workers = Array.from({ length: chunkConcurrency }, () => batchWorker());
  await Promise.all(workers);
  renderPins();

  state.pinsRunning = false;
  state.pinsAbortController = null;
  if (stopBtn) stopBtn.disabled = true;
  if (analyzeBtn) {
    analyzeBtn.disabled = false;
    analyzeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }

  if (state.pinsCancelled) {
    if (progressText) progressText.textContent = 'Extraction Stopped';
    if (statusBar) statusBar.textContent = 'Stopped';
  } else {
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = `Completed (${total} pins extracted)`;
    if (statusBar) statusBar.textContent = 'Done';
  }
}

function stopPinsScrape() {
  state.pinsCancelled = true;
  if (state.pinsAbortController) {
    state.pinsAbortController.abort();
  }
  const stopBtn = document.getElementById('pinsStopBtn');
  if (stopBtn) stopBtn.disabled = true;
  const progressText = document.getElementById('pinsProgressText');
  if (progressText) progressText.textContent = 'Stopping...';
}

let contextPinIndex = null;
let contextPinCol = null;
let contextPinValue = '';

function renderPins() {
  const tbody = document.getElementById('pinsTableBody');
  const countEl = document.getElementById('pinsTotalItemsDisplay');
  if (!tbody) return;

  if (!state.pins || state.pins.length === 0) {
    tbody.innerHTML = `<tr><td colspan="57" class="py-12 text-center text-slate-400">Enter a search phrase, select categories, or paste pin links and click Search / Analyze.</td></tr>`;
    if (countEl) countEl.textContent = 'Total Items: 0';
    updateFilterBadge('pins');
    updatePinsSortIndicators();
    return;
  }

  const filtered = getFilteredData('pins', state.pins);
  if (countEl) {
    if (filtered.length !== state.pins.length) {
      countEl.textContent = `Total Items: ${filtered.length} (Filtered from ${state.pins.length})`;
    } else {
      countEl.textContent = `Total Items: ${state.pins.length}`;
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="57" class="py-12 text-center text-slate-400">No pins match the current filter criteria. <button type="button" onclick="pinClearFilters()" class="ml-2 text-red-600 hover:underline font-semibold cursor-pointer">Clear Filters</button></td></tr>`;
  } else {
    tbody.innerHTML = filtered
      .map((p, idx) => buildPinRowHtml(idx, p))
      .join('');
  }

  updateFilterBadge('pins');
  updatePinsSortIndicators();
  applyColumnVisibility('pins');
}

function buildPinRowHtml(index, p) {
  const fullImg = getPinImageUrl(p, false);
  const thumb = getPinImageUrl(p, true) || fullImg;
  const pinId = p['Pin ID'] || p.id || '';
  const mainLink = p['main link'] || (pinId ? `https://www.pinterest.com/pin/${pinId}/` : '#');
  const imgSize = state.pinsImgSize || 25;
  const wrap = state.pinsWrapText ? 'whitespace-normal break-words' : 'whitespace-nowrap';
  const titleWrap = state.pinsWrapText ? 'whitespace-normal break-words' : 'whitespace-nowrap truncate';

  let imageCell = '';
  if (thumb) {
    const proxyFallback = `/api/proxy-image?inline=1&url=${encodeURIComponent(fullImg || thumb)}`;
    imageCell = `<a href="${mainLink}" target="_blank" class="block rounded overflow-hidden bg-slate-100 shadow-xs border border-slate-200 mx-auto" style="width:${Math.round(imgSize * 0.7)}px; height:${imgSize}px;">
      <img src="${thumb}" alt="pin" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="if(!this.dataset.proxied){this.dataset.proxied='1';this.src='${proxyFallback}';}else{this.outerHTML='<span class=\\'text-slate-400 text-[10px] italic\\'>not-given</span>';}">
    </a>`;
  } else if (p.Image === 'Extracting...') {
    imageCell = `<span class="text-amber-600 font-semibold animate-pulse text-[10px]">Extracting...</span>`;
  } else {
    imageCell = `<span class="text-slate-400 text-[11px] italic">${escapeHtml(p.Image || 'not-given')}</span>`;
  }

  let titleCell = '';
  if (p.Title === 'Extracting...') {
    titleCell = `<span class="text-amber-600 font-semibold animate-pulse">Extracting...</span>`;
  } else if (p.Title === 'not-extracted') {
    titleCell = `<span class="text-slate-400 italic">not-extracted</span>`;
  } else {
    titleCell = `<a href="${mainLink}" target="_blank" class="font-medium text-slate-900 hover:text-red-600 ${titleWrap} max-w-sm block">${escapeHtml(p.Title || p.title || 'Untitled')}</a>`;
  }

  const cells = [
    `<td class="py-2.5 px-2 text-center font-mono text-slate-400 text-[11px] col-pin-0" data-col="#">${index + 1}</td>`,
    `<td class="py-2.5 px-3 text-center col-pin-1" data-col="Image">${imageCell}</td>`,
    `<td class="py-2.5 px-3 font-mono text-xs col-pin-2" data-col="Pin ID"><a href="${mainLink}" target="_blank" class="hover:underline text-blue-600 font-semibold">${escapeHtml(pinId)}</a></td>`,
    `<td class="py-2.5 px-4 min-w-[200px] max-w-sm col-pin-3" data-col="Title">${titleCell}</td>`,
  ];

  for (let c = 3; c < PIN_56_COLUMNS.length; c++) {
    const colName = PIN_56_COLUMNS[c];
    const colClass = `col-pin-${c + 1}`;
    if (colName === 'main link') {
      cells.push(`<td class="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-xs truncate ${colClass}" data-col="main link"><a href="${mainLink}" target="_blank" class="hover:underline text-blue-500">${escapeHtml(mainLink)}</a></td>`);
    } else {
      let val = getPinValue(p, colName);
      if (val === undefined || val === null || val === '') val = p[colName];
      if (val === undefined || val === null) val = 'not-given';
      const strVal = String(val);
      let formattedHtml = escapeHtml(strVal);

      if (colName === 'Is AI Modified') {
        const isAi = p.isAiModified || p['Is AI Modified'] === 'YES' || strVal === 'YES';
        const aiType = p.aiType || (isAi ? 'AI Modified' : 'NO');
        const aiSource = p.aiSource || (isAi ? 'AI detected' : 'Organic human media');
        if (aiType === 'AI Generated') {
          formattedHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold text-[10px] border border-purple-200 shadow-sm" title="${escapeHtml(aiSource)}"><i class="ph-fill ph-sparkle text-purple-600"></i> AI Generated</span>`;
        } else if (aiType === 'AI Modified') {
          formattedHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px] border border-amber-200 shadow-sm" title="${escapeHtml(aiSource)}"><i class="ph-fill ph-magic-wand text-amber-600"></i> AI Modified</span>`;
        } else if (aiType === 'AI Disclosed' || aiType === 'AI Annotated' || isAi) {
          formattedHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold text-[10px] border border-indigo-200 shadow-sm" title="${escapeHtml(aiSource)}"><i class="ph-bold ph-tag text-indigo-500"></i> AI Disclosed</span>`;
        } else {
          formattedHtml = `<span class="text-slate-400 text-[10px] font-medium">NO</span>`;
        }
      } else if (strVal === 'not-extracted') {
        formattedHtml = `<span class="text-slate-400 italic">not-extracted</span>`;
      } else if (strVal === 'Extracting...') {
        formattedHtml = `<span class="text-amber-600 font-semibold animate-pulse">Extracting...</span>`;
      } else if (strVal === 'not-given') {
        formattedHtml = `<span class="text-slate-300">not-given</span>`;
      } else if (strVal === 'YES') {
        formattedHtml = `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold text-[10px]">YES</span>`;
      } else if (strVal === 'NO') {
        formattedHtml = `<span class="text-slate-400 text-[10px]">NO</span>`;
      } else if (colName.includes('Link') || colName.includes('link')) {
        if (strVal.startsWith('http')) {
          formattedHtml = `<a href="${strVal}" target="_blank" class="hover:underline text-blue-500 truncate block max-w-xs">${escapeHtml(strVal)}</a>`;
        }
      } else if (colName.includes('Image')) {
        if (strVal.startsWith('http')) {
          formattedHtml = `<a href="${strVal}" target="_blank" class="block w-6 h-6 rounded-full overflow-hidden bg-slate-100 mx-auto"><img src="${strVal}" class="w-full h-full object-cover"></a>`;
        }
      }

      const alignCenter = ['Saves', 'Shares', 'Repins', 'Comments', 'Removes', 'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions', 'Is Repin', 'Is Promoted', 'Is Video', 'Is Story', 'Is Group Board', 'Is AI Modified', 'Pinner Followers', 'Creator Followers', 'Promoter Followers'].includes(colName);
      cells.push(`<td class="py-2.5 px-3 text-slate-700 ${alignCenter ? 'text-center font-mono' : ''} ${wrap} ${colClass}" data-col="${escapeHtml(colName)}">${formattedHtml}</td>`);
    }
  }

  return `<tr id="pin-row-${index}" oncontextmenu="openPinContextMenu(event, ${index})" class="hover:bg-slate-50 transition-colors cursor-default">${cells.join('')}</tr>`;
}

function sortPins(colName) {
  if (!state.pinsSort) {
    state.pinsSort = { field: 'Saves', asc: false };
  }

  if (state.pinsSort.field === colName) {
    state.pinsSort.asc = !state.pinsSort.asc;
  } else {
    state.pinsSort.field = colName;
    const numericCols = [
      '#', 'Saves', 'Shares', 'Repins', 'Comments', 'Removes',
      'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions',
      'Video Length', 'Pinner Followers', 'Creator Followers', 'Promoter Followers'
    ];
    state.pinsSort.asc = !numericCols.includes(colName);
  }

  const field = state.pinsSort.field;
  const isAsc = state.pinsSort.asc;

  state.pins.sort((a, b) => {
    let valA = getPinValue(a, field);
    let valB = getPinValue(b, field);

    if (valA === undefined || valA === null) valA = '';
    if (valB === undefined || valB === null) valB = '';

    if (typeof valA === 'number' && typeof valB === 'number') {
      return isAsc ? valA - valB : valB - valA;
    }

    const cleanA = String(valA).replace(/,/g, '').trim();
    const cleanB = String(valB).replace(/,/g, '').trim();
    const numA = parseFloat(cleanA);
    const numB = parseFloat(cleanB);

    if (!isNaN(numA) && !isNaN(numB) && !isNaN(cleanA) && !isNaN(cleanB)) {
      return isAsc ? numA - numB : numB - numA;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    return isAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });

  updatePinsSortIndicators();
  renderPins();
}

function updatePinsSortIndicators() {
  if (!state.pinsSort) return;
  const activeCol = state.pinsSort.field;
  const isAsc = state.pinsSort.asc;

  for (let i = 0; i <= 56; i++) {
    const el = document.getElementById(`sort-pin-${i}`);
    if (el) {
      el.textContent = '';
      el.className = '';
    }
  }

  let activeIndex = -1;
  if (activeCol === '#') {
    activeIndex = 0;
  } else {
    const idx = PIN_56_COLUMNS.indexOf(activeCol);
    if (idx !== -1) {
      activeIndex = idx + 1;
    }
  }

  if (activeIndex >= 0) {
    const el = document.getElementById(`sort-pin-${activeIndex}`);
    if (el) {
      el.textContent = isAsc ? ' ▲' : ' ▼';
      el.className = 'text-red-600 font-bold ml-0.5 text-[10px]';
    }
  }
}

function quickFilterPinsCol(event, colName) {
  if (event) event.stopPropagation();

  const isNumeric = [
    'Saves', 'Shares', 'Repins', 'Comments', 'Removes',
    'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions',
    'Video Length', 'Pinner Followers', 'Creator Followers', 'Promoter Followers'
  ].includes(colName);

  const promptMsg = isNumeric
    ? `Filter pins by ${colName}:\nEnter value or comparison (e.g. >= 10, > 50, < 5, = 0):`
    : `Filter pins by ${colName}:\nEnter search text:`;

  const input = prompt(promptMsg);
  if (input === null) return;
  const trimmed = input.trim();
  if (!trimmed) {
    state.filters.pins = (state.filters.pins || []).filter(r => r.column !== colName);
    renderPins();
    return;
  }

  state.filters.pins = (state.filters.pins || []).filter(r => r.column !== colName);

  if (isNumeric) {
    let op = 'gte';
    let val = trimmed;
    if (trimmed.startsWith('>=')) { op = 'gte'; val = trimmed.slice(2).trim(); }
    else if (trimmed.startsWith('<=')) { op = 'lte'; val = trimmed.slice(2).trim(); }
    else if (trimmed.startsWith('>')) { op = 'gt'; val = trimmed.slice(1).trim(); }
    else if (trimmed.startsWith('<')) { op = 'lt'; val = trimmed.slice(1).trim(); }
    else if (trimmed.startsWith('=')) { op = 'equals'; val = trimmed.slice(1).trim(); }
    else { op = 'gte'; }

    state.filters.pins.push({ column: colName, op, value: val });
  } else {
    state.filters.pins.push({ column: colName, op: 'contains', value: trimmed });
  }

  renderPins();
}

function openPinContextMenu(e, index) {
  e.preventDefault();
  contextPinIndex = index;

  const td = e.target.closest('td');
  if (td && td.dataset.col) {
    contextPinCol = td.dataset.col;
  } else {
    contextPinCol = 'Title';
  }

  const filtered = getFilteredData('pins', state.pins);
  const p = filtered[index] || state.pins[index];
  if (p && contextPinCol) {
    contextPinValue = String(getPinValue(p, contextPinCol) || '').trim();
  } else {
    contextPinValue = '';
  }

  const filterLabel = document.getElementById('pinContextFilterCellLabel');
  if (filterLabel) {
    if (contextPinValue && contextPinValue !== 'not-given' && contextPinValue !== 'not-extracted') {
      const truncated = contextPinValue.length > 20 ? contextPinValue.slice(0, 18) + '...' : contextPinValue;
      filterLabel.textContent = `Filter by ${contextPinCol}: "${truncated}"`;
    } else {
      filterLabel.textContent = 'Filter by Selected Value';
    }
  }

  const menu = document.getElementById('pinContextMenu');
  if (!menu) return;
  menu.classList.remove('hidden');

  let x = e.clientX;
  let y = e.clientY;
  const menuWidth = 280;
  const menuHeight = 380;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;
}

function closePinContextMenu() {
  const menu = document.getElementById('pinContextMenu');
  if (menu) menu.classList.add('hidden');
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('#pinContextMenu')) {
    closePinContextMenu();
  }
});

function pinFilterBySelectedCell() {
  closePinContextMenu();
  if (!contextPinCol || !contextPinValue || contextPinValue === 'not-given' || contextPinValue === 'not-extracted') {
    alert('Please right-click on a valid cell to filter by its value.');
    return;
  }

  state.filters.pins = (state.filters.pins || []).filter(r => r.column !== contextPinCol);

  const isNumeric = [
    'Saves', 'Shares', 'Repins', 'Comments', 'Removes',
    'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions',
    'Video Length', 'Pinner Followers', 'Creator Followers', 'Promoter Followers'
  ].includes(contextPinCol);

  state.filters.pins.push({
    column: contextPinCol,
    op: isNumeric ? 'equals' : 'contains',
    value: contextPinValue
  });

  renderPins();
}

function pinClearFilters() {
  closePinContextMenu();
  const input = document.getElementById('pinsFilterInput');
  if (input) input.value = '';
  state.filters.pins = [];
  renderPins();
}

function getContextPin() {
  const filtered = getFilteredData('pins', state.pins);
  return filtered[contextPinIndex] || state.pins[contextPinIndex] || null;
}

function pinContextSendToKeywords() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const title = (p.Title || p.title || '').trim();
  if (!title || title === 'Untitled' || title === 'not-extracted') {
    alert('Pin has no title to send to Keywords.');
    return;
  }
  sendToKeywords(title);
}

function pinContextSendToTrends() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const title = (p.Title || p.title || '').trim();
  if (!title || title === 'Untitled' || title === 'not-extracted') {
    alert('Pin has no title to send to Trends.');
    return;
  }
  sendToTrends(title);
}

function pinContextSendToAnnotations() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const title = (p.Title || p.title || '').trim();
  const annotations = (p.Annotations || p.annotations || '').trim();
  const query = (annotations && annotations !== 'not-given') ? annotations.split(',')[0].trim() : title;
  if (!query) {
    alert('Pin has no title or annotations to send.');
    return;
  }
  switchTab('annotations');
  switchAnnSubTab('search');
  const input = document.getElementById('annSearchPhrase');
  if (input) input.value = query;
  startAnnotationsSearch();
}

function pinContextSendToBoards() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const boardName = (p['Board Name'] || p.boardName || p.board?.name || '').trim();
  const query = (boardName && boardName !== 'not-given') ? boardName : (p.Title || p.title || '').trim();
  if (!query) {
    alert('Pin has no board name or title to search boards.');
    return;
  }
  sendToBoards(query);
}

function pinContextSendToPeople() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const username = (p['Pinner Username'] || p.pinnerUsername || p.pinner?.username || '').replace(/^@/, '').trim();
  const name = (p['Pinner Name'] || p.pinnerName || '').trim();
  const query = (username && username !== 'not-given') ? username : ((name && name !== 'not-given') ? name : (p.Title || p.title || '').trim());
  if (!query) {
    alert('Pin has no pinner username or name to search people.');
    return;
  }
  sendToPeople(query);
}

function pinCopyLink() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const link = p['main link'] || p.pinUrl || (p['Pin ID'] ? `https://www.pinterest.com/pin/${p['Pin ID']}/` : '');
  if (link && link !== '#') {
    navigator.clipboard.writeText(link);
    alert('Pin link copied to clipboard!');
  }
}

function pinCopyId() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const id = p['Pin ID'] || p.id || '';
  if (id) {
    navigator.clipboard.writeText(id);
    alert('Pin ID copied to clipboard!');
  }
}

function pinCopyRowTSV() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const vals = PIN_56_COLUMNS.map(col => String(getPinValue(p, col) ?? '').replace(/[\t\r\n]+/g, ' '));
  navigator.clipboard.writeText(vals.join('\t'));
  alert('Pin row data (TSV) copied to clipboard!');
}

function pinOpenInPinterest() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const link = p['main link'] || p.pinUrl || (p['Pin ID'] ? `https://www.pinterest.com/pin/${p['Pin ID']}/` : '');
  if (link && link !== '#') {
    window.open(link, '_blank');
  }
}

function pinDeleteRow() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const id = p['Pin ID'] || p.id;
  const idx = state.pins.findIndex(item => (item['Pin ID'] || item.id) === id);
  if (idx !== -1) {
    state.pins.splice(idx, 1);
    renderPins();
  }
}

function updatePinsImgSize(val) {
  state.pinsImgSize = parseInt(val, 10) || 25;
  const label = document.getElementById('pinsImgSizeLabel');
  if (label) label.textContent = `${state.pinsImgSize} px`;
  renderPins();
}

function togglePinsWrapText(checked) {
  state.pinsWrapText = !!checked;
  renderPins();
}

function togglePinsFileMenu() {
  const menu = document.getElementById('pinsFileMenu');
  if (menu) menu.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const container = document.getElementById('pinsFileMenuContainer');
  const menu = document.getElementById('pinsFileMenu');
  if (container && menu && !container.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

function clearPinsGrid() {
  if (confirm('Clear all pins from table?')) {
    state.pins = [];
    renderPins();
    const countEl = document.getElementById('pinsTotalItemsDisplay');
    if (countEl) countEl.textContent = 'Total Items: 0';
  }
}

function exportPinsCSV() {
  const filtered = getFilteredData('pins', state.pins);
  exportPins56ToCSV(`pins_${Date.now()}.csv`, filtered);
}

function exportPinsHTML() {
  const filtered = getFilteredData('pins', state.pins);
  if (!filtered || filtered.length === 0) {
    alert('No pins to export.');
    return;
  }
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pins Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f4f4f4; }
    img { max-height: 50px; }
  </style></head><body>
  <h2>Pinterest Pins Report (${filtered.length} pins)</h2>
  <table><thead><tr><th>#</th>`;
  for (const col of PIN_56_COLUMNS) {
    html += `<th>${escapeHtml(col)}</th>`;
  }
  html += `</tr></thead><tbody>`;
  filtered.forEach((p, idx) => {
    html += `<tr><td>${idx + 1}</td>`;
    for (const col of PIN_56_COLUMNS) {
      const val = getPinValue(p, col) || (p[col] !== undefined ? p[col] : 'not-given');
      const safeStr = escapeHtml(String(val));
      if (col === 'Image' && String(val).startsWith('http')) {
        html += `<td><img src="${escapeQuotes(String(val))}"></td>`;
      } else if (String(val).startsWith('http')) {
        html += `<td><a href="${escapeQuotes(String(val))}" target="_blank">${safeStr}</a></td>`;
      } else {
        html += `<td>${safeStr}</td>`;
      }
    }
    html += `</tr>`;
  });
  html += `</tbody></table></body></html>`;
  downloadFile(`pins_report_${Date.now()}.html`, html, 'text/html;charset=utf-8;');
}

function savePinsProject() {
  if (!state.pins || state.pins.length === 0) {
    alert('No pins to save.');
    return;
  }
  const project = {
    exportedAt: new Date().toISOString(),
    totalPins: state.pins.length,
    pins: state.pins,
  };
  downloadFile(`pins_project_${Date.now()}.json`, JSON.stringify(project, null, 2), 'application/json');
}

function updateBrowseScrapeLinksCount() {
  const text = document.getElementById('browseScrapeLinksInput')?.value || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const countEl = document.getElementById('browseScrapeLinksCount');
  if (countEl) countEl.textContent = `Total: ${lines.length}`;
}

function clearBrowseScrapeLinks() {
  const textarea = document.getElementById('browseScrapeLinksInput');
  if (textarea) textarea.value = '';
  updateBrowseScrapeLinksCount();
}

async function pasteBrowseScrapeLinks() {
  try {
    const text = await navigator.clipboard.readText();
    const textarea = document.getElementById('browseScrapeLinksInput');
    if (textarea) {
      textarea.value = text;
      updateBrowseScrapeLinksCount();
    }
  } catch (err) {
    alert('Clipboard access denied or unsupported by browser. Please paste manually into the text area.');
  }
}


function openAnalyzeUserPinsModal(username = '', pinCount = 0) {
  const input = document.getElementById('analyzeUserTargetInput');
  if (input) input.value = username ? (username.startsWith('@') ? username : `@${username}`) : '';
  const bannerCount = document.getElementById('analyzePinsFoundCount');
  if (bannerCount) bannerCount.textContent = Number(pinCount || 0).toLocaleString();
  document.getElementById('analyzePinsModal')?.classList.remove('hidden');
}

function closeAnalyzePinsModal() {
  document.getElementById('analyzePinsModal')?.classList.add('hidden');
}

async function executeAnalyzeUserPins() {
  const rawTarget = document.getElementById('analyzeUserTargetInput')?.value.trim();
  const countVal = document.getElementById('analyzeUserPinsCount')?.value || '50';
  const targetCount = countVal === 'all' ? 'all' : (parseInt(countVal, 10) || 50);
  const username = rawTarget.replace(/^@/, '').trim();

  if (!username) {
    alert('Please enter a username or profile URL.');
    return;
  }

  const btn = document.getElementById('runAnalyzeUserPinsBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> Loading...`;

  try {
    const res = await fetch(`/api/user-pins?username=${encodeURIComponent(username)}&count=${targetCount}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const fetchedPins = data.pins || [];
    if (fetchedPins.length === 0) {
      alert(`No pins found for @${username}`);
      return;
    }

    const pinLinks = fetchedPins.map((p) => p.pinUrl || (p.id ? `https://www.pinterest.com/pin/${p.id}/` : ''));
    closeAnalyzePinsModal();

    switchTab('pins');
    switchPinsSubTab('browse-scrape');

    const textarea = document.getElementById('browseScrapeLinksInput');
    if (textarea) {
      textarea.value = pinLinks.join('\n');
      updateBrowseScrapeLinksCount();
    }

    startBrowseScrape(fetchedPins);
  } catch (err) {
    alert(`Failed to analyze user pins: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Quick analyze from row click or single username
async function analyzeUserPins(username) {
  openAnalyzeUserPinsModal(username);
}

// Batch analyze pins for multiple selected accounts (AnalyzeSelectedUserPinsMIClick)
async function analyzeSelectedUsersPins() {
  const selUsers = Array.from(state.selected.users);
  let targetUsers = selUsers;

  if (targetUsers.length === 0) {
    // If none checked, offer to analyze all currently filtered accounts or prompt
    const filtered = getFilteredData('users', state.users);
    if (filtered.length > 0) {
      if (confirm(`No accounts checked. Would you like to analyze pins for the top ${Math.min(5, filtered.length)} accounts in view?`)) {
        targetUsers = filtered.slice(0, 5).map((u) => u.username);
      } else {
        return;
      }
    } else {
      alert('Please select at least one account from the table first.');
      return;
    }
  }

  const countPerUser = prompt(`Enter max pins to extract per account for ${targetUsers.length} accounts:`, '50');
  if (!countPerUser) return;

  switchTab('pins');
  const tbody = document.getElementById('pinsTableBody');
  tbody.innerHTML = `<tr><td colspan="57" class="py-12 text-center text-slate-400"><i class="ph ph-spinner animate-spin text-xl inline-block mr-2"></i> Batch extracting pins for ${targetUsers.length} accounts (${escapeHtml(targetUsers.map(u => '@' + u).join(', '))})...</td></tr>`;

  try {
    const res = await fetch('/api/batch-user-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames: targetUsers,
        countPerUser: parseInt(countPerUser, 10) || 50,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const incomingPins = data.pins || [];
    // Append to existing pins
    const existingIds = new Set(state.pins.map((p) => p['Pin ID'] || p.id));
    let added = 0;
    for (const p of incomingPins) {
      const pid = p['Pin ID'] || p.id;
      if (pid && !existingIds.has(pid)) {
        state.pins.push(p);
        existingIds.add(pid);
        added++;
      }
    }

    state.currentPinsQuery = `${targetUsers.length} Accounts: ${targetUsers.slice(0, 3).map(u => '@' + u).join(', ')}${targetUsers.length > 3 ? '...' : ''}`;
    renderPins();
    alert(`Extracted ${incomingPins.length} pins across ${targetUsers.length} accounts! Added ${added} pins to the Pins table (Total in view: ${state.pins.length}).`);
  } catch (err) {
    alert(`Batch pin extraction failed: ${err.message}`);
    renderPins();
  }
}

// Analyze boards for a specific user (AnalyzeSelectedUserBoardsMIClick)
function openAnalyzeUserBoardsModal(username = '', boardCount = 0) {
  if (!username && contextUserUsername) username = contextUserUsername;
  if (!username && state.selected.users.size > 0) username = Array.from(state.selected.users)[0];

  const uObj = state.users.find(u => u.username === username);
  const count = boardCount || (uObj ? (uObj.boardCount || 0) : 0);

  const input = document.getElementById('analyzeUserBoardsTargetInput');
  if (input) input.value = username;
  const bannerCount = document.getElementById('analyzeBoardsFoundCount');
  if (bannerCount) bannerCount.textContent = Number(count).toLocaleString();

  document.getElementById('analyzeUserBoardsModal')?.classList.remove('hidden');
}

function closeAnalyzeUserBoardsModal() {
  document.getElementById('analyzeUserBoardsModal')?.classList.add('hidden');
}

async function executeAnalyzeUserBoards() {
  const username = document.getElementById('analyzeUserBoardsTargetInput')?.value.trim();
  const countVal = document.getElementById('analyzeUserBoardsCount')?.value || '50';
  closeAnalyzeUserBoardsModal();

  if (!username) {
    alert('Please select or specify a user to extract boards from.');
    return;
  }

  await analyzeUserBoards(username, countVal);
}

// Analyze boards for a specific user (AnalyzeSelectedUserBoardsMIClick)
async function analyzeUserBoards(username, count = '50') {
  switchTab('boards');
  const tbody = document.getElementById('boardsTableBody');
  tbody.innerHTML = `<tr><td colspan="19" class="py-12 text-center text-slate-500 font-medium"><i class="ph ph-spinner animate-spin text-xl inline-block mr-2 text-red-600"></i> Fetching boards for @${escapeHtml(username)}...</td></tr>`;

  try {
    const res = await fetch(`/api/user-boards?username=${encodeURIComponent(username)}&count=${encodeURIComponent(count)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.boards = data.boards || [];
    state.selected.boards.clear();
    const input = document.getElementById('boardsInput');
    if (input) input.value = `@${data.username}`;
    renderBoards();
  } catch (err) {
    alert(`Failed to fetch boards for @${username}: ${err.message}`);
    renderBoards();
  }
}

// Batch analyze boards for multiple selected users
async function analyzeSelectedUsersBoards() {
  const selUsers = Array.from(state.selected.users);
  if (selUsers.length === 0) {
    alert('Please select at least one account from the table first.');
    return;
  }

  switchTab('boards');
  const tbody = document.getElementById('boardsTableBody');
  tbody.innerHTML = `<tr><td colspan="19" class="py-12 text-center text-slate-500 font-medium"><i class="ph ph-spinner animate-spin text-xl inline-block mr-2 text-red-600"></i> Fetching boards for ${selUsers.length} accounts...</td></tr>`;

  let aggregatedBoards = [];
  const seenBoardIds = new Set();

  for (const u of selUsers) {
    try {
      const res = await fetch(`/api/user-boards?username=${encodeURIComponent(u)}&count=50`);
      if (res.ok) {
        const data = await res.json();
        for (const b of data.boards || []) {
          if (!seenBoardIds.has(b.id)) {
            seenBoardIds.add(b.id);
            aggregatedBoards.push(b);
          }
        }
      }
    } catch (e) {
      console.warn(`Failed boards for ${u}:`, e);
    }
  }

  state.boards = aggregatedBoards;
  state.selected.boards.clear();
  renderBoards();
  alert(`Extracted ${aggregatedBoards.length} boards across ${selUsers.length} accounts!`);
}

// ----------------------------------------------------------------------
// USER CONTEXT MENU HANDLERS (Delphi UserGrid Parity)
// ----------------------------------------------------------------------
let contextUserUsername = '';

function openUserContextMenu(e, username) {
  e.preventDefault();
  contextUserUsername = username;

  const menu = document.getElementById('userContextMenu');
  if (!menu) return;

  menu.classList.remove('hidden');

  const menuWidth = 240;
  const menuHeight = 330;
  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;
}

function closeUserContextMenu() {
  document.getElementById('userContextMenu')?.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#userContextMenu')) {
    closeUserContextMenu();
  }
});

function userContextAction(action) {
  closeUserContextMenu();
  const username = contextUserUsername;
  if (!username) return;

  const u = state.users.find((user) => user.username === username);
  if (action === 'analyze-pins') {
    openAnalyzeUserPinsModal(username, u?.pinCount || 0);
  } else if (action === 'analyze-boards') {
    openAnalyzeUserBoardsModal(username, u?.boardCount || 0);
  }
}

function userSelectAll() {
  closeUserContextMenu();
  state.users.forEach((u) => state.selected.users.add(u.username));
  renderUsers();
}

function userUnselectAll() {
  closeUserContextMenu();
  state.selected.users.clear();
  renderUsers();
}

function userInvertSelection() {
  closeUserContextMenu();
  state.users.forEach((u) => {
    if (state.selected.users.has(u.username)) {
      state.selected.users.delete(u.username);
    } else {
      state.selected.users.add(u.username);
    }
  });
  renderUsers();
}

function userClearFilters() {
  closeUserContextMenu();
  state.filters.users = [];
  const input = document.getElementById('usersFilterInput');
  if (input) input.value = '';
  renderUsers();
}

function userCopySelectedRows() {
  closeUserContextMenu();
  const sel = state.selected.users;
  const items = state.users.filter((u) => sel.has(u.username));
  if (items.length === 0) {
    alert('No selected accounts to copy.');
    return;
  }
  const text = items.map((u) => [u.id, u.username, u.name, u.followers, u.following, u.boardCount, u.pinCount, u.videoPinCount, u.storePinCount, u.interestCount, u.profileViews, u.profileReach, u.groupBoardCount, u.lastPin, u.location, u.website, u.domainVerified ? 'YES' : 'NO', u.merchantVerified ? 'YES' : 'NO', u.about, u.url].join('\t')).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${items.length} selected row(s) copied to clipboard!`);
}

function userCopyAllRows() {
  closeUserContextMenu();
  if (state.users.length === 0) {
    alert('No rows to copy.');
    return;
  }
  const text = state.users.map((u) => [u.id, u.username, u.name, u.followers, u.following, u.boardCount, u.pinCount, u.videoPinCount, u.storePinCount, u.interestCount, u.profileViews, u.profileReach, u.groupBoardCount, u.lastPin, u.location, u.website, u.domainVerified ? 'YES' : 'NO', u.merchantVerified ? 'YES' : 'NO', u.about, u.url].join('\t')).join('\n');
  navigator.clipboard.writeText(text);
  alert(`${state.users.length} row(s) copied to clipboard!`);
}

function userCopyUsername() {
  closeUserContextMenu();
  if (!contextUserUsername) return;
  navigator.clipboard.writeText(contextUserUsername);
  alert(`Username "@${contextUserUsername}" copied to clipboard!`);
}

function userCopyUserId() {
  closeUserContextMenu();
  const u = state.users.find((user) => user.username === contextUserUsername);
  if (!u || !u.id) {
    alert('No User ID found for this account.');
    return;
  }
  navigator.clipboard.writeText(u.id);
  alert(`User ID "${u.id}" copied to clipboard!`);
}

function userCopyUserLink() {
  closeUserContextMenu();
  const u = state.users.find((user) => user.username === contextUserUsername);
  const link = u?.url || `https://www.pinterest.com/${contextUserUsername}/`;
  navigator.clipboard.writeText(link);
  alert(`User Link copied to clipboard!`);
}

function userSearchWeb(engine) {
  closeUserContextMenu();
  if (!contextUserUsername) return;
  const enc = encodeURIComponent(contextUserUsername);
  if (engine === 'pinterest') window.open(`https://www.pinterest.com/${enc}/`, '_blank');
  else if (engine === 'google') window.open(`https://www.google.com/search?q=${enc}+pinterest`, '_blank');
  else if (engine === 'bing') window.open(`https://www.bing.com/search?q=${enc}+pinterest`, '_blank');
}

function userPreviewBrowser() {
  closeUserContextMenu();
  if (!contextUserUsername) return;
  window.open(`https://www.pinterest.com/${contextUserUsername}/`, '_blank');
}

function userAutoFitWidths() {
  closeUserContextMenu();
  const table = document.getElementById('table-users');
  if (table) table.style.tableLayout = 'auto';
}

function userResetWidths() {
  closeUserContextMenu();
  const table = document.getElementById('table-users');
  if (table) table.style.tableLayout = '';
}

function userDeleteSelected() {
  closeUserContextMenu();
  const sel = state.selected.users;
  if (sel.size === 0) {
    alert('No rows selected to delete.');
    return;
  }
  state.users = state.users.filter((u) => !sel.has(u.username));
  sel.clear();
  renderUsers();
}

async function analyzeBoardPins(boardId, boardName) {
  openAnalyzeBoardPinsModal(boardId, boardName);
}

function extractPinAnnotations(pinId) {
  switchTab('annotations');
  switchAnnSubTab('pins');
  const input = document.getElementById('annPinsLinksInput');
  if (input) input.value = pinId;
  extractAnnotationsFromPinsLinks();
}

async function fetchKeywordsEverywhere(targetTable, overrideTerms = null) {
  if (!state.keApiKey) {
    alert('Please enter your Keywords Everywhere API key in Settings first.');
    openSettingsModal();
    return;
  }

  let list = [];
  if (Array.isArray(overrideTerms) && overrideTerms.length > 0) list = overrideTerms;
  else if (targetTable === 'keywords') list = state.keywords.map((k) => k.keyword);
  else if (targetTable === 'annotations') list = state.annotations.map((a) => a.annotation);
  else if (targetTable === 'trends') list = state.trends.map((t) => t.term);

  if (list.length === 0) {
    alert('No keywords available to enrich.');
    return;
  }

  try {
    const res = await fetch('/api/keywords-everywhere', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: state.keApiKey,
        keywords: list.slice(0, 100),
        country: state.keCountry,
        currency: state.keCurrency,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const metrics = data.metrics || {};
    if (targetTable === 'keywords') {
      state.keywords.forEach((k) => {
        const m = metrics[k.keyword.toLowerCase()];
        if (m) {
          k.vol = m.vol;
          k.cpc = m.cpc;
          k.competition = m.competition;
        }
      });
      renderKeywords();
    } else if (targetTable === 'annotations') {
      state.annotations.forEach((a) => {
        const m = metrics[a.annotation.toLowerCase()];
        if (m) {
          a.vol = m.vol;
          a.cpc = m.cpc;
          a.competition = m.competition;
          a.searchVolume = m.vol || a.searchVolume;
        }
      });
      renderAnnotations();
    } else if (targetTable === 'trends') {
      state.trends.forEach((t) => {
        const m = metrics[t.term.toLowerCase()];
        if (m) {
          t.vol = m.vol;
          t.cpc = m.cpc;
          t.competition = m.competition;
        }
      });
      renderTrends();
    }
    alert('Volume and CPC metrics enriched successfully!');
  } catch (err) {
    alert(`Keywords Everywhere error: ${err.message}`);
  }
}

// CSV Exporters
function exportKeywordsCSV() {
  const data = getFilteredData('keywords', state.keywords);
  if (!data || data.length === 0) return alert('No keywords to export.');

  const headers = ['Rank', 'Word Count', 'Character Count', 'Seed', 'Keyword', 'Search Volume', 'Cost Per Click', 'Competition'];
  const rows = data.map((k, idx) => [
    k.rank !== undefined ? k.rank : idx + 1,
    k.wordCount || 0,
    k.charCount || 0,
    `"${(k.seed || '').replace(/"/g, '""')}"`,
    `"${(k.keyword || '').replace(/"/g, '""')}"`,
    k.vol !== undefined && k.vol !== '' ? k.vol : '',
    k.cpc !== undefined && k.cpc !== '' ? k.cpc : '',
    k.competition !== undefined && k.competition !== '' ? k.competition : ''
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\n');
  downloadFile(`keywords_${Date.now()}.csv`, csvContent, 'text/csv;charset=utf-8;');
}

// Duplicate exportPinsCSV removed; canonical exportPinsCSV is defined above using filtered state.pins.

function formatPinCsvValue(col, val, pin) {
  if (val === undefined || val === null) {
    if (col === 'main link') {
      const id = pin['Pin ID'] || pin.id;
      return id ? `https://www.pinterest.com/pin/${id}/` : 'not-given';
    }
    if (col.startsWith('Is ')) return 'NO';
    if (['Saves', 'Shares', 'Repins', 'Comments', 'Removes', 'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions'].includes(col)) {
      return '0';
    }
    return 'not-given';
  }
  let str = String(val).trim();
  if (!str) {
    if (col.startsWith('Is ')) return 'NO';
    if (['Saves', 'Shares', 'Repins', 'Comments', 'Removes', 'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions'].includes(col)) {
      return '0';
    }
    return 'not-given';
  }
  if (col === 'Category' && str !== 'not-given') {
    return str.split(/[_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  if (col === 'Hashtags' && str !== 'not-given') {
    return str.replace(/,\s+/g, ',');
  }
  if (['Saves', 'Shares', 'Repins', 'Comments', 'Removes', 'Good Idea', 'Love', 'Thanks', 'Wow', 'Laughing', 'Total Reactions', 'Pinner Followers', 'Creator Followers', 'Promoter Followers'].includes(col)) {
    if (str !== 'not-given' && !isNaN(str.replace(/,/g, ''))) {
      const num = parseInt(str.replace(/,/g, ''), 10);
      return num >= 1000 ? num.toLocaleString('en-US') : String(num);
    }
  }
  return str;
}

function exportPins56ToCSV(filename, data) {
  if (!data || data.length === 0) {
    alert('No data to export.');
    return;
  }
  const headers = PIN_56_COLUMNS;
  const rows = data.map((item) =>
    headers
      .map((col) => {
        let raw = item[col];
        if (raw === undefined) {
          if (col === 'Pin ID') raw = item.id;
          else if (col === 'Title') raw = item.title;
          else if (col === 'Description') raw = item.description;
          else if (col === 'Image') raw = item.image || item.thumbnail;
          else if (col === 'Saves') raw = item.saves;
          else if (col === 'Comments') raw = item.comments;
          else if (col === 'Total Reactions') raw = item.reactionCount ?? item.totalReactions;
          else if (col === 'Domain') raw = item.domain;
          else if (col === 'Link') raw = item.link;
          else if (col === 'Created') raw = item.created;
          else if (col === 'main link') raw = item.pinUrl || item.url || (item.id ? `https://www.pinterest.com/pin/${item.id}/` : '');
          else if (col === 'Board Name') raw = item.boardName || item.board?.name;
          else if (col === 'Board Link') raw = item.boardUrl || item.board?.url;
          else if (col === 'Pinner Username') raw = item.pinnerUsername || item.pinner?.username;
          else if (col === 'Pinner Followers') raw = item.pinner?.followers;
        }
        const formatted = formatPinCsvValue(col, raw, item);
        if (formatted.includes(',') || formatted.includes('"') || formatted.includes('\n') || isNaN(formatted)) {
          return `"${formatted.replace(/"/g, '""')}"`;
        }
        return formatted;
      })
      .join(',')
  );
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  downloadFile(filename, csvContent, 'text/csv;charset=utf-8;');
}

// Duplicate exportBoardsCSV removed; canonical 17-column exportBoardsCSV is defined above.

function exportUsersCSV() {
  exportDataToCSV(`users_${Date.now()}.csv`, state.users);
}

function exportAnnotationsCSV() {
  if (!state.annotations || state.annotations.length === 0) {
    alert('No data to export.');
    return;
  }

  const headers = [
    'Annotation',
    'Word Count',
    'Character Count',
    'Search Volume',
    'Follower Count',
    'Last Updated',
    'Annotation Id',
    'Category Tree',
    'Category Tree Links',
    'Annotation Link',
  ];

  const formatCell = (val) => {
    const str = String(val !== undefined && val !== null ? val : '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = state.annotations.map((a) => {
    const sv = a.searchVolume !== undefined && a.searchVolume !== null ? (a.searchVolume >= 1000 ? Number(a.searchVolume).toLocaleString('en-US') : a.searchVolume) : '0';
    const fc = a.followerCount !== undefined && a.followerCount !== null ? (a.followerCount >= 1000 ? Number(a.followerCount).toLocaleString('en-US') : a.followerCount) : '0';
    return [
      formatCell(a.annotation || ''),
      formatCell(a.wordCount ?? 0),
      formatCell(a.charCount ?? 0),
      formatCell(sv),
      formatCell(fc),
      formatCell(a.lastUpdated || ''),
      formatCell(a.annotationId || ''),
      formatCell(a.categoryTree || a.annotation || ''),
      formatCell(a.categoryTreeLinks || a.annotationLink || ''),
      formatCell(a.annotationLink || ''),
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  downloadFile(`annotations_${Date.now()}.csv`, csvContent, 'text/csv;charset=utf-8;');
}

function exportTrendsCSV() {
  if (!state.trends || state.trends.length === 0) {
    alert('No trend data to export.');
    return;
  }
  const headers = [
    'Keyword',
    'Seed',
    'Country',
    'Word Count',
    'Character Count',
    '1 Month Average',
    '3 Month Average',
    '6 Month Average',
    'Total Average',
    'Trend Slope',
    'Trending Spike',
  ];

  const formatCell = (val) => `"${String(val !== undefined && val !== null ? val : '').replace(/"/g, '""')}"`;

  const rows = state.trends.map((t) => [
    formatCell(t.term || ''),
    formatCell(t.seed || ''),
    formatCell(t.country || ''),
    t.wordCount || 0,
    t.charCount || 0,
    t.avg1m || 0,
    t.avg3m || 0,
    t.avg6m || 0,
    t.avgTot || 0,
    formatCell(t.trendSlope || '0,00'),
    formatCell(t.trendingSpike || '0,00'),
  ].join(','));

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  downloadFile(`trends_${Date.now()}.csv`, csvContent, 'text/csv;charset=utf-8;');
}

function exportDataToCSV(filename, data) {
  if (!data || data.length === 0) {
    alert('No data to export.');
    return;
  }
  const headers = Object.keys(data[0]).filter((k) => typeof data[0][k] !== 'object');
  const rows = data.map((item) =>
    headers
      .map((h) => {
        const val = item[h] !== undefined ? item[h] : '';
        return `"${val.toString().replace(/"/g, '""')}"`;
      })
      .join(',')
  );
  const csvContent = [headers.join(','), ...rows].join('\n');
  downloadFile(filename, csvContent, 'text/csv;charset=utf-8;');
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

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

function escapeHtml(text) {
  if (!text) return '';
  return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeQuotes(text) {
  if (!text) return '';
  return text.toString().replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------------
// 7. PIN POSITION TRACKER
// ----------------------------------------------------------------------
let currentPositionData = null;

async function checkPinPosition() {
  const pinIdInput = document.getElementById('posPinIdInput');
  const keywordInput = document.getElementById('posKeywordInput');
  const annotationInput = document.getElementById('posAnnotationInput');
  const countrySelect = document.getElementById('posCountrySelect');
  const maxDepthSelect = document.getElementById('posMaxDepthSelect');

  const rawPinId = (pinIdInput?.value || '').trim();
  const keyword = (keywordInput?.value || '').trim();
  const annotation = (annotationInput?.value || '').trim();
  const country = countrySelect?.value || 'US';
  const maxDepth = maxDepthSelect?.value || '100';

  if (!rawPinId) {
    alert('Please enter a Pin ID or paste a Pinterest Pin URL.');
    pinIdInput?.focus();
    return;
  }
  if (!keyword) {
    alert('Please enter a target keyword to check rankings for.');
    keywordInput?.focus();
    return;
  }

  const btn = document.getElementById('posCheckBtn');
  const btnText = document.getElementById('posCheckBtnText');
  const progressContainer = document.getElementById('posProgressContainer');
  const progressLabel = document.getElementById('posProgressLabel');
  const resultContainer = document.getElementById('posResultContainer');

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Checking...';
  if (progressContainer) progressContainer.classList.remove('hidden');
  if (progressLabel) progressLabel.textContent = `Searching for Pin in Top ${maxDepth} pins for "${keyword}" (${country})...`;

  try {
    const params = new URLSearchParams({
      pinId: rawPinId,
      keyword,
      annotation,
      country,
      maxDepth,
    });

    const res = await fetch(`/api/pin/position?${params.toString()}`);
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Server responded with status ${res.status}`);
    }

    const data = await res.json();
    currentPositionData = data;
    renderPositionResults(data);
  } catch (err) {
    alert(`Position check failed: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Check Position';
    if (progressContainer) progressContainer.classList.add('hidden');
  }
}

function renderPositionResults(data) {
  const resultContainer = document.getElementById('posResultContainer');
  if (!resultContainer) return;
  resultContainer.classList.remove('hidden');

  // Hero Banner elements
  const heroBanner = document.getElementById('posHeroBanner');
  const rankBadge = document.getElementById('posRankBadge');
  const rankNumber = document.getElementById('posRankNumber');
  const statusTitle = document.getElementById('posStatusTitle');
  const statusSubtitle = document.getElementById('posStatusSubtitle');
  const pageBadge = document.getElementById('posPageBadge');

  const metricQuery = document.getElementById('posMetricQuery');
  const metricScanned = document.getElementById('posMetricScanned');
  const posResultCountrySelect = document.getElementById('posResultCountrySelect');
  const posCountrySelect = document.getElementById('posCountrySelect');

  if (posResultCountrySelect && data.country) {
    posResultCountrySelect.value = data.country;
  }
  if (posCountrySelect && data.country) {
    posCountrySelect.value = data.country;
  }

  if (metricQuery) {
    const qText = data.fullQuery || data.keyword;
    const cleanSearchUrl = data.targetSearchUrl || `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(qText)}`;
    const domainText = data.domain || 'pinterest.com';
    metricQuery.innerHTML = `
      <div class="space-y-0.5">
        <a href="${cleanSearchUrl}" target="_blank" class="text-xs font-bold text-red-600 hover:text-red-800 hover:underline flex items-center gap-1.5" title="Open live Pinterest search: ${cleanSearchUrl}">
          <span>${escapeHtml(qText)}</span>
          <i class="ph-bold ph-arrow-square-out text-xs"></i>
        </a>
        <span class="text-[10px] text-slate-400 block truncate max-w-[200px]" title="${cleanSearchUrl}">
          ${domainText}/search/pins/?q=...
        </span>
      </div>
    `;
  }
  if (metricScanned) {
    metricScanned.textContent = `${data.totalScanned} pins (Organic: ${data.organicScanned || data.totalScanned}, Ads: ${data.promotedScanned || 0})`;
  }

  const metricGrid = document.getElementById('posMetricGrid');
  const metricMatch = document.getElementById('posMetricMatch');

  if (metricGrid) {
    if (data.found && data.gridPosition) {
      metricGrid.innerHTML = `<span>Slot #${data.gridPosition}</span> <span class="text-[10px] text-slate-500 font-normal">(Row ${data.gridRow || 1}, Col ${data.gridCol || 1})</span>`;
    } else {
      metricGrid.textContent = '--';
    }
  }

  if (metricMatch) {
    if (data.found) {
      let matchLabel = data.matchType || '100% Verified';
      if (data.matchedPinId && String(data.matchedPinId) !== String(data.pinId)) {
        matchLabel += ` (SERP #${data.matchedPinId})`;
      }
      metricMatch.innerHTML = `<span class="inline-flex items-center gap-1 text-emerald-700 font-bold"><i class="ph-bold ph-check-circle"></i> ${escapeHtml(matchLabel)}</span>`;
    } else {
      metricMatch.innerHTML = `<span class="text-slate-400">Not Found in Top ${data.totalScanned}</span>`;
    }
  }

  if (data.found && data.position) {
    if (heroBanner) {
      heroBanner.className = 'p-5 rounded-xl border border-emerald-200 bg-emerald-50/70 shadow-sm transition-all flex flex-wrap items-center justify-between gap-4';
    }
    if (rankBadge) {
      rankBadge.className = 'w-16 h-16 rounded-2xl flex flex-col items-center justify-center font-bold text-white shadow-md bg-emerald-600';
    }
    if (rankNumber) rankNumber.textContent = `#${data.position}`;
    if (statusTitle) statusTitle.textContent = `Pin Found at Organic Position #${data.position}!`;
    
    let sub = `Rank verified at Organic Position #${data.position} for "${data.fullQuery}" in ${data.countryLabel || data.country} (${data.locale}).`;
    if (data.gridPosition && data.gridPosition !== data.position) {
      sub += ` (Appears as Visual Slot #${data.gridPosition} due to ${data.promotedAboveTarget || 1} sponsored ad above it).`;
    }
    if (data.matchType) {
      sub += ` [Verified: ${data.matchType}]`;
    }
    if (data.matchedPinId && String(data.matchedPinId) !== String(data.pinId)) {
      sub += ` (Aggregated SERP Pin ID: #${data.matchedPinId})`;
    }
    if (statusSubtitle) statusSubtitle.textContent = sub;
    if (pageBadge) {
      pageBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200 text-emerald-800';
      pageBadge.textContent = `PAGE ${data.page || 1}`;
    }
  } else {
    if (heroBanner) {
      heroBanner.className = 'p-5 rounded-xl border border-amber-200 bg-amber-50/70 shadow-sm transition-all flex flex-wrap items-center justify-between gap-4';
    }
    if (rankBadge) {
      rankBadge.className = 'w-16 h-16 rounded-2xl flex flex-col items-center justify-center font-bold text-white shadow-md bg-amber-500';
    }
    if (rankNumber) rankNumber.textContent = 'N/A';
    if (statusTitle) statusTitle.textContent = `Pin Not Ranked in Top ${data.totalScanned}`;
    if (statusSubtitle) statusSubtitle.textContent = `The target Pin ID / Visual Signature was not detected within the first ${data.totalScanned} search results for "${data.fullQuery}" in ${data.countryLabel || data.country} (${data.locale}).`;
    if (pageBadge) {
      pageBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-800';
      pageBadge.textContent = 'UNRANKED';
    }
  }

  // Pin Details Preview
  const pin = data.pinDetails || {};
  const pinThumbnail = document.getElementById('posPinThumbnail');
  const pinTitle = document.getElementById('posPinTitle');
  const pinDescription = document.getElementById('posPinDescription');
  const pinAuthor = document.getElementById('posPinAuthor');
  const pinBoard = document.getElementById('posPinBoard');
  const pinDirectLink = document.getElementById('posPinDirectLink');

  if (pinThumbnail) {
    pinThumbnail.src = pin['Image'] || pin.image || 'https://assets.pinterest.com/images/default_avatar.png';
  }
  if (pinTitle) pinTitle.textContent = pin['Title'] || pin.title || `Pin ${data.pinId}`;
  if (pinDescription) pinDescription.textContent = pin['Description'] || pin.description || 'No description provided.';
  if (pinAuthor) pinAuthor.textContent = pin['Pinner'] || pin.pinnerUsername || 'Unknown';
  if (pinBoard) pinBoard.textContent = pin['Board'] || pin.boardName || 'General';
  if (pinDirectLink) pinDirectLink.href = `https://www.pinterest.com/pin/${data.pinId}/`;

  // Annotations
  const annotationsList = document.getElementById('posAnnotationsList');
  const annotationCount = document.getElementById('posAnnotationCount');
  if (annotationsList) {
    annotationsList.innerHTML = '';
    const tags = data.annotationsList || [];
    if (annotationCount) annotationCount.textContent = `${tags.length} tags`;

    if (tags.length === 0) {
      annotationsList.innerHTML = '<span class="text-xs text-slate-400 italic">No visual annotations indexed for this pin yet.</span>';
    } else {
      tags.forEach((tag) => {
        const isMatch = (data.fullQuery || '').toLowerCase().includes(tag.toLowerCase());
        const tagDomain = data.domain || 'www.pinterest.com';
        const searchUrl = `https://${tagDomain}/search/pins/?q=${encodeURIComponent(tag)}`;

        const tagEl = document.createElement('div');
        tagEl.className = isMatch
          ? 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs group'
          : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 hover:border-purple-300 shadow-2xs group';
        
        tagEl.innerHTML = `
          <span class="flex items-center gap-1 font-semibold">
            ${isMatch ? '<i class="ph-bold ph-check text-emerald-600"></i>' : '<i class="ph ph-tag text-purple-500"></i>'}
            <span>${escapeHtml(tag)}</span>
          </span>
          <span class="h-3 w-px bg-slate-300"></span>
          <a href="${searchUrl}" target="_blank" class="text-[10px] text-blue-600 hover:text-blue-900 font-bold hover:underline flex items-center gap-0.5" title="Open Pinterest search for this tag">
            <i class="ph-bold ph-arrow-square-out"></i> Search
          </a>
          <button type="button" onclick="trackAnnotationRank('${escapeQuotes(tag)}')" class="text-[10px] text-red-600 hover:text-red-800 font-bold hover:underline flex items-center gap-0.5" title="Test Rank for this Annotation">
            <i class="ph-bold ph-crosshair"></i> Track
          </button>
        `;
        annotationsList.appendChild(tagEl);
      });
    }
  }

  // Suggested Ideas & Topics for Target Keyword
  const ideasList = document.getElementById('posSuggestedIdeasList');
  const ideasCount = document.getElementById('posIdeasCount');
  if (ideasList) {
    ideasList.innerHTML = '';
    const ideas = data.suggestedIdeas || [];
    if (ideasCount) ideasCount.textContent = `${ideas.length} ideas`;

    if (ideas.length === 0) {
      ideasList.innerHTML = '<span class="text-xs text-slate-400 italic">No keyword branches returned for this seed.</span>';
    } else {
      ideas.forEach((item) => {
        const term = item.term;
        const searchUrl = item.searchUrl || `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}`;
        const ideaEl = document.createElement('div');
        ideaEl.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200 hover:border-amber-300 shadow-2xs group';
        ideaEl.innerHTML = `
          <span class="flex items-center gap-1 font-semibold">
            <i class="ph-bold ph-lightbulb text-amber-500"></i>
            <span>${escapeHtml(term)}</span>
          </span>
          <span class="h-3 w-px bg-amber-200"></span>
          <a href="${searchUrl}" target="_blank" class="text-[10px] text-blue-600 hover:text-blue-900 font-bold hover:underline flex items-center gap-0.5" title="Open Pinterest search for this idea">
            <i class="ph-bold ph-arrow-square-out"></i> Search
          </a>
          <button type="button" onclick="trackAnnotationRank('${escapeQuotes(term)}')" class="text-[10px] text-red-600 hover:text-red-800 font-bold hover:underline flex items-center gap-0.5" title="Test Rank for this Idea">
            <i class="ph-bold ph-crosshair"></i> Track
          </button>
        `;
        ideasList.appendChild(ideaEl);
      });
    }
  }

  // SERP Table
  renderSerpTable(data);

  const sessionLabel = document.getElementById('posSessionModeLabel');
  if (sessionLabel) {
    if (data.isCustomSession) {
      sessionLabel.innerHTML = '<i class="ph-bold ph-user-check text-purple-600"></i> Active Account Session (Personalized)';
      sessionLabel.title = 'Rankings evaluated using your connected Pinterest account cookies.';
    } else {
      sessionLabel.innerHTML = '<i class="ph-bold ph-shield-check text-emerald-600"></i> Neutral Incognito Baseline (Public SEO)';
      sessionLabel.title = 'Neutral Incognito scans public unbiased market SERP. Connect account cookies in Settings for personalized account rankings.';
    }
  }

  resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let posSerpViewMode = 'surrounding';

function togglePositionSerpView() {
  posSerpViewMode = posSerpViewMode === 'surrounding' ? 'all' : 'surrounding';
  const btnText = document.getElementById('posToggleSerpText');
  if (btnText) {
    btnText.textContent = posSerpViewMode === 'surrounding' ? 'Show All Scanned' : 'Show Surrounding Pins';
  }
  if (currentPositionData) {
    renderSerpTable(currentPositionData);
  }
}

function renderSerpTable(data) {
  const serpTbody = document.getElementById('posSerpTableBody');
  if (!serpTbody) return;
  serpTbody.innerHTML = '';

  const pinsToShow = (posSerpViewMode === 'all' && data.allScannedPins && data.allScannedPins.length > 0)
    ? data.allScannedPins
    : (data.surroundingPins || []);

  if (pinsToShow.length === 0) {
    serpTbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-400">No SERP results available.</td></tr>';
    return;
  }

  pinsToShow.forEach((item) => {
    const tr = document.createElement('tr');
    if (item.isTarget) {
      tr.className = 'bg-amber-100/90 font-bold border-y-2 border-amber-400 text-slate-900';
    } else if (item.isPromoted) {
      tr.className = 'bg-slate-50/70 hover:bg-slate-100 transition-colors text-slate-600';
    } else {
      tr.className = 'hover:bg-slate-50 transition-colors text-slate-700';
    }

    const rankDisplay = item.isTarget
      ? `<span class="px-2 py-0.5 rounded bg-emerald-600 text-white font-black text-xs shadow-xs">#${item.position}</span>`
      : item.isPromoted
        ? `<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-bold text-[10px]" title="Visual Feed Slot #${item.gridPosition}">AD #${item.gridPosition}</span>`
        : `<span class="font-semibold text-slate-600 text-xs">#${item.position}</span>`;

    tr.innerHTML = `
      <td class="py-2.5 px-3 text-center">
        ${rankDisplay}
      </td>
      <td class="py-2.5 px-3 text-center">
        ${
          item.image
            ? `<img src="${escapeHtml(item.image)}" alt="Pin" class="w-8 h-10 object-cover rounded shadow-2xs mx-auto border border-slate-200">`
            : `<div class="w-8 h-10 bg-slate-200 rounded flex items-center justify-center text-[9px] text-slate-400 mx-auto">N/A</div>`
        }
      </td>
      <td class="py-2.5 px-3">
        <div class="space-y-0.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${item.isTarget ? '<span class="px-1.5 py-0.2 rounded bg-amber-500 text-white text-[9px] font-black shrink-0 uppercase tracking-wider">YOUR TARGET PIN</span>' : ''}
            ${item.isPromoted ? '<span class="px-1.5 py-0.2 rounded bg-slate-300 text-slate-700 text-[9px] font-bold shrink-0 uppercase">SPONSORED AD</span>' : ''}
            <span class="truncate max-w-xs font-medium" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
          </div>
          ${item.matchReason ? `<div class="text-[10px] text-emerald-700 font-semibold flex items-center gap-1"><i class="ph-bold ph-check"></i> ${escapeHtml(item.matchReason)}</div>` : ''}
        </div>
      </td>
      <td class="py-2.5 px-3 text-slate-600 text-[11px] truncate max-w-[120px]" title="${escapeHtml(item.pinner)}">
        ${escapeHtml(item.pinner)}
      </td>
      <td class="py-2.5 px-3 text-center font-mono text-[11px] text-slate-500">
        <a href="https://www.pinterest.com/pin/${escapeHtml(item.id)}/" target="_blank" class="hover:text-red-600 hover:underline">
          ${escapeHtml(item.id)}
        </a>
      </td>
    `;
    serpTbody.appendChild(tr);
  });
}

function clearPositionTracker() {
  const pinIdInput = document.getElementById('posPinIdInput');
  const keywordInput = document.getElementById('posKeywordInput');
  const annotationInput = document.getElementById('posAnnotationInput');
  const resultContainer = document.getElementById('posResultContainer');

  if (pinIdInput) pinIdInput.value = '';
  if (keywordInput) keywordInput.value = '';
  if (annotationInput) annotationInput.value = '';
  if (resultContainer) resultContainer.classList.add('hidden');
  currentPositionData = null;
  posSerpViewMode = 'surrounding';
  const btnText = document.getElementById('posToggleSerpText');
  if (btnText) btnText.textContent = 'Show All Scanned';
}

function exportPositionCSV() {
  if (!currentPositionData) {
    alert('No position data to export.');
    return;
  }
  const pinsToExport = (posSerpViewMode === 'all' && currentPositionData.allScannedPins && currentPositionData.allScannedPins.length > 0)
    ? currentPositionData.allScannedPins
    : (currentPositionData.surroundingPins || []);

  if (pinsToExport.length === 0) {
    alert('No position data to export.');
    return;
  }
  const rows = [
    ['Organic Rank', 'Visual Feed Slot', 'Pin ID', 'Pin Title', 'Pinner', 'Is Target Pin', 'Is Sponsored Ad', 'Match Verification', 'Target Query', 'Country', 'Locale'],
    ...pinsToExport.map((p) => [
      p.position,
      p.gridPosition || p.position,
      `"${p.id}"`,
      `"${(p.title || '').replace(/"/g, '""')}"`,
      `"${(p.pinner || '').replace(/"/g, '""')}"`,
      p.isTarget ? 'YES' : 'NO',
      p.isPromoted ? 'YES' : 'NO',
      `"${(p.matchReason || '').replace(/"/g, '""')}"`,
      `"${(currentPositionData.fullQuery || '').replace(/"/g, '""')}"`,
      currentPositionData.country || 'US',
      currentPositionData.locale || 'en-US',
    ]),
  ];
  const csvContent = rows.map((r) => r.join(',')).join('\n');
  downloadFile(`pin_position_${currentPositionData.pinId}_${Date.now()}.csv`, csvContent, 'text/csv;charset=utf-8;');
}

function pinContextSendToPosition() {
  closePinContextMenu();
  const p = getContextPin();
  if (!p) return;
  const pinId = p['Pin ID'] || p.id || p.pinId || '';
  const title = (p['Title'] || p.title || '').trim();

  switchTab('position');
  const pinIdInput = document.getElementById('posPinIdInput');
  const keywordInput = document.getElementById('posKeywordInput');

  if (pinIdInput && pinId) pinIdInput.value = cleanPinId(pinId);
  if (keywordInput && title && title !== 'Untitled' && title !== 'not-extracted') {
    keywordInput.value = title;
  }
}

function trackAnnotationRank(annotationTerm) {
  const keywordInput = document.getElementById('posKeywordInput');
  const annotationInput = document.getElementById('posAnnotationInput');
  if (keywordInput) keywordInput.value = annotationTerm;
  if (annotationInput) annotationInput.value = '';
  checkPinPosition();
}

function onPositionResultCountryChange(countryVal) {
  const posCountrySelect = document.getElementById('posCountrySelect');
  if (posCountrySelect) {
    posCountrySelect.value = countryVal;
  }
  checkPinPosition();
}

function onPositionCountryChange(countryVal) {
  const posResultCountrySelect = document.getElementById('posResultCountrySelect');
  if (posResultCountrySelect) {
    posResultCountrySelect.value = countryVal;
  }
  if (currentPositionData) {
    checkPinPosition();
  }
}

// ======================================================================
// 8. WINNER PIN FINDER (Keyword Pin Search + Live Feed Filter)
// ======================================================================

function parseWinnerPinSaves(p) {
  if (!p) return 0;
  if (typeof p.saves === 'number' && Number.isFinite(p.saves)) return p.saves;
  const raw = p.Saves ?? p.saves ?? p.Repins ?? 0;
  const num = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function parseWinnerPinCreatedTs(p) {
  if (!p) return null;
  if (typeof p.createdTimestamp === 'number' && Number.isFinite(p.createdTimestamp)) {
    return p.createdTimestamp;
  }
  const raw = p.createdAt || p.Created || p.created || '';
  if (!raw || raw === 'not-given') return null;
  let ts = Date.parse(raw);
  if (!Number.isFinite(ts)) {
    ts = Date.parse(`${raw} UTC`);
  }
  return Number.isFinite(ts) ? ts : null;
}

function getWinnerPinLink(p) {
  if (!p) return '';
  const raw = p.link || p.Link || '';
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'not-given') return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

function bookmarkWinnerPin(pinId) {
  const pin = state.winnerPins.find((p) => String(p.id || p['Pin ID'] || '') === String(pinId));
  if (!pin) return;
  const id = String(pin.id || pin['Pin ID'] || pinId);
  const title = pin.title || pin.Title || 'Untitled Pin';
  const url = pin.pinUrl || pin.url || pin['main link'] || `https://www.pinterest.com/pin/${id}/`;
  addBookmark('pin', { id, title, url });
}

function formatWinnerAgeLabel(ageDays) {
  if (ageDays === null || !Number.isFinite(ageDays)) return 'Unknown date';
  if (ageDays < 1) {
    const hrs = Math.max(1, Math.round(ageDays * 24));
    return `${hrs}h ago`;
  }
  if (ageDays < 60) return `${Math.round(ageDays)}d ago`;
  if (ageDays < 365) return `${Math.round(ageDays / 30)}mo ago`;
  return `${(ageDays / 365).toFixed(1)}y ago`;
}

function isWinnerPinVideo(pin) {
  if (!pin) return false;
  return Boolean(
    pin.isVideo ||
    pin['Is Video'] === 'YES' ||
    pin.videoUrl ||
    (pin['Video link'] && pin['Video link'] !== 'not-given')
  );
}

function matchesWinnerPinType(pin) {
  const pinType = state.winnerPinType || document.getElementById('winnerSearchInSelect')?.value || 'pins';
  const isVideo = isWinnerPinVideo(pin);
  if (pinType === 'exclude-videos') return !isVideo;
  if (pinType === 'videos') return isVideo;
  return true;
}

function evaluateWinnerPin(pin) {
  const f = state.winnerFilter;
  const saves = parseWinnerPinSaves(pin);
  const createdTs = parseWinnerPinCreatedTs(pin);
  const ageDays = createdTs !== null ? Math.max(0, (Date.now() - createdTs) / 86400000) : null;
  const link = getWinnerPinLink(pin);
  const hasLink = Boolean(link);
  const isVideo = isWinnerPinVideo(pin);
  const savesPerDay = ageDays !== null ? saves / Math.max(1, ageDays) : null;
  const reactions = Number(pin.totalReactions ?? pin.reactionCount ?? pin['Total Reactions'] ?? 0) || 0;
  const comments = Number(pin.comments ?? pin.Comments ?? 0) || 0;

  const reasons = [];
  if (f.enabled) {
    if (f.minSaves > 0 && saves < f.minSaves) {
      reasons.push(`Saves < ${f.minSaves.toLocaleString()}`);
    }
    if (f.maxDays > 0) {
      if (ageDays === null) {
        reasons.push('No date');
      } else if (ageDays > f.maxDays) {
        reasons.push(`Older than ${f.maxDays}d`);
      }
    }
    if (f.hasLink === 'yes' && !hasLink) {
      reasons.push('No link');
    } else if (f.hasLink === 'no' && hasLink) {
      reasons.push('Has link');
    }
  }

  return {
    pin,
    matches: reasons.length === 0,
    reasons,
    saves,
    createdTs,
    ageDays,
    savesPerDay,
    link,
    hasLink,
    isVideo,
    reactions,
    comments,
  };
}

function applyWinnerFilterToControls() {
  const f = state.winnerFilter;
  const enableEl = document.getElementById('winnerEnableFilter');
  const minSavesEl = document.getElementById('winnerMinSavesInput');
  const maxDaysEl = document.getElementById('winnerMaxDaysInput');

  if (enableEl) enableEl.checked = Boolean(f.enabled);
  if (minSavesEl) minSavesEl.value = String(f.minSaves ?? 0);
  if (maxDaysEl) maxDaysEl.value = String(f.maxDays ?? 0);

  document.querySelectorAll('input[name="winnerHasLink"]').forEach((radio) => {
    radio.checked = radio.value === f.hasLink;
  });
  document.querySelectorAll('input[name="winnerFilterAction"]').forEach((radio) => {
    radio.checked = radio.value === f.action;
  });

  syncWinnerFilterUI();
}

function readWinnerFilterFromControls() {
  const enableEl = document.getElementById('winnerEnableFilter');
  const minSavesEl = document.getElementById('winnerMinSavesInput');
  const maxDaysEl = document.getElementById('winnerMaxDaysInput');
  const hasLinkEl = document.querySelector('input[name="winnerHasLink"]:checked');
  const actionEl = document.querySelector('input[name="winnerFilterAction"]:checked');
  const pinTypeEl = document.getElementById('winnerSearchInSelect');

  const rawMinSaves = parseInt(minSavesEl?.value ?? '0', 10);
  const rawMaxDays = parseInt(maxDaysEl?.value ?? '0', 10);

  if (pinTypeEl) {
    state.winnerPinType = pinTypeEl.value || 'pins';
  }

  state.winnerFilter = {
    enabled: enableEl ? enableEl.checked : true,
    minSaves: Number.isFinite(rawMinSaves) && rawMinSaves > 0 ? rawMinSaves : 0,
    maxDays: Number.isFinite(rawMaxDays) && rawMaxDays > 0 ? rawMaxDays : 0,
    hasLink: hasLinkEl ? hasLinkEl.value : 'yes',
    action: actionEl ? actionEl.value : 'hide',
  };
}

function onWinnerPinTypeChange() {
  const pinTypeEl = document.getElementById('winnerSearchInSelect');
  state.winnerPinType = pinTypeEl ? (pinTypeEl.value || 'pins') : 'pins';
  state.winnerRenderLimit = 200;
  syncWinnerFilterUI();
  renderWinnerPins();
}

function onWinnerCountryChange() {
  const countryEl = document.getElementById('winnerCountrySelect');
  state.winnerCountry = countryEl ? (countryEl.value || 'US') : 'US';
  state.winnerNextBookmark = '';
  syncWinnerFilterUI();
}

function syncWinnerFilterUI() {
  const f = state.winnerFilter;
  const pinType = state.winnerPinType || document.getElementById('winnerSearchInSelect')?.value || 'pins';
  const country = state.winnerCountry || document.getElementById('winnerCountrySelect')?.value || 'US';
  const minSavesDisplay = document.getElementById('winnerMinSavesDisplay');
  const maxDaysDisplay = document.getElementById('winnerMaxDaysDisplay');
  const hasLinkDisplay = document.getElementById('winnerHasLinkDisplay');
  const fieldsWrap = document.getElementById('winnerFilterFieldsWrap');

  if (minSavesDisplay) {
    minSavesDisplay.textContent = f.minSaves > 0 ? `≥ ${f.minSaves.toLocaleString()}` : 'Any';
  }
  if (maxDaysDisplay) {
    if (f.maxDays === 0) maxDaysDisplay.textContent = 'All';
    else if (f.maxDays === 1) maxDaysDisplay.textContent = '< 1 day';
    else maxDaysDisplay.textContent = `< ${f.maxDays} days`;
  }
  if (hasLinkDisplay) {
    if (f.hasLink === 'yes') hasLinkDisplay.textContent = 'Yes (Has Link)';
    else if (f.hasLink === 'no') hasLinkDisplay.textContent = 'No (No Link)';
    else hasLinkDisplay.textContent = 'All';
  }
  if (fieldsWrap) {
    fieldsWrap.classList.toggle('opacity-50', !f.enabled);
  }

  document.querySelectorAll('.winner-saves-chip').forEach((btn) => {
    const val = parseInt(btn.getAttribute('data-winner-saves') || '0', 10);
    const active = val === f.minSaves;
    btn.className = active
      ? 'winner-saves-chip px-2.5 py-1.5 rounded-lg border border-pink-400 bg-pink-50 text-xs font-bold text-pink-700 transition-colors'
      : 'winner-saves-chip px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 transition-colors';
  });

  document.querySelectorAll('.winner-days-chip').forEach((btn) => {
    const val = parseInt(btn.getAttribute('data-winner-days') || '0', 10);
    const active = val === f.maxDays;
    btn.className = active
      ? 'winner-days-chip px-2.5 py-1.5 rounded-lg border border-pink-400 bg-pink-50 text-xs font-bold text-pink-700 transition-colors'
      : 'winner-days-chip px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-800 transition-colors';
  });

  const badgesEl = document.getElementById('winnerActiveFilterBadges');
  if (badgesEl) {
    const parts = [];
    parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold"><i class="ph ph-globe"></i> Country: ${escapeHtml(country)}</span>`);
    if (pinType === 'exclude-videos') {
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-semibold"><i class="ph ph-video-camera-slash"></i> Pin Type: Exclude Video</span>`);
    } else if (pinType === 'videos') {
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 border border-purple-200 font-semibold"><i class="ph ph-video-camera"></i> Pin Type: Videos Only</span>`);
    }

    if (!f.enabled) {
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 font-semibold"><i class="ph ph-funnel-x"></i> Filter Disabled (Showing All Scanned Pins)</span>`);
    } else {
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-pink-50 text-pink-700 border border-pink-100 font-semibold"><i class="ph-bold ph-funnel"></i> Saves: ${f.minSaves > 0 ? `≥ ${f.minSaves.toLocaleString()}` : 'Any'}</span>`);
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-pink-50 text-pink-700 border border-pink-100 font-semibold"><i class="ph ph-clock"></i> Created: ${f.maxDays > 0 ? `< ${f.maxDays}d` : 'All'}</span>`);
      const linkLabel = f.hasLink === 'yes' ? 'Has Link' : (f.hasLink === 'no' ? 'No Link' : 'All');
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-semibold"><i class="ph ph-link"></i> Link: ${linkLabel}</span>`);
      parts.push(`<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold">${f.action === 'hide' ? 'Hide non-matching' : 'Dim non-matching'}</span>`);
    }
    badgesEl.innerHTML = parts.join('');
  }
}

function onWinnerFilterChange() {
  readWinnerFilterFromControls();
  state.winnerRenderLimit = 200;
  syncWinnerFilterUI();
  renderWinnerPins();
}

function showMoreWinnerRendered() {
  state.winnerRenderLimit = (state.winnerRenderLimit || 200) + 200;
  renderWinnerPins();
}

function setWinnerMinSaves(val) {
  const input = document.getElementById('winnerMinSavesInput');
  if (input) input.value = String(val);
  onWinnerFilterChange();
}

function setWinnerMaxDays(val) {
  const input = document.getElementById('winnerMaxDaysInput');
  if (input) input.value = String(val);
  onWinnerFilterChange();
}

function setWinnerFilterAction(action) {
  document.querySelectorAll('input[name="winnerFilterAction"]').forEach((radio) => {
    radio.checked = radio.value === action;
  });
  onWinnerFilterChange();
}

function resetWinnerFilter() {
  state.winnerFilter = {
    enabled: true,
    minSaves: 15,
    maxDays: 28,
    hasLink: 'yes',
    action: 'hide',
  };
  applyWinnerFilterToControls();
  renderWinnerPins();
}

function setWinnerViewMode(mode) {
  state.winnerViewMode = mode === 'table' ? 'table' : 'grid';
  const gridBtn = document.getElementById('winnerViewGridBtn');
  const tableBtn = document.getElementById('winnerViewTableBtn');
  const gridWrap = document.getElementById('winnerPinsGrid');
  const tableWrap = document.getElementById('winnerPinsTableWrap');

  if (state.winnerViewMode === 'grid') {
    if (gridBtn) gridBtn.className = 'px-2.5 py-1 rounded-md text-xs font-semibold bg-white text-slate-900 shadow-xs flex items-center gap-1 transition-all';
    if (tableBtn) tableBtn.className = 'px-2.5 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-all';
    gridWrap?.classList.remove('hidden');
    tableWrap?.classList.add('hidden');
  } else {
    if (tableBtn) tableBtn.className = 'px-2.5 py-1 rounded-md text-xs font-semibold bg-white text-slate-900 shadow-xs flex items-center gap-1 transition-all';
    if (gridBtn) gridBtn.className = 'px-2.5 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-all';
    tableWrap?.classList.remove('hidden');
    gridWrap?.classList.add('hidden');
  }
  renderWinnerPins();
}

async function startWinnerPinsSearch(loadMore = false) {
  if (state.winnerRunning) return;

  const phrase = (document.getElementById('winnerKeywordInput')?.value || '').trim();
  if (!phrase) {
    alert('Please enter a keyword to search for Winner Pins.');
    return;
  }

  readWinnerFilterFromControls();
  syncWinnerFilterUI();

  const scanCount = parseInt(document.getElementById('winnerScanCountSelect')?.value || '100', 10) || 100;
  const searchIn = document.getElementById('winnerSearchInSelect')?.value || 'pins';
  const country = document.getElementById('winnerCountrySelect')?.value || 'US';
  const bookmarkToUse = loadMore && state.winnerQuery === phrase && state.winnerPinType === searchIn && state.winnerCountry === country ? state.winnerNextBookmark : '';

  state.winnerQuery = phrase;
  state.winnerPinType = searchIn;
  state.winnerCountry = country;
  state.winnerRunning = true;
  state.winnerCancelled = false;
  state.winnerAbortController = new AbortController();

  if (!loadMore || !bookmarkToUse) {
    state.winnerPins = [];
    state.winnerNextBookmark = '';
    state.winnerHasMore = false;
    state.winnerRenderLimit = 200;
    state.winnerCurrentSubquery = '';
  }

  const existingIds = new Set(state.winnerPins.map((p) => String(p.id || p['Pin ID'] || '')));

  const searchBtn = document.getElementById('winnerSearchBtn');
  const stopBtn = document.getElementById('winnerStopBtn');
  const loadMoreBtn = document.getElementById('winnerLoadMoreBtn');
  const progressBar = document.getElementById('winnerProgressBar');
  const progressText = document.getElementById('winnerProgressText');

  if (searchBtn) {
    searchBtn.disabled = true;
    searchBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }
  if (stopBtn) {
    stopBtn.disabled = false;
    stopBtn.classList.remove('hidden');
    stopBtn.classList.add('inline-flex');
  }
  if (loadMoreBtn) loadMoreBtn.disabled = true;
  if (progressBar) progressBar.style.width = '2%';
  if (progressText) {
    progressText.textContent = loadMore
      ? `Scanning next batch of pins for "${phrase}" (${country})...`
      : `Harvesting pins for "${phrase}" [${country}] (target: ${scanCount.toLocaleString()})...`;
  }

  renderWinnerPins();

  let lastRenderTs = 0;

  try {
    const params = new URLSearchParams({
      query: phrase,
      count: String(scanCount),
      searchIn,
      country,
      stream: 'true',
    });
    if (bookmarkToUse) params.set('bookmark', bookmarkToUse);

    const res = await fetch(`/api/winner-pins?${params.toString()}`, {
      signal: state.winnerAbortController.signal,
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const rawEv of events) {
        if (!rawEv.trim() || !rawEv.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(rawEv.slice(6));
          if (ev.type === 'start') {
            if (progressText) progressText.textContent = `Searching Pinterest (${ev.country || country}) for "${ev.query}" (target: ${Number(ev.targetCount || scanCount).toLocaleString()} pins)...`;
          } else if (ev.type === 'harvested') {
            state.winnerNextBookmark = ev.nextBookmark || '';
            state.winnerHasMore = Boolean(ev.hasMore);
            if (state.winnerPins.length === 0 && progressText) {
              progressText.textContent = `Scrolling "${phrase}" [${country}] — analyzing saves, dates & links...`;
            }
          } else if (ev.type === 'expanding') {
            if (progressText) {
              progressText.textContent = `Exact search reached Pinterest cap (${state.winnerPins.length.toLocaleString()} pins). Auto-expanding into related "${phrase}" [${country}] searches...`;
            }
          } else if (ev.type === 'subquery') {
            state.winnerCurrentSubquery = ev.subquery || '';
            const pct = ev.total > 0 ? Math.min(100, Math.round((ev.completed / ev.total) * 100)) : 0;
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) {
              progressText.textContent = `Expanding "${ev.subquery}" (${ev.subqueryIndex}/${ev.totalSubqueries}) • ${state.winnerPins.length.toLocaleString()}/${Number(ev.total).toLocaleString()} (${pct}%)`;
            }
          } else if (ev.type === 'pin' && ev.pin) {
            const pid = String(ev.pin.id || ev.pin['Pin ID'] || '');
            if (!pid || !existingIds.has(pid)) {
              if (pid) existingIds.add(pid);
              state.winnerPins.push(ev.pin);
            }
            const pct = ev.total > 0 ? Math.min(100, Math.round((ev.completed / ev.total) * 100)) : 0;
            if (progressBar) progressBar.style.width = `${pct}%`;

            const now = Date.now();
            const throttleMs = state.winnerPins.length > 1000 ? 600 : 220;
            if (now - lastRenderTs > throttleMs || ev.completed === ev.total) {
              lastRenderTs = now;
              const matchedCount = state.winnerPins.filter((p) => matchesWinnerPinType(p) && evaluateWinnerPin(p).matches).length;
              const subNote = ev.subquery ? ` ["${ev.subquery}"]` : '';
              if (progressText) {
                progressText.textContent = `Scanning ${state.winnerPins.length.toLocaleString()}/${Number(ev.total).toLocaleString()} (${pct}%) [${country}]${subNote} — ${matchedCount.toLocaleString()} Winner Pin${matchedCount === 1 ? '' : 's'} matched`;
              }
              renderWinnerPins();
            }
          } else if (ev.type === 'done') {
            state.winnerNextBookmark = ev.nextBookmark || state.winnerNextBookmark;
            state.winnerHasMore = Boolean(ev.hasMore);
            const matchedCount = state.winnerPins.filter((p) => matchesWinnerPinType(p) && evaluateWinnerPin(p).matches).length;
            const expandedSuffix = ev.expandedQueriesUsed ? ` across ${ev.expandedQueriesUsed + 1} searches` : '';
            if (progressBar) progressBar.style.width = '100%';
            if (progressText) {
              progressText.textContent = `Completed: ${matchedCount.toLocaleString()} Winner Pin${matchedCount === 1 ? '' : 's'} found out of ${state.winnerPins.length.toLocaleString()} scanned for "${phrase}" [${ev.country || country}]${expandedSuffix}`;
            }
          }
        } catch (err) {
          console.warn('Error parsing winner-pins SSE event:', err);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || state.winnerCancelled) {
      const matchedCount = state.winnerPins.filter((p) => matchesWinnerPinType(p) && evaluateWinnerPin(p).matches).length;
      if (progressText) {
        progressText.textContent = `Stopped — ${matchedCount} Winner Pin${matchedCount === 1 ? '' : 's'} found from ${state.winnerPins.length} scanned`;
      }
    } else {
      alert(`Winner Pin search failed: ${err.message}`);
      if (progressText) progressText.textContent = `Error: ${err.message}`;
    }
  } finally {
    state.winnerRunning = false;
    state.winnerAbortController = null;
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (stopBtn) {
      stopBtn.disabled = true;
      stopBtn.classList.add('hidden');
      stopBtn.classList.remove('inline-flex');
    }
    if (loadMoreBtn) loadMoreBtn.disabled = false;
    renderWinnerPins();
  }
}

function stopWinnerPinsSearch() {
  state.winnerCancelled = true;
  if (state.winnerAbortController) {
    state.winnerAbortController.abort();
  }
}

function clearWinnerPins() {
  if (state.winnerRunning) stopWinnerPinsSearch();
  state.winnerPins = [];
  state.winnerNextBookmark = '';
  state.winnerHasMore = false;
  const progressBar = document.getElementById('winnerProgressBar');
  const progressText = document.getElementById('winnerProgressText');
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = 'Enter a keyword and click Find Winner Pins';
  renderWinnerPins();
}

function sendWinnerPinToPosition(pinId) {
  if (!pinId) return;
  switchTab('position');
  const pinIdInput = document.getElementById('posPinIdInput');
  const keywordInput = document.getElementById('posKeywordInput');
  const posCountrySelect = document.getElementById('posCountrySelect');
  if (pinIdInput) pinIdInput.value = cleanPinId(pinId);
  if (keywordInput && state.winnerQuery) keywordInput.value = state.winnerQuery;
  if (posCountrySelect && state.winnerCountry) {
    posCountrySelect.value = state.winnerCountry;
  }
}

function getProcessedWinnerPins() {
  const f = state.winnerFilter;
  const quickSearch = (document.getElementById('winnerQuickFilterInput')?.value || '').toLowerCase().trim();
  const sortMode = document.getElementById('winnerSortSelect')?.value || 'saves_desc';

  const typeFilteredPins = state.winnerPins.filter((p) => matchesWinnerPinType(p));
  const evaluated = typeFilteredPins.map((p) => evaluateWinnerPin(p));
  const totalScanned = evaluated.length;
  const matchedAll = evaluated.filter((item) => item.matches);

  let visible = evaluated;
  if (f.enabled && f.action === 'hide') {
    visible = matchedAll;
  }

  if (quickSearch) {
    visible = visible.filter((item) => {
      const p = item.pin;
      const hay = `${p.title || p.Title || ''} ${p.domain || p.Domain || ''} ${p.pinnerUsername || p['Pinner Username'] || ''} ${p.boardName || p['Board Name'] || ''} ${item.link}`.toLowerCase();
      return hay.includes(quickSearch);
    });
  }

  visible = [...visible].sort((a, b) => {
    // In dim mode, surface matching winners ahead of dimmed non-matching pins
    if (f.enabled && f.action === 'dim' && a.matches !== b.matches) {
      return a.matches ? -1 : 1;
    }
    if (sortMode === 'velocity_desc') {
      return (b.savesPerDay ?? -1) - (a.savesPerDay ?? -1);
    }
    if (sortMode === 'newest') {
      return (b.createdTs ?? 0) - (a.createdTs ?? 0);
    }
    if (sortMode === 'reactions_desc') {
      return b.reactions - a.reactions;
    }
    if (sortMode === 'comments_desc') {
      return b.comments - a.comments;
    }
    return b.saves - a.saves;
  });

  return { rawTotalScanned: state.winnerPins.length, totalScanned, matchedAll, visible };
}

function renderWinnerPins() {
  const grid = document.getElementById('winnerPinsGrid');
  const tbody = document.getElementById('winnerPinsTableBody');
  const loadMoreWrap = document.getElementById('winnerLoadMoreWrap');
  if (!grid || !tbody) return;

  const f = state.winnerFilter;
  const pinType = state.winnerPinType || document.getElementById('winnerSearchInSelect')?.value || 'pins';
  const pinTypeLabel = pinType === 'exclude-videos' ? 'Exclude Video' : (pinType === 'videos' ? 'Videos Only' : 'All Pins');
  const { rawTotalScanned, totalScanned, matchedAll, visible } = getProcessedWinnerPins();

  // Update KPI stats
  const statMatched = document.getElementById('winnerStatMatched');
  const statScanned = document.getElementById('winnerStatScanned');
  const statRate = document.getElementById('winnerStatRate');
  const statAvgSaves = document.getElementById('winnerStatAvgSaves');
  const showingText = document.getElementById('winnerShowingCountText');

  if (statMatched) statMatched.textContent = matchedAll.length.toLocaleString();
  if (statScanned) statScanned.textContent = totalScanned.toLocaleString();
  if (statRate) {
    const rate = totalScanned > 0 ? Math.round((matchedAll.length / totalScanned) * 100) : 0;
    statRate.textContent = `${rate}%`;
  }
  if (statAvgSaves) {
    const avg = matchedAll.length > 0
      ? Math.round(matchedAll.reduce((acc, i) => acc + i.saves, 0) / matchedAll.length)
      : 0;
    statAvgSaves.textContent = avg.toLocaleString();
  }
  if (showingText) {
    if (f.enabled && f.action === 'dim') {
      showingText.textContent = `Showing ${visible.length} pins (${matchedAll.length} winners, ${Math.max(0, totalScanned - matchedAll.length)} dimmed)`;
    } else {
      showingText.textContent = `Showing ${visible.length} of ${totalScanned} scanned pins`;
    }
  }
  if (!state.winnerRunning && rawTotalScanned > 0) {
    const progressText = document.getElementById('winnerProgressText');
    if (progressText && (progressText.textContent.startsWith('Completed:') || progressText.textContent.startsWith('Stopped'))) {
      const countryCode = state.winnerCountry || document.getElementById('winnerCountrySelect')?.value || 'US';
      const statusPrefix = state.winnerCancelled ? 'Stopped' : 'Completed';
      progressText.textContent = `${statusPrefix}: ${matchedAll.length.toLocaleString()} Winner Pin${matchedAll.length === 1 ? '' : 's'} found out of ${totalScanned.toLocaleString()} scanned for "${state.winnerQuery}" [${countryCode}]`;
    }
  }

  // Toggle Load More button
  if (loadMoreWrap) {
    if (!state.winnerRunning && state.winnerHasMore && rawTotalScanned > 0) {
      loadMoreWrap.classList.remove('hidden');
    } else {
      loadMoreWrap.classList.add('hidden');
    }
  }

  // Empty state: nothing scanned yet
  if (rawTotalScanned === 0) {
    const emptyMsg = state.winnerRunning
      ? `<div class="col-span-full bg-white rounded-2xl border border-slate-200 py-16 px-6 text-center space-y-3">
           <i class="ph ph-spinner animate-spin text-3xl text-pink-600"></i>
           <h3 class="text-sm font-bold text-slate-800">Scanning Pinterest for "${escapeHtml(state.winnerQuery)}"...</h3>
           <p class="text-xs text-slate-500">Checking saves, creation dates, and external links in real time.</p>
         </div>`
      : `<div class="col-span-full bg-white rounded-2xl border border-dashed border-slate-300 py-16 px-6 text-center space-y-2.5">
           <div class="w-14 h-14 mx-auto rounded-2xl bg-pink-50 text-pink-600 flex items-center justify-center">
             <i class="ph-bold ph-trophy text-3xl"></i>
           </div>
           <h3 class="text-base font-bold text-slate-800">Discover Winner Pins for Any Keyword</h3>
           <p class="text-xs text-slate-500 max-w-md mx-auto">Enter a keyword on the left and configure your Feed Filter (Minimum Saves, Created Within, Pin with Link) to isolate high-performing Pinterest pins.</p>
         </div>`;
    grid.innerHTML = emptyMsg;
    tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-slate-400">${state.winnerRunning ? 'Scanning pins...' : 'No pins scanned yet.'}</td></tr>`;
    return;
  }

  // Empty state: pins scanned, but 0 match the strict filter or Pin Type
  if (visible.length === 0) {
    const noMatchHtml = `
      <div class="col-span-full bg-white rounded-2xl border border-slate-200 py-12 px-6 text-center space-y-3">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
          <i class="ph-bold ph-funnel-x text-2xl"></i>
        </div>
        <h3 class="text-sm font-bold text-slate-900">0 of ${rawTotalScanned} scanned pins matched your current filters</h3>
        <p class="text-xs text-slate-500 max-w-lg mx-auto">
          Pin Type: ${escapeHtml(pinTypeLabel)} • Saves ${f.minSaves > 0 ? `≥ ${f.minSaves.toLocaleString()}` : 'Any'} • Created ${f.maxDays > 0 ? `< ${f.maxDays} days` : 'All'} • Pin with Link: ${f.hasLink === 'yes' ? 'Yes' : f.hasLink === 'no' ? 'No' : 'All'}.
          Adjust Pin Type or Feed Filter on the left to inspect results immediately, or run a fresh scan.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button type="button" onclick="setWinnerFilterAction('dim')" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors">
            Switch to Dim Non-Matching
          </button>
          <button type="button" onclick="setWinnerMaxDays(90)" class="px-3 py-1.5 rounded-lg bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-semibold transition-colors">
            Expand to 90 Days
          </button>
          <button type="button" onclick="setWinnerMaxDays(0)" class="px-3 py-1.5 rounded-lg bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-semibold transition-colors">
            Created Within: All
          </button>
          ${state.winnerHasMore && !state.winnerRunning ? `<button type="button" onclick="startWinnerPinsSearch(true)" class="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors">Scan More Pins</button>` : ''}
        </div>
      </div>`;
    grid.innerHTML = noMatchHtml;
    tbody.innerHTML = `<tr><td colspan="9" class="py-10 text-center text-slate-500">0 of ${totalScanned} scanned pins matched your current filter. Adjust the Feed Filter on the left.</td></tr>`;
    return;
  }

  const renderCap = state.winnerRenderLimit || 200;
  const displayed = visible.slice(0, renderCap);
  const remainingHidden = Math.max(0, visible.length - displayed.length);

  // Render Cards Grid View
  if (state.winnerViewMode === 'grid') {
    grid.innerHTML = displayed
      .map((item) => {
        const p = item.pin;
        const imgUrl = getPinImageUrl(p, false);
        const pinUrl = p.pinUrl || p.url || p['main link'] || `https://www.pinterest.com/pin/${p.id || p['Pin ID']}/`;
        const pinId = String(p.id || p['Pin ID'] || '');
        const title = p.title || p.Title || 'Untitled Pin';
        const domain = p.domain && p.domain !== 'not-given' ? p.domain : '';
        const ageLabel = formatWinnerAgeLabel(item.ageDays);
        const createdText = p.created && p.created !== 'not-given' ? p.created : (p.Created && p.Created !== 'not-given' ? p.Created : '—');
        const pinnerUser = p.pinnerUsername || (p['Pinner Username'] && p['Pinner Username'] !== 'not-given' ? p['Pinner Username'] : '');
        const isDimmed = f.enabled && !item.matches && f.action === 'dim';
        const velocityText = item.savesPerDay !== null ? `${item.savesPerDay >= 10 ? Math.round(item.savesPerDay) : item.savesPerDay.toFixed(1)}/day` : '—';

        return `
        <article class="bg-white rounded-2xl border ${item.matches && f.enabled ? 'border-pink-200/80 shadow-xs hover:shadow-md' : 'border-slate-200'} overflow-hidden flex flex-col transition-all ${isDimmed ? 'opacity-35 grayscale-[45%] hover:opacity-75' : ''}">
          <!-- Pin Visual Preview -->
          <div class="relative bg-slate-100 aspect-[3/4] overflow-hidden group">
            ${
              imgUrl
                ? `<a href="${escapeHtml(pinUrl)}" target="_blank" rel="noopener noreferrer" class="block w-full h-full">
                     <img src="${escapeHtml(imgUrl)}" alt="${escapeQuotes(title)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300">
                   </a>`
                : `<div class="w-full h-full flex items-center justify-center text-slate-400 text-xs">No image</div>`
            }

            <!-- Top Left: Saves / Winner Badge -->
            <div class="absolute top-2.5 left-2.5 flex items-center gap-1">
              ${
                item.matches
                  ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pink-600/95 text-white text-[11px] font-bold shadow-sm backdrop-blur-xs">
                       <i class="ph-fill ph-trophy text-amber-300"></i> ${item.saves.toLocaleString()} saves
                     </span>`
                  : `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900/80 text-white text-[10px] font-semibold backdrop-blur-xs">
                       ${item.saves.toLocaleString()} saves
                     </span>`
              }
            </div>

            <!-- Top Right: Age & Media Badges -->
            <div class="absolute top-2.5 right-2.5 flex flex-col items-end gap-1">
              <span class="px-2 py-0.5 rounded-md bg-slate-900/75 text-white text-[10px] font-semibold backdrop-blur-xs" title="Created: ${escapeQuotes(createdText)}">
                ${escapeHtml(ageLabel)}
              </span>
              ${item.isVideo ? `<span class="px-1.5 py-0.5 rounded-md bg-red-600/90 text-white text-[10px] font-bold"><i class="ph-fill ph-play"></i> Video</span>` : ''}
            </div>

            <!-- Bottom Left: Destination Link Pill -->
            ${
              item.hasLink
                ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" title="${escapeQuotes(item.link)}" class="absolute bottom-2.5 left-2.5 right-2.5 max-w-max truncate inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/95 hover:bg-white text-slate-800 text-[11px] font-semibold shadow-sm backdrop-blur-xs transition-colors">
                     <i class="ph-bold ph-arrow-up-right text-blue-600 shrink-0"></i>
                     <span class="truncate max-w-[180px]">${escapeHtml(domain || item.link)}</span>
                   </a>`
                : `<span class="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/70 text-slate-200 text-[10px] font-medium">
                     No external link
                   </span>`
            }
          </div>

          <!-- Card Body -->
          <div class="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
            <div class="space-y-1.5">
              ${
                isDimmed && item.reasons.length > 0
                  ? `<div class="flex flex-wrap gap-1">
                       ${item.reasons.map((r) => `<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">${escapeHtml(r)}</span>`).join('')}
                     </div>`
                  : ''
              }
              <a href="${escapeHtml(pinUrl)}" target="_blank" rel="noopener noreferrer" class="block text-xs font-bold text-slate-900 hover:text-red-600 line-clamp-2 leading-snug" title="${escapeQuotes(title)}">
                ${escapeHtml(title)}
              </a>
              <div class="text-[11px] text-slate-500 flex items-center justify-between gap-2">
                <span class="truncate">${pinnerUser ? `@${escapeHtml(pinnerUser)}` : 'Pinterest Pin'}</span>
                <span class="font-mono text-[10px] text-slate-400 shrink-0" title="${escapeQuotes(createdText)}">${escapeHtml(ageLabel)}</span>
              </div>
            </div>

            <!-- Metrics Strip -->
            <div class="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100 text-center">
              <div class="bg-slate-50 rounded-lg py-1 px-1">
                <div class="text-[10px] text-slate-400 font-medium">Velocity</div>
                <div class="text-[11px] font-bold text-emerald-700 font-mono">${escapeHtml(velocityText)}</div>
              </div>
              <div class="bg-slate-50 rounded-lg py-1 px-1">
                <div class="text-[10px] text-slate-400 font-medium">Reactions</div>
                <div class="text-[11px] font-bold text-slate-800 font-mono">${item.reactions.toLocaleString()}</div>
              </div>
              <div class="bg-slate-50 rounded-lg py-1 px-1">
                <div class="text-[10px] text-slate-400 font-medium">Comments</div>
                <div class="text-[11px] font-bold text-slate-800 font-mono">${item.comments.toLocaleString()}</div>
              </div>
            </div>

            <!-- Footer Actions -->
            <div class="flex items-center justify-between gap-1.5 pt-1">
              <a href="${escapeHtml(pinUrl)}" target="_blank" rel="noopener noreferrer" class="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold text-center transition-colors">
                View Pin
              </a>
              ${
                item.hasLink
                  ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="py-1.5 px-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-semibold transition-colors" title="Visit destination link">
                       <i class="ph-bold ph-link"></i>
                     </a>`
                  : ''
              }
              <button type="button" onclick="sendWinnerPinToPosition('${escapeQuotes(pinId)}')" class="py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs transition-colors" title="Track rank in Position Tracker">
                <i class="ph ph-crosshair"></i>
              </button>
              <button type="button" onclick="bookmarkWinnerPin('${escapeQuotes(pinId)}')" class="py-1.5 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 text-xs transition-colors" title="Bookmark Winner Pin">
                <i class="ph-fill ph-star"></i>
              </button>
            </div>
          </div>
        </article>
      `;
      })
      .join('') + (remainingHidden > 0
        ? `<div class="col-span-full flex justify-center py-3">
             <button type="button" onclick="showMoreWinnerRendered()" class="px-5 py-2.5 rounded-xl bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold transition-colors">
               Show More Results (${displayed.length.toLocaleString()} of ${visible.length.toLocaleString()} shown — +${Math.min(200, remainingHidden)} more)
             </button>
           </div>`
        : '');
  }

  // Render Table View
  if (state.winnerViewMode === 'table') {
    tbody.innerHTML = displayed
      .map((item, idx) => {
        const p = item.pin;
        const imgUrl = getPinImageUrl(p, true);
        const pinUrl = p.pinUrl || p.url || p['main link'] || `https://www.pinterest.com/pin/${p.id || p['Pin ID']}/`;
        const pinId = String(p.id || p['Pin ID'] || '');
        const title = p.title || p.Title || 'Untitled Pin';
        const domain = p.domain && p.domain !== 'not-given' ? p.domain : '';
        const ageLabel = formatWinnerAgeLabel(item.ageDays);
        const createdText = p.created && p.created !== 'not-given' ? p.created : (p.Created && p.Created !== 'not-given' ? p.Created : '—');
        const isDimmed = f.enabled && !item.matches && f.action === 'dim';
        const velocityText = item.savesPerDay !== null ? `${item.savesPerDay >= 10 ? Math.round(item.savesPerDay) : item.savesPerDay.toFixed(1)}/d` : '—';

        return `
        <tr class="hover:bg-slate-50 transition-colors ${isDimmed ? 'opacity-40 bg-slate-50/50' : ''}">
          <td class="py-2 px-3 text-center font-mono text-slate-500">${idx + 1}</td>
          <td class="py-2 px-3 text-center">
            ${
              imgUrl
                ? `<a href="${escapeHtml(pinUrl)}" target="_blank" rel="noopener noreferrer" class="inline-block w-11 h-14 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                     <img src="${escapeHtml(imgUrl)}" alt="" loading="lazy" class="w-full h-full object-cover">
                   </a>`
                : `<span class="text-[10px] text-slate-400">—</span>`
            }
          </td>
          <td class="py-2 px-3 max-w-xs">
            <div class="space-y-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                ${
                  item.matches
                    ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 text-[10px] font-bold">WINNER</span>`
                    : `<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-semibold">${escapeHtml(item.reasons.join(', ') || 'Filtered')}</span>`
                }
                ${item.isVideo ? `<span class="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold inline-flex items-center gap-0.5"><i class="ph-fill ph-play"></i> VIDEO</span>` : ''}
                <a href="${escapeHtml(pinUrl)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-slate-900 hover:text-red-600 truncate max-w-[260px]" title="${escapeQuotes(title)}">
                  ${escapeHtml(title)}
                </a>
              </div>
              <div class="text-[10px] text-slate-400 font-mono">ID: ${escapeHtml(pinId)}</div>
            </div>
          </td>
          <td class="py-2 px-3 text-center font-mono font-bold text-pink-600">${item.saves.toLocaleString()}</td>
          <td class="py-2 px-3 text-center font-mono font-semibold text-emerald-700">${escapeHtml(velocityText)}</td>
          <td class="py-2 px-3 text-center whitespace-nowrap">
            <div class="font-semibold text-slate-700">${escapeHtml(ageLabel)}</div>
            <div class="text-[10px] text-slate-400">${escapeHtml(createdText)}</div>
          </td>
          <td class="py-2 px-3 max-w-[220px]">
            ${
              item.hasLink
                ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline font-medium truncate block max-w-[210px]" title="${escapeQuotes(item.link)}">${escapeHtml(domain || item.link)}</a>`
                : `<span class="text-slate-400">No link</span>`
            }
          </td>
          <td class="py-2 px-3 text-center font-mono text-slate-700">${item.reactions.toLocaleString()}</td>
          <td class="py-2 px-3 text-right whitespace-nowrap space-x-1">
            <button type="button" onclick="sendWinnerPinToPosition('${escapeQuotes(pinId)}')" class="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600" title="Position Tracker">
              <i class="ph ph-crosshair"></i>
            </button>
            <button type="button" onclick="bookmarkWinnerPin('${escapeQuotes(pinId)}')" class="p-1.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-600" title="Bookmark">
              <i class="ph-fill ph-star"></i>
            </button>
            <a href="${escapeHtml(pinUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600" title="Open on Pinterest">
              <i class="ph ph-arrow-square-out"></i>
            </a>
          </td>
        </tr>
      `;
      })
      .join('') + (remainingHidden > 0
        ? `<tr><td colspan="9" class="py-3 text-center bg-slate-50">
             <button type="button" onclick="showMoreWinnerRendered()" class="px-4 py-1.5 rounded-lg bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-200 text-xs font-bold transition-colors">
               Show More Rows (${displayed.length.toLocaleString()} of ${visible.length.toLocaleString()} shown — +${Math.min(200, remainingHidden)} more)
             </button>
           </td></tr>`
        : '');
  }
}

function exportWinnerPinsCSV() {
  const { visible } = getProcessedWinnerPins();
  const toExport = state.winnerFilter.enabled
    ? visible.filter((item) => item.matches)
    : visible;

  if (!toExport || toExport.length === 0) {
    alert('No Winner Pins to export.');
    return;
  }

  const headers = [
    'Rank',
    'Pin ID',
    'Title',
    'Saves',
    'Saves Per Day',
    'Created',
    'Age (Days)',
    'Has Link',
    'Destination Link',
    'Domain',
    'Reactions',
    'Comments',
    'Pinner Username',
    'Board Name',
    'Pin URL',
    'Image URL',
  ];

  const rows = [
    headers.join(','),
    ...toExport.map((item, idx) => {
      const p = item.pin;
      const pinId = String(p.id || p['Pin ID'] || '');
      const title = p.title || p.Title || '';
      const created = p.created || p.Created || '';
      const domain = p.domain && p.domain !== 'not-given' ? p.domain : '';
      const pinUrl = p.pinUrl || p.url || p['main link'] || '';
      const imgUrl = getPinImageUrl(p, false);
      const pinner = p.pinnerUsername || (p['Pinner Username'] !== 'not-given' ? p['Pinner Username'] : '') || '';
      const board = p.boardName || (p['Board Name'] !== 'not-given' ? p['Board Name'] : '') || '';
      const cols = [
        idx + 1,
        pinId,
        title,
        item.saves,
        item.savesPerDay !== null ? item.savesPerDay.toFixed(2) : '',
        created,
        item.ageDays !== null ? Math.round(item.ageDays) : '',
        item.hasLink ? 'YES' : 'NO',
        item.link,
        domain,
        item.reactions,
        item.comments,
        pinner,
        board,
        pinUrl,
        imgUrl,
      ];
      return cols.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    }),
  ];

  const safeQuery = (state.winnerQuery || 'pins').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
  downloadFile(`winner_pins_${safeQuery}_${Date.now()}.csv`, rows.join('\n'), 'text/csv;charset=utf-8;');
}




