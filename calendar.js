/* ========================================================================
 * UNA Drop-In Calendar — calendar.js
 * Vanilla JS rendering, filtering, week navigation, view toggle.
 * Data source: window.UNA_SAMPLE_DATA (from sample-data.js).
 * To swap in live PerfectMind data, replace getPrograms() with a fetch.
 * ====================================================================== */

(function () {
  'use strict';

  // ----- Constants -----
  const DAY_NAMES_LONG  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LETTERS     = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const HOUR_HEIGHT = 64;       // px per hour (matches --hour-height-desktop)
  const MIN_BLOCK_HEIGHT = 38;  // smallest visible event card

  const STORAGE_KEY = 'una-calendar-prefs';

  const MOBILE_QUERY = window.matchMedia('(max-width: 767px)');

  // ----- DOM refs -----
  const els = {
    dateRange: document.getElementById('date-range'),
    grid: document.getElementById('calendar-grid'),
    emptyState: document.getElementById('empty-state'),
    filterProgramType: document.getElementById('filter-program-type'),
    filterAgeCategory: document.getElementById('filter-age-category'),
    filterAvailability: document.getElementById('filter-availability'),
    filterLocation: document.getElementById('filter-location'),
    allMultiSelects: document.querySelectorAll('.multi-select'),
    mobileFiltersToggle: document.getElementById('mobile-filters-toggle'),
    filtersPanel: document.getElementById('filters'),
    prevWeek: document.getElementById('prev-week'),
    nextWeek: document.getElementById('next-week'),
    todayBtn: document.getElementById('today-btn'),
    viewToggleBtns: document.querySelectorAll('.view-toggle-btn'),
    mobileDayTabs: document.getElementById('mobile-day-tabs'),
    mobileSheet: document.getElementById('mobile-sheet'),
    mobileSheetContent: document.getElementById('mobile-sheet-content'),
  };

  // ----- State -----
  const state = {
    weekStart: getWeekStart(new Date()),
    view: 'grid',                                    // 'grid' | 'list'
    mobileActiveDay: new Date().getDay(),            // 0-6
    filters: {
      programType: [],
      ageCategory: [],
      availability: [],
      location: [],
    },
  };

  // ============ Bootstrap ============

  function init() {
    loadPrefs();
    populateLocationFilter();
    initMultiSelects();
    attachEventHandlers();
    render();
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.view === 'grid' || prefs.view === 'list') {
        state.view = prefs.view;
      }
    } catch (e) { /* ignore */ }

    // On mobile, default to list view if no explicit preference
    if (MOBILE_QUERY.matches && !localStorage.getItem(STORAGE_KEY)) {
      state.view = 'list';
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ view: state.view }));
    } catch (e) { /* ignore */ }
  }

  // ============ Data ============

  function getPrograms() {
    // Live data path: WordPress/PHP sets window.UNA_LIVE_DATA with raw
    // PerfectMind events. PerfectMindAdapter transforms them to our schema.
    if (window.UNA_LIVE_DATA && window.PerfectMindAdapter) {
      return window.PerfectMindAdapter.transform(window.UNA_LIVE_DATA);
    }
    // Fallback: sample data for local prototype dev
    return (window.UNA_SAMPLE_DATA && window.UNA_SAMPLE_DATA.programs) || [];
  }

  function populateLocationFilter() {
    const programs = getPrograms();
    const locations = Array.from(new Set(programs.map(p => p.location))).sort();
    locations.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      els.filterLocation.appendChild(opt);
    });
  }

  // ============ Multi-select controller ============

  function initMultiSelects() {
    els.allMultiSelects.forEach(root => {
      const filterKey = root.getAttribute('data-filter-key');
      const placeholder = root.getAttribute('data-placeholder') || 'All';
      let rawOptions;
      try {
        rawOptions = JSON.parse(root.getAttribute('data-options') || '[]');
      } catch (e) {
        rawOptions = [];
      }
      // Normalize: allow both ["Value"] and [{value, label}]
      const options = rawOptions.map(o =>
        typeof o === 'string' ? { value: o, label: o } : o
      );

      // Toggle button
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'multi-select-toggle';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML =
        `<span class="multi-select-label">${escapeHtml(placeholder)}</span>` +
        `<span class="multi-select-count" hidden>0</span>` +
        `<span class="multi-select-chevron" aria-hidden="true">▾</span>`;
      root.appendChild(toggle);

      // Panel
      const panel = document.createElement('div');
      panel.className = 'multi-select-panel';
      panel.hidden = true;

      options.forEach(opt => {
        const label = document.createElement('label');
        label.className = 'multi-select-option';
        label.innerHTML =
          `<input type="checkbox" value="${escapeHtml(opt.value)}">` +
          `<span>${escapeHtml(opt.label)}</span>`;
        panel.appendChild(label);
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'multi-select-clear';
      clearBtn.textContent = 'Clear all';
      clearBtn.hidden = true;
      panel.appendChild(clearBtn);

      root.appendChild(panel);

      // Helpers bound to this instance
      const labelEl = toggle.querySelector('.multi-select-label');
      const countEl = toggle.querySelector('.multi-select-count');

      function updateUI() {
        const selected = state.filters[filterKey] || [];
        if (selected.length === 0) {
          labelEl.textContent = placeholder;
          countEl.hidden = true;
          clearBtn.hidden = true;
        } else if (selected.length === 1) {
          const match = options.find(o => o.value === selected[0]);
          labelEl.textContent = match ? match.label : selected[0];
          countEl.hidden = true;
          clearBtn.hidden = false;
        } else {
          labelEl.textContent = placeholder;
          countEl.hidden = false;
          countEl.textContent = String(selected.length);
          clearBtn.hidden = false;
        }
      }

      function close() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }

      function open() {
        // Close all other panels first
        document.querySelectorAll('.multi-select-panel').forEach(p => {
          if (p !== panel) {
            p.hidden = true;
            const t = p.parentElement && p.parentElement.querySelector('.multi-select-toggle');
            if (t) t.setAttribute('aria-expanded', 'false');
          }
        });
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
      }

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel.hidden) open(); else close();
      });

      panel.addEventListener('click', (e) => e.stopPropagation());

      panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const current = state.filters[filterKey] || [];
          if (cb.checked) {
            if (!current.includes(cb.value)) current.push(cb.value);
          } else {
            const idx = current.indexOf(cb.value);
            if (idx > -1) current.splice(idx, 1);
          }
          state.filters[filterKey] = current;
          updateUI();
          render();
        });
      });

      clearBtn.addEventListener('click', () => {
        state.filters[filterKey] = [];
        panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        updateUI();
        render();
      });

      // Expose for external state sync if needed
      root._multiSelect = { updateUI, close, open };
    });

    // Global click → close any open panels
    document.addEventListener('click', () => {
      document.querySelectorAll('.multi-select-panel').forEach(p => {
        if (!p.hidden) {
          p.hidden = true;
          const t = p.parentElement && p.parentElement.querySelector('.multi-select-toggle');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  // ============ Filters ============

  function applyFilters(programs) {
    return programs.filter(p => {
      if (state.filters.programType.length && !state.filters.programType.includes(p.programType)) return false;
      if (state.filters.ageCategory.length && !state.filters.ageCategory.includes(p.ageCategory)) return false;
      if (state.filters.location.length && !state.filters.location.includes(p.location)) return false;

      // Availability: "available" hides Full and past events
      if (state.filters.availability.includes('available')) {
        if (p.spotsLeft === 0) return false;
        if (p._isPast) return false;
      }
      return true;
    });
  }

  // ============ Date math ============

  function getWeekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - d.getDay()); // back to Sunday
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }

  function formatDateRange(weekStart) {
    const end = addDays(weekStart, 6);
    const sM = MONTH_NAMES_SHORT[weekStart.getMonth()];
    const eM = MONTH_NAMES_SHORT[end.getMonth()];
    const sY = weekStart.getFullYear();
    const eY = end.getFullYear();
    if (sY !== eY) {
      return `${sM} ${weekStart.getDate()}, ${sY} to ${eM} ${end.getDate()}, ${eY}`;
    }
    return `${sM} ${weekStart.getDate()}, ${sY} to ${eM} ${end.getDate()}, ${eY}`;
  }

  function timeStrToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToHour(min) { return min / 60; }

  function formatTime12(t) {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = ((h + 11) % 12) + 1;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }

  // Annotate each program with its actual date in the displayed week + isPast flag
  function annotateWithDates(programs, weekStart) {
    const now = new Date();
    return programs.map(p => {
      const eventDate = addDays(weekStart, p.dayOfWeek);
      const [eh, em] = p.endTime.split(':').map(Number);
      const eventEnd = new Date(eventDate);
      eventEnd.setHours(eh, em, 0, 0);
      const isPast = eventEnd.getTime() < now.getTime();
      return Object.assign({}, p, { _date: eventDate, _isPast: isPast });
    });
  }

  // ============ Auto-compress time axis ============

  function computeTimeRange(events) {
    if (!events.length) return null;
    let minMin = Infinity, maxMin = -Infinity;
    events.forEach(e => {
      const s = timeStrToMinutes(e.startTime);
      const en = timeStrToMinutes(e.endTime);
      if (s < minMin) minMin = s;
      if (en > maxMin) maxMin = en;
    });
    // Round down/up to nearest hour
    const startHour = Math.floor(minMin / 60);
    const endHour = Math.ceil(maxMin / 60);
    return { startHour, endHour };
  }

  // ============ Overlap detection ============
  // Given events for a single day, group time-overlapping events into clusters,
  // then for each event compute its column index + total columns in the cluster.
  function layoutDayEvents(dayEvents) {
    // Sort by start time
    const sorted = dayEvents.slice().sort((a, b) =>
      timeStrToMinutes(a.startTime) - timeStrToMinutes(b.startTime)
    );

    // Walk and group into clusters
    const clusters = [];
    let current = [];
    let currentMaxEnd = -1;
    sorted.forEach(e => {
      const s = timeStrToMinutes(e.startTime);
      const en = timeStrToMinutes(e.endTime);
      if (current.length === 0 || s < currentMaxEnd) {
        current.push(e);
        if (en > currentMaxEnd) currentMaxEnd = en;
      } else {
        clusters.push(current);
        current = [e];
        currentMaxEnd = en;
      }
    });
    if (current.length) clusters.push(current);

    // Within each cluster, assign column indices
    const laid = [];
    clusters.forEach(cluster => {
      // Greedy column assignment
      const cols = []; // each col = array of events; track its latest end
      cluster.forEach(e => {
        const s = timeStrToMinutes(e.startTime);
        let placed = false;
        for (let i = 0; i < cols.length; i++) {
          const lastInCol = cols[i][cols[i].length - 1];
          if (timeStrToMinutes(lastInCol.endTime) <= s) {
            cols[i].push(e);
            e._col = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          e._col = cols.length;
          cols.push([e]);
        }
      });
      const totalCols = cols.length;
      cluster.forEach(e => { e._totalCols = totalCols; });
      laid.push(...cluster);
    });

    return laid;
  }

  // ============ Conditional age category detection ============
  // If the same program name appears with multiple ageCategory values in the
  // visible week, mark each instance with _showAgeCategory=true so the tooltip
  // shows the age category line. Otherwise hide it.
  function markAgeCategoryDisambiguation(events) {
    const byName = new Map();
    events.forEach(e => {
      if (!byName.has(e.name)) byName.set(e.name, new Set());
      byName.get(e.name).add(e.ageCategory);
    });
    events.forEach(e => {
      e._showAgeCategory = byName.get(e.name).size > 1;
    });
  }

  // ============ Rendering ============

  function render() {
    // 1. Get and filter data
    const all = annotateWithDates(getPrograms(), state.weekStart);
    const visible = applyFilters(all);
    markAgeCategoryDisambiguation(visible);

    // 2. Header
    els.dateRange.textContent = formatDateRange(state.weekStart);

    // 3. View toggle button states
    els.viewToggleBtns.forEach(btn => {
      const isActive = btn.dataset.view === state.view;
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // 4. Empty state
    if (visible.length === 0) {
      els.grid.innerHTML = '';
      els.grid.classList.remove('is-list-view');
      els.emptyState.hidden = false;
      renderMobileDayTabs([]);
      return;
    }
    els.emptyState.hidden = true;

    // 5. Render grid or list
    if (state.view === 'list') {
      renderListView(visible);
    } else {
      renderGridView(visible);
    }

    renderMobileDayTabs(visible);
    applyMobileActiveDay();
  }

  function renderGridView(events) {
    els.grid.innerHTML = '';
    els.grid.classList.remove('is-list-view');

    const range = computeTimeRange(events);
    if (!range) return;
    const totalHours = range.endHour - range.startHour;
    const gridHeight = totalHours * HOUR_HEIGHT;

    // Header row: corner + 7 day headers
    const corner = document.createElement('div');
    corner.className = 'grid-corner';
    els.grid.appendChild(corner);

    const today = new Date();
    for (let d = 0; d < 7; d++) {
      const dayDate = addDays(state.weekStart, d);
      const header = document.createElement('div');
      header.className = 'day-header';
      if (isSameDay(dayDate, today)) header.classList.add('is-today');
      const monthAbbr = MONTH_NAMES_SHORT[dayDate.getMonth()];
      header.innerHTML =
        `<span class="day-header-long">${DAY_NAMES_LONG[d]}, ${monthAbbr} ${dayDate.getDate()}</span>` +
        `<span class="day-header-short">${DAY_NAMES_SHORT[d]}, ${monthAbbr} ${dayDate.getDate()}</span>`;
      els.grid.appendChild(header);
    }

    // Time axis column
    const axis = document.createElement('div');
    axis.className = 'time-axis';
    axis.style.height = gridHeight + 'px';
    for (let h = range.startHour; h < range.endHour; h++) {
      const tick = document.createElement('div');
      tick.className = 'time-tick';
      tick.style.top = ((h - range.startHour) * HOUR_HEIGHT) + 'px';
      tick.style.height = HOUR_HEIGHT + 'px';
      tick.textContent = formatHourLabel(h);
      axis.appendChild(tick);
    }
    els.grid.appendChild(axis);

    // 7 day columns
    for (let d = 0; d < 7; d++) {
      const col = document.createElement('div');
      col.className = 'day-column';
      col.dataset.day = String(d);
      col.style.height = gridHeight + 'px';
      const dayDate = addDays(state.weekStart, d);
      if (isSameDay(dayDate, today)) col.classList.add('is-today');

      // Events for this day
      const dayEvents = events.filter(e => e.dayOfWeek === d);
      const laid = layoutDayEvents(dayEvents);

      laid.forEach(ev => {
        const card = buildEventCard(ev, range);
        col.appendChild(card);
      });

      els.grid.appendChild(col);
    }
  }

  function buildEventCard(ev, range) {
    const startMin = timeStrToMinutes(ev.startTime);
    const endMin = timeStrToMinutes(ev.endTime);
    const top = ((startMin / 60) - range.startHour) * HOUR_HEIGHT;
    const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT - 2, MIN_BLOCK_HEIGHT);

    const totalCols = ev._totalCols || 1;
    const col = ev._col || 0;
    const widthPct = 100 / totalCols;
    const leftPct = col * widthPct;

    const card = document.createElement('div');
    card.className = 'event-card';
    if (ev._isPast) card.classList.add('is-past');
    if (ev.spotsLeft === 0) card.classList.add('is-full');

    card.style.top = top + 'px';
    card.style.height = height + 'px';
    card.style.left = `calc(${leftPct}% + 2px)`;
    card.style.width = `calc(${widthPct}% - 4px)`;

    card.innerHTML =
      `<span class="event-name">${escapeHtml(ev.name)}</span>` +
      `<span class="event-age">${escapeHtml(ev.ageRange)}</span>` +
      `<span class="event-time">${formatTime12(ev.startTime)} – ${formatTime12(ev.endTime)}</span>`;

    attachEventInteractions(card, ev);
    return card;
  }

  function renderListView(events) {
    els.grid.innerHTML = '';
    els.grid.classList.add('is-list-view');

    const today = new Date();
    for (let d = 0; d < 7; d++) {
      const dayDate = addDays(state.weekStart, d);
      const col = document.createElement('div');
      col.className = 'day-column';
      col.dataset.day = String(d);
      if (isSameDay(dayDate, today)) col.classList.add('is-today');

      // Day label (since list view hides the time axis + header row context on mobile)
      const label = document.createElement('div');
      label.className = 'list-day-label';
      label.style.cssText = 'font-weight:700;color:var(--una-green);font-size:13px;text-transform:uppercase;letter-spacing:0.4px;text-align:center;padding:8px 4px;border-bottom:1px solid var(--grey-100);margin-bottom:4px;';
      label.innerHTML = `${DAY_NAMES_SHORT[d]} ${dayDate.getDate()}`;
      col.appendChild(label);

      const dayEvents = events
        .filter(e => e.dayOfWeek === d)
        .sort((a, b) => timeStrToMinutes(a.startTime) - timeStrToMinutes(b.startTime));

      if (dayEvents.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;color:var(--grey-200);font-size:12px;padding:8px;';
        empty.textContent = '—';
        col.appendChild(empty);
      } else {
        dayEvents.forEach(ev => {
          const card = document.createElement('div');
          card.className = 'event-card';
          if (ev._isPast) card.classList.add('is-past');
          if (ev.spotsLeft === 0) card.classList.add('is-full');
          card.innerHTML =
            `<span class="event-name">${escapeHtml(ev.name)}</span>` +
            `<span class="event-age">${escapeHtml(ev.ageRange)}</span>` +
            `<span class="event-time">${formatTime12(ev.startTime)} – ${formatTime12(ev.endTime)}</span>`;
          attachEventInteractions(card, ev);
          col.appendChild(card);
        });
      }
      els.grid.appendChild(col);
    }
  }

  // ============ Event interactions (tooltip + sheet) ============

  function attachEventInteractions(card, ev) {
    // Desktop hover tooltip
    let tooltipEl = null;
    card.addEventListener('mouseenter', () => {
      if (MOBILE_QUERY.matches) return;
      tooltipEl = buildTooltip(ev);
      document.body.appendChild(tooltipEl);
      positionTooltip(tooltipEl, card);
      requestAnimationFrame(() => tooltipEl.classList.add('is-visible'));
    });
    card.addEventListener('mouseleave', () => {
      if (tooltipEl) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    });

    // Mobile / tap → bottom sheet
    card.addEventListener('click', (e) => {
      if (MOBILE_QUERY.matches) {
        e.preventDefault();
        openMobileSheet(ev);
      }
    });
  }

  function buildTooltip(ev) {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.innerHTML = tooltipInnerHTML(ev);
    return tip;
  }

  function tooltipInnerHTML(ev) {
    const parts = [];
    if (ev._isPast) {
      parts.push('<div class="tooltip-row is-past-label">Past Event</div>');
    }
    parts.push(`<div class="tooltip-row is-name">${escapeHtml(ev.name)} #${escapeHtml(ev.id)}</div>`);
    if (ev._showAgeCategory) {
      parts.push(`<div class="tooltip-row">${escapeHtml(ev.ageCategory)}</div>`);
    }
    parts.push(`<div class="tooltip-row">${escapeHtml(ev.ageRange)}</div>`);
    parts.push(`<div class="tooltip-row">${formatTime12(ev.startTime)} – ${formatTime12(ev.endTime)}</div>`);
    parts.push(`<div class="tooltip-row">${escapeHtml(ev.location)}</div>`);
    if (!ev._isPast) {
      if (ev.spotsLeft === 0) {
        parts.push('<div class="tooltip-row is-full">Full</div>');
      } else if (typeof ev.spotsLeft === 'number') {
        parts.push(`<div class="tooltip-row is-spots">${ev.spotsLeft} spot(s) left</div>`);
      }
    }
    return parts.join('');
  }

  function positionTooltip(tip, card) {
    const rect = card.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left = rect.left + window.scrollX + (rect.width / 2) - (tipRect.width / 2);
    let top = rect.top + window.scrollY - tipRect.height - 8;

    // Clamp horizontally
    const margin = 8;
    if (left < margin) left = margin;
    if (left + tipRect.width > window.innerWidth - margin) {
      left = window.innerWidth - tipRect.width - margin;
    }
    // If tooltip would go above viewport, place below
    if (top < window.scrollY + margin) {
      top = rect.bottom + window.scrollY + 8;
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function openMobileSheet(ev) {
    els.mobileSheetContent.innerHTML = tooltipInnerHTML(ev);
    els.mobileSheet.hidden = false;
  }

  function closeMobileSheet() {
    els.mobileSheet.hidden = true;
  }

  // ============ Mobile day tabs ============

  function renderMobileDayTabs(events) {
    els.mobileDayTabs.innerHTML = '';
    const today = new Date();
    const eventsByDay = new Set(events.map(e => e.dayOfWeek));
    for (let d = 0; d < 7; d++) {
      const dayDate = addDays(state.weekStart, d);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'day-tab';
      tab.dataset.day = String(d);
      if (d === state.mobileActiveDay) tab.classList.add('is-active');
      if (isSameDay(dayDate, today)) tab.classList.add('is-today');
      tab.innerHTML =
        `<span class="day-tab-name">${DAY_LETTERS[d]}</span>` +
        `<span class="day-tab-date">${dayDate.getDate()}</span>`;
      tab.addEventListener('click', () => {
        state.mobileActiveDay = d;
        document.querySelectorAll('.day-tab').forEach(t => t.classList.toggle('is-active', Number(t.dataset.day) === d));
        applyMobileActiveDay();
      });
      els.mobileDayTabs.appendChild(tab);
    }
  }

  function applyMobileActiveDay() {
    document.querySelectorAll('.day-column').forEach(col => {
      col.classList.toggle('is-mobile-active', Number(col.dataset.day) === state.mobileActiveDay);
    });
  }

  // ============ Helpers ============

  function formatHourLabel(h) {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    if (h < 12) return `${h} AM`;
    return `${h - 12} PM`;
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // ============ Event handlers ============

  function attachEventHandlers() {
    // Program Type + Age Category multi-selects wire up their own handlers
    // in initMultiSelects(). Availability + Location stay as native
    // single-select dropdowns because they only have 1-2 options.
    els.filterAvailability.addEventListener('change', e => {
      state.filters.availability = e.target.value ? [e.target.value] : [];
      render();
    });
    els.filterLocation.addEventListener('change', e => {
      state.filters.location = e.target.value ? [e.target.value] : [];
      render();
    });

    // Week navigation
    els.prevWeek.addEventListener('click', () => {
      state.weekStart = addDays(state.weekStart, -7);
      render();
    });
    els.nextWeek.addEventListener('click', () => {
      state.weekStart = addDays(state.weekStart, 7);
      render();
    });
    els.todayBtn.addEventListener('click', () => {
      state.weekStart = getWeekStart(new Date());
      state.mobileActiveDay = new Date().getDay();
      render();
    });

    // View toggle
    els.viewToggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        savePrefs();
        render();
      });
    });

    // Mobile filters collapse
    els.mobileFiltersToggle.addEventListener('click', () => {
      const open = els.filtersPanel.classList.toggle('is-open');
      els.mobileFiltersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Mobile sheet close
    els.mobileSheet.querySelectorAll('[data-close-sheet]').forEach(btn => {
      btn.addEventListener('click', closeMobileSheet);
    });

    // Re-render when crossing the mobile breakpoint (so list/grid defaults reapply)
    MOBILE_QUERY.addEventListener('change', render);
  }

  // ============ Go ============

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
