/* DOUBLE TROUBLE V4 - local physical darts console. Original WebGL renderer. */
(() => {
  'use strict';

  const STORAGE_KEY = 'double-trouble-darts-v3';
  const PREVIOUS_KEY = 'double-trouble-darts-v2';
  const LEGACY_KEY = 'double-trouble-darts-v1';
  const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];
  const COLORS = ['#e0fd78', '#fe927a', '#baa9ff', '#8edcdb', '#ffc96f', '#f49cc5', '#a7caff', '#c5d5b5'];
  const GAMES = {
    '501': { label: '501', desc: 'The classic countdown', hint: 'Start at 501. Hit zero exactly.' },
    '301': { label: '301', desc: 'Short & competitive', hint: 'Start at 301. Hit zero exactly.' },
    'CRICKET': { label: 'CRICKET', desc: 'Close 15–20 + bull', hint: 'Close 15–20 and bull. Outscore opponents.' },
    'COUNTUP': { label: 'COUNT UP', desc: 'Most points wins', hint: 'Highest score after the final round wins.' }
  };

  const app = document.getElementById('app');
  const IS_MAC = Boolean(window.webkit?.messageHandlers?.dartsSave);
  const ACHIEVEMENTS = [
    { id:'first-win', icon:'★', name:'FIRST BLOOD', desc:'Win your first match.', check:s=>s.wins>=1 },
    { id:'century', icon:'100', name:'THE CENTURY CLUB', desc:'Record a visit of 100 or more in 301/501.', check:s=>s.visits100>=1 },
    { id:'bull', icon:'◎', name:'BULLY BEHAVIOUR', desc:'Hit the inner bullseye.', check:s=>s.bulls>=1 },
    { id:'bull10', icon:'10', name:'BULL MAGNET', desc:'Land ten inner bullseyes.', check:s=>s.bulls>=10 },
    { id:'180', icon:'180', name:'ABSOLUTELY UNNECESSARY', desc:'Score a perfect 180-point visit.', check:s=>s.visits180>=1 },
    { id:'streak3', icon:'✳', name:'ON A ROLL', desc:'Win three consecutive appearances.', check:s=>s.longestStreak>=3 },
    { id:'streak5', icon:'5', name:'PUBLIC ENEMY NO. 1', desc:'Win five consecutive appearances.', check:s=>s.longestStreak>=5 },
    { id:'games10', icon:'10', name:'REGULAR CUSTOMER', desc:'Play ten finished matches.', check:s=>s.played>=10 },
    { id:'games50', icon:'50', name:'NEEDS A HOBBY', desc:'Play fifty finished matches.', check:s=>s.played>=50 },
    { id:'triples50', icon:'T', name:'TRIPLE TROUBLE', desc:'Land fifty triple segments.', check:s=>s.triples>=50 },
    { id:'rival5', icon:'⚔', name:'PERSONAL PROBLEM', desc:'Win five games against the same rival.', check:s=>s.rivalWins>=5 },
    { id:'comeback', icon:'↗', name:'WE THOUGHT YOU WERE DONE', desc:'Win after losing at least three consecutive appearances.', check:s=>s.comeback }
  ];

  function readStored(key) {
    if (IS_MAC && key === STORAGE_KEY) return window.__DOUBLE_TROUBLE_SAVED_JSON__ || null;
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function saveStored(key, value) {
    if (IS_MAC && key === STORAGE_KEY) {
      window.__DOUBLE_TROUBLE_SAVED_JSON__ = value;
      window.webkit.messageHandlers.dartsSave.postMessage(value);
      return;
    }
    localStorage.setItem(key,value);
  }

  let toastTimer = 0;
  let soundContext = null;
  let currentWalkOnAudio = null;
  let stage = null, stageHost = null, sceneMatchId = null;
  let flightBusy = false, clearingBusy = false, pendingShotId = null, clearOnSync = false;
  let effectTimer = 0, winnerTimer = 0, handoffTimer = 0;
  let state = loadState();

  function uid() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  }

  function newProfile(name) {
    return { id: uid(), name: name || 'New player', avatar: null, walkon: 'arcade', walkonAudio: null, dartColor: null, createdAt: Date.now() };
  }

  function defaultState() {
    const profiles = [newProfile('Player 1'), newProfile('Player 2')];
    profiles.forEach((p,i)=>p.dartColor=COLORS[i]);
    const season = { id: uid(), name:'Season 01', createdAt:Date.now(), endedAt:null };
    return {
      schemaVersion: 4, screen: 'setup',
      settings: { game: '501', doubleOut: false, countUpRounds: 8, sound: false, motion: 'realistic', quality: 'high' },
      profiles,
      roster: profiles.map(p => p.id),
      archives: [], seasons:[season], activeSeasonId:season.id,
      match: null,
      ui: { showWinner:true, showHistory:false, returnScreen:'setup', profileId:profiles[0].id,
        leagueTab:'standings', heatmapMode:'ALL', lastUnlocks:[] }
    };
  }

  function sanitiseLoaded(input) {
    if (!input || !Array.isArray(input.profiles) || !Array.isArray(input.roster)) return null;
    const profiles = input.profiles.filter(p => p && typeof p.id === 'string')
      .map((p,index) => ({ id: p.id, name: String(p.name || 'Player').slice(0, 24),
        dartColor: validColor(p.dartColor) ? p.dartColor.toLowerCase() : COLORS[index % COLORS.length],
        avatar: typeof p.avatar === 'string' && /^data:image\/jpeg;base64,/.test(p.avatar) ? p.avatar : null,
        walkon: ['arcade','stadium','villain','chaos','none'].includes(p.walkon) ? p.walkon : 'arcade',
        walkonAudio: typeof p.walkonAudio === 'string' && p.walkonAudio.length < 3 * 1024 * 1024 &&
          /^data:audio\/[-+.\w]+;base64,[A-Za-z0-9+/=]+$/.test(p.walkonAudio) ? p.walkonAudio : null,
        createdAt: Number(p.createdAt) || Date.now() }));
    const ids = new Set(profiles.map(p => p.id));
    if (profiles.length > 500 || ids.size !== profiles.length) return null;
    const roster = [...new Set(input.roster)].filter(id => ids.has(id)).slice(0, 8);
    const settings = { ...defaultState().settings, ...input.settings };
    if (!GAMES[settings.game]) settings.game = '501';
    settings.countUpRounds = Math.min(30, Math.max(1, Number(settings.countUpRounds) || 8));
    if (!['realistic','quick','reduced'].includes(settings.motion)) settings.motion='realistic';
    if (!['high','eco'].includes(settings.quality)) settings.quality='high';
    const archives = Array.isArray(input.archives) ? input.archives.filter(x => x && typeof x.id === 'string' && GAMES[x.game] && Array.isArray(x.players)) : [];
    const match = input.match && Array.isArray(input.match.players) && GAMES[input.match.game] ? input.match : null;
    if (match) migrateMatch(match, profiles);
    let seasons = Array.isArray(input.seasons) ? input.seasons.filter(v=>v && typeof v.id === 'string' && typeof v.name === 'string')
      .map(v=>({id:v.id,name:String(v.name).slice(0,40),createdAt:Number(v.createdAt)||Date.now(), endedAt:v.endedAt?Number(v.endedAt):null})) : [];
    if (!seasons.length) {
      seasons = [{ id:'original-season', name:'Season 01', createdAt:Date.now(), endedAt:null }];
      // V2 matches did not have seasons; place them together in the inaugural season.
      for (const archive of archives) archive.seasonId = seasons[0].id;
    }
    const activeSeasonId = seasons.some(v=>v.id===input.activeSeasonId) ? input.activeSeasonId : seasons[seasons.length-1].id;
    const seasonIds = new Set(seasons.map(v=>v.id));
    for (const archive of archives) {
      if (archive.seasonId && !seasonIds.has(archive.seasonId)) archive.seasonId = null;
      if (!Array.isArray(archive.players)) archive.players = [];
    }
    let screen = ['setup','match','club','league'].includes(input.screen) ? input.screen : 'setup';
    if (screen === 'match' && !match) screen = 'setup';
    const ui = { ...defaultState().ui, ...(input.ui || {}) };
    if (!ids.has(ui.profileId)) ui.profileId = profiles[0]?.id || null;
    if (!['setup','match','club','league'].includes(ui.returnScreen)) ui.returnScreen = 'setup';
    if (!['standings','rivals','awards'].includes(ui.leagueTab)) ui.leagueTab = 'standings';
    if (!['ALL',...Object.keys(GAMES)].includes(ui.heatmapMode)) ui.heatmapMode = 'ALL';
    if (ui.leagueSeasonId !== 'all' && !seasonIds.has(ui.leagueSeasonId)) ui.leagueSeasonId = activeSeasonId;
    ui.lastUnlocks = [];
    if (ui.returnScreen === 'match' && !match) ui.returnScreen = 'setup';
    ui.showHistory = false;ui.showCricket=false;
    if(match?.status==='finished'&&ui.pendingWinner){ui.showWinner=true;ui.pendingWinner=false;}
    return { schemaVersion:4, screen, settings, profiles, roster, archives, seasons, activeSeasonId, match, ui };
  }

  function loadState() {
    try {
      const saved = JSON.parse(readStored(STORAGE_KEY));
      if (saved) {
        const parsed = sanitiseLoaded(saved);
        if (parsed) {
          if (parsed.match?.status === 'finished' && !parsed.archives.some(a => a.id === parsed.match.id)) {
            parsed.archives.unshift(makeArchive(parsed.match, parsed.profiles));
          }
          return parsed;
        }
      }
      const previous = JSON.parse(readStored(PREVIOUS_KEY));
      if (previous) {
        const upgraded = sanitiseLoaded(previous);
        if (upgraded) return upgraded;
      }
      const legacy = JSON.parse(readStored(LEGACY_KEY));
      if (legacy && Array.isArray(legacy.roster) && legacy.roster.length >= 2) {
        const profiles = legacy.roster.map(p => ({ id: p.id || uid(), name: String(p.name || 'Player'), avatar: p.avatar || null, createdAt: Date.now() }));
        const archives = legacy.match?.status === 'finished' ? [makeArchive(legacy.match, profiles)] : [];
        const migrated = sanitiseLoaded({
          screen: legacy.screen, settings: legacy.settings, profiles, roster: profiles.map(p => p.id),
          archives, match: legacy.match,
          ui: { ...legacy.ui, showHistory: false, returnScreen: 'setup', profileId: profiles[0].id }
        });
        if (migrated) return migrated;
      }
    } catch (error) { console.warn('Saved data could not be loaded:', error); }
    return defaultState();
  }

  function save() {
    try { saveStored(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) {
      console.warn('Local storage unavailable:', error);
      toast('Storage is full. Export a backup from Player Stats before continuing.', true);
    }
  }

  function escapeHTML(input) {
    return String(input ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function metaFor(id) { return state.profiles.find(p => p.id === id) || { id, name: 'Former player', avatar: null }; }
  function validColor(c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }
  function colorFor(id) { const p=metaFor(id); const i=state.profiles.findIndex(p=>p.id===id); return validColor(p.dartColor)?p.dartColor:COLORS[Math.max(0,i)%COLORS.length]; }
  function migrateMatch(m, profiles) {
    // V3 already advanced completed turns. Preserve its current player and remaining darts.
    const fix=s=>{
      s.currentDarts=Array.isArray(s.currentDarts)?s.currentDarts:[];
      s.turnCommitted=Boolean(s.turnCommitted);
      s.turnBusted=Boolean(s.turnBusted);
      s.turnPhase=s.status==='finished'?'finished':s.turnCommitted?'handoff':'aiming';
      s.currentDarts.forEach((d,i)=>{d.id=d.id||`legacy-${s.id}-${d.at||0}-${i}`;
        d.dartColor=validColor(d.dartColor)?d.dartColor:(profiles.find(p=>p.id===s.players[s.activeIndex]?.id)?.dartColor||COLORS[0]);});
    };
    fix(m);if(!Array.isArray(m.undoStack))m.undoStack=[];m.undoStack.forEach(fix);
  }
  function effectiveMotion(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':state.settings.motion;}
  function inputReady(){return !!state.match && state.screen==='match' && state.match.status==='playing' && state.match.turnPhase==='aiming' && !flightBusy && !clearingBusy && !state.ui.showHistory && !state.ui.showCricket;}
  function cancelTransient(){
    clearTimeout(winnerTimer);clearTimeout(handoffTimer);clearTimeout(effectTimer);
    flightBusy=false;clearingBusy=false;pendingShotId=null;clearOnSync=false;
    stage?.cancelAnimations();
  }
  function displayName(id) { return metaFor(id).name || 'Player'; }
  function avatarHTML(player, index) {
    const safeAvatar = typeof player.avatar === 'string' && /^data:image\/jpeg;base64,/.test(player.avatar) ? player.avatar : null;
    if (safeAvatar) return `<img class="avatar-image" src="${safeAvatar}" alt="">`;
    const initial = (player.name || `P${index + 1}`).trim().charAt(0).toUpperCase() || '★';
    return `<span class="avatar-fallback" style="--avatar-color:${COLORS[index % COLORS.length]}">${escapeHTML(initial)}</span>`;
  }

  function logo() {
    return `<div class="brand"><div class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="34" height="34"><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="20" cy="20" r="10" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="20" cy="20" r="4.3" fill="currentColor"/><path d="M20 0v10M20 30v10M0 20h10M30 20h10" stroke="currentColor" stroke-width="2.5"/></svg>
      </div><div><div class="brand-title">DOUBLE<br>TROUBLE.</div><div class="brand-sub">THE UNOFFICIAL DARTS CLUB</div></div></div>`;
  }

  function topbar() {
    const inMatch=state.screen==='match';
    return `<header class="topbar">${logo()}<div class="top-actions">
      <span class="tiny-label save-status" id="save-status">LOCAL / AUTO SAVE</span>
      <button class="ghost-button top-league-link" data-action="${state.screen==='league'?'back-from-league':'league'}">${state.screen==='league'?'&larr; BACK':'LEAGUE'}</button>
      <button class="icon-button" data-action="sound" aria-pressed="${state.settings.sound}" title="Sound effects and player entrances">SOUND ${state.settings.sound?'ON':'OFF'}</button>
      <button class="ghost-button top-club-link" data-action="${state.screen==='club'?'back-from-club':'club'}">${state.screen==='club'?'&larr; BACK':'PLAYERS'}</button>
      ${inMatch?'<button class="ghost-button" data-action="new">NEW MATCH</button>':''}
    </div></header>`;
  }

  function sectorPath(rIn, rOut, start, end) {
    const p = (r, a) => [Math.cos(a * Math.PI / 180) * r, Math.sin(a * Math.PI / 180) * r];
    const os = p(rOut, start), oe = p(rOut, end), ie = p(rIn, end), is = p(rIn, start);
    return `M ${os[0].toFixed(3)} ${os[1].toFixed(3)} A ${rOut} ${rOut} 0 0 1 ${oe[0].toFixed(3)} ${oe[1].toFixed(3)} L ${ie[0].toFixed(3)} ${ie[1].toFixed(3)} A ${rIn} ${rIn} 0 0 0 ${is[0].toFixed(3)} ${is[1].toFixed(3)} Z`;
  }

  function boardSvg(decorative = false) {
    const wedges = [];
    const labels = [];
    const paint = [
      [18, 108, 'single-inner'], [108, 120, 'triple'],
      [120, 180, 'single-outer'], [180, 192, 'double']
    ];
    SECTORS.forEach((n, index) => {
      const center = -90 + index * 18;
      for (const [rIn, rOut, ring] of paint) {
        const fill = ring === 'triple' || ring === 'double'
          ? (index % 2 === 0 ? '#519e75' : '#ef695c')
          : (index % 2 === 0 ? '#e5e1d0' : '#262e28');
        wedges.push(`<path class="dart-sector" d="${sectorPath(rIn, rOut, center - 9, center + 9)}" fill="${fill}" stroke="#606859" stroke-width=".82" data-sector="${n}" data-ring="${ring}"/>`);
      }
      const angle = center * Math.PI / 180;
      labels.push(`<text x="${(Math.cos(angle) * 215).toFixed(2)}" y="${(Math.sin(angle) * 215).toFixed(2)}" fill="#f3eede" font-family="Arial, sans-serif" font-size="17" font-weight="900" text-anchor="middle" dominant-baseline="central" pointer-events="none">${n}</text>`);
    });
    const marks = !decorative && state.match ? state.match.currentDarts.filter(d => d.x !== null && d.y !== null && d.x !== undefined).map((d, i) => {
      const x = Number(d.x).toFixed(2), y = Number(d.y).toFixed(2);
      const label = i + 1;
      return `<g class="board-marker" transform="translate(${x},${y})"><circle r="10" stroke="#222721" stroke-width="2.4" fill="#e0fd78"/><text x="0" y="1">${label}</text></g>`;
    }).join('') : '';
    return `<svg ${decorative ? 'id="decorative-board" aria-hidden="true"' : 'id="live-board" role="img" aria-label="Clickable dartboard. Select a segment to record a dart."'} class="darts-board" viewBox="-250 -250 500 500" xmlns="http://www.w3.org/2000/svg">
      <circle r="243" fill="#0b100d" stroke="#aab6a5" stroke-width="3"/>
      <circle r="231" fill="none" stroke="#334137" stroke-width="3"/>
      <circle r="200" fill="#0d1210" stroke="#637065" stroke-width="1.5"/>
      ${wedges.join('')}
      <circle class="dart-sector" r="18" fill="#519e75" stroke="#81877c" stroke-width="1" data-sector="BULL"/>
      <circle class="dart-sector" r="7.5" fill="#ef695c" stroke="#767e71" stroke-width="1" data-sector="DBULL"/>
      ${labels.join('')}
      ${marks}
    </svg>`;
  }

  function setupScreen() {
    const options = Object.entries(GAMES).map(([value, game]) => {
      const selected = state.settings.game === value;
      return `<button type="button" class="mode ${selected ? 'is-selected' : ''}" data-action="mode" data-value="${value}" aria-pressed="${selected}">
        <span class="mode-title">${game.label}</span><span class="mode-desc">${game.desc}</span><span class="mode-check">${selected ? '↗' : '+'}</span></button>`;
    }).join('');
    const players = state.roster.map((id, index) => {
      const p = metaFor(id);
      return `<div class="player-input-row">
        <span class="roster-order">${String(index + 1).padStart(2, '0')}</span>
        <label class="avatar-upload" title="Replace photo for ${escapeHTML(p.name)}">
          ${avatarHTML(p, state.profiles.findIndex(x => x.id === p.id))}<span class="avatar-plus" aria-hidden="true">+</span>
          <input type="file" accept="image/*" data-avatar-input="${escapeHTML(p.id)}" aria-label="Upload a photo for ${escapeHTML(p.name)}">
        </label>
        <label class="sr-only" for="player-name-${index}">Player ${index + 1} name</label>
        <input id="player-name-${index}" class="name-input" type="text" maxlength="24" spellcheck="false" autocomplete="off" data-player-name="${escapeHTML(p.id)}" value="${escapeHTML(p.name)}" placeholder="Player ${index + 1}">
        <label class="dart-color-well" title="Choose dart color for ${escapeHTML(p.name)}"><input type="color" value="${colorFor(p.id)}" data-dart-color="${escapeHTML(p.id)}" aria-label="Dart color for ${escapeHTML(p.name)}"><span>DART</span></label>
        <button type="button" class="remove-player" data-action="remove-player" data-id="${escapeHTML(p.id)}" title="Remove from this match, keep profile" aria-label="Remove ${escapeHTML(p.name)} from the lineup" ${state.roster.length <= 2 ? 'disabled' : ''}>×</button>
      </div>`;
    }).join('');
    const waiting = state.profiles.filter(p => !state.roster.includes(p.id));
    const bench = waiting.length ? `<div class="bench-wrap"><span class="mini-caption">ON THE BENCH · TAP TO ADD</span><div class="bench-list">${waiting.map(p => `<button type="button" class="bench-player" data-action="join-roster" data-id="${escapeHTML(p.id)}" ${state.roster.length >= 8 ? 'disabled' : ''}>
      <span class="bench-avatar">${avatarHTML(p, state.profiles.findIndex(x=>x.id === p.id))}</span><span>${escapeHTML(p.name)}</span><b>+</b></button>`).join('')}</div></div>` : '';
    const is01 = ['301', '501'].includes(state.settings.game);
    const extra = is01
      ? `<div class="rules-row"><div><div class="rules-text">DOUBLE-OUT RULE</div><div class="rules-help">Finish on a double to win.</div></div><button class="toggle" type="button" data-action="double-out" aria-label="Toggle double out" aria-pressed="${state.settings.doubleOut}"><span class="knob"></span></button></div>`
      : state.settings.game === 'COUNTUP'
      ? `<div class="rules-row"><div><div class="rules-text">NUMBER OF ROUNDS</div><div class="rules-help">Three darts per round.</div></div><select class="select-mini" id="rounds" aria-label="Number of rounds">${[3,5,8,10,15,20].map(n => `<option value="${n}" ${state.settings.countUpRounds === n ? 'selected' : ''}>${n} ROUNDS</option>`).join('')}</select></div>`
      : `<div class="rules-row"><div><div class="rules-text">STANDARD CRICKET</div><div class="rules-help">Close 15–20 and bull; earn bonus points.</div></div><span class="pill">15–20 + B</span></div>`;
    return `<main class="setup-layout">
      <section class="setup-intro" aria-label="Welcome">
        <div class="pill"><span class="pill-dot"></span> PRECISION CLUB MACHINE / 04</div>
        <h1 class="hero-title"><span>YOUR</span><span class="outline-word">THROW.</span></h1>
        <p class="hero-copy">Same crew. New grudges. <b>Click where the dart landed</b> and let the board keep score, forever.</p>
        <div class="deco-field" aria-hidden="true"><div class="deco-sticker">STEEL TIP<br>CLUB<br>EDITION</div><div class="deco-board">${boardSvg(true)}</div><span class="deco-spark">✳</span></div>
        <div class="intro-link-group"><button type="button" class="intro-stats-link" data-action="club"><span>★</span> ${state.archives.length} MATCHES IN CLUB ARCHIVE <span>↗</span></button>
        <button type="button" class="intro-stats-link intro-league-link" data-action="league"><span>♛</span> VIEW LEAGUE TABLE <span>↗</span></button></div>
      </section>
      <section class="setup-card" aria-label="Match setup">
        <div class="card-head"><div class="panel-label">PRE-GAME ADMINISTRATION / NO PAPERWORK</div><h2>SET THE STAGE.</h2></div>
        <div class="section-head"><span class="panel-label"><span class="section-index">01 /</span> CHOOSE YOUR GAME</span></div>
        <div class="modes">${options}</div>${extra}
        <div class="season-picker-row"><span><b>SEASON</b><small>Every completed game counts toward its season.</small></span>
          <select class="select-mini" id="active-season" aria-label="Season for next match">${state.seasons.filter(s=>!s.endedAt).map(s=>`<option value="${escapeHTML(s.id)}" ${state.activeSeasonId===s.id?'selected':''}>${escapeHTML(s.name)}</option>`).join('')}</select>
          <button type="button" class="tiny-link" data-action="league">MANAGE ↗</button></div>
        <div class="sep"></div>
        <div class="section-head"><span class="panel-label"><span class="section-index">02 /</span> PICK YOUR CREW</span><span class="panel-label">${state.roster.length} / 8 PLAYING</span></div>
        <div class="player-list">${players}</div>
        ${bench}
        <button class="add-player" type="button" data-action="add-player" ${state.roster.length >= 8 ? 'disabled' : ''}>+ CREATE &amp; SELECT SAVED PLAYER</button>
        <div class="setup-bottom"><button class="action-button full-width" type="button" data-action="start" ${state.roster.length < 2 ? 'disabled' : ''}><span>${state.roster.length < 2 ? 'SELECT AT LEAST 2 PLAYERS' : 'START MATCH'}</span><span aria-hidden="true">↗</span></button>
          <div class="setup-footer-row"><span>EVERY PLAYER IS SAVED AUTOMATICALLY.</span><button type="button" data-action="club" class="tiny-link">PLAYER STATS ↗</button></div>
        </div>
      </section>
    </main>`;
  }

  function shortModeName(game) { return game === 'COUNTUP' ? 'COUNT UP' : game; }
  function scoreLabel(game) { return game === '301' || game === '501' ? 'LEFT' : 'PTS'; }
  function playerCard(player, index) {
    const active = state.match.activeIndex === index && state.match.status === 'playing';
    const winner = state.match.winnerIds.includes(player.id);
    const p = metaFor(player.id);
    return `<article class="player-card ${active ? 'is-active' : ''} ${winner ? 'is-winner' : ''}">
      <div>${avatarHTML(p, state.profiles.findIndex(x => x.id === p.id))}</div>
      <div class="player-card-top"><div class="player-card-name" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
        <div class="player-card-status">${winner ? '★ CHAMPION' : active ? '● THROWING NOW' : `TURN ${player.turns + 1} NEXT`}</div>
        <div><span class="player-score">${player.score}</span><span class="player-score-label">${scoreLabel(state.match.game)}</span></div>
      </div></article>`;
  }

  function cricketTable() {
    const m = state.match;
    return `<section class="cricket-section"><div class="sep"></div><span class="panel-label">CLOSURE TRACKER</span>
      <div class="cricket-table-wrap"><table class="cricket-table" aria-label="Cricket marks">
        <thead><tr><th>HIT</th>${m.players.map(p => `<th title="${escapeHTML(displayName(p.id))}">${escapeHTML(displayName(p.id).slice(0, 5))}</th>`).join('')}</tr></thead>
        <tbody>${CRICKET_TARGETS.map(target => `<tr><td>${target === 25 ? 'BULL' : target}</td>${m.players.map(p => {
          const count = Math.min(p.marks[target] || 0, 3);
          return `<td class="cricket-marks ${count === 3 ? 'closed' : ''}" aria-label="${count} of 3 marks">${'●'.repeat(count)}${'○'.repeat(3 - count)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div><div class="score-key">● Mark earned &nbsp; ○ Mark remaining. Three marks close the target.</div></section>`;
  }

  function historyHTML() {
    const m = state.match;
    if (!m.history.length) return `<div class="history-empty">Not a single dart yet. The suspense is unbearable.</div>`;
    return m.history.slice(0, 14).map(entry => {
      const shotText = entry.shots.map(x => x.label).join('  ·  ') || 'SKIPPED';
      return `<div class="history-entry"><div class="history-entry-top"><span class="history-player">${escapeHTML(displayName(entry.playerId))}</span><span class="history-total ${entry.bust ? 'is-bust' : ''}">${entry.bust ? 'BUST' : `+${entry.total}`}</span></div><div class="history-sub">R${entry.round} &nbsp; ${escapeHTML(shotText)} ${m.game === '501' || m.game === '301' ? `&nbsp; / &nbsp; ${entry.after} LEFT` : ''}</div></div>`;
    }).join('');
  }

  function lastHitHTML() {
    const hit = state.match.lastHit;
    let label = 'READY?', caption = 'First dart has entered the chat.', kicker = 'LAST THROW / NO PRESSURE';
    if (hit) {
      label = hit.bust ? 'BUST!' : hit.label;
      caption = hit.note || (hit.score ? `${hit.score} raw dart points` : 'Zero points. Character building.');
      kicker = `${escapeHTML(displayName(hit.playerId)).toUpperCase()} / MOST RECENT`;
    }
    return `<div class="last-hit-card"><div class="last-hit-kicker">${kicker}</div><div class="last-hit-value">${escapeHTML(label)}</div><div class="last-hit-caption">${escapeHTML(caption)}</div></div>`;
  }

  function headerV4(){
    const m=state.match,season=state.seasons.find(s=>s.id===m.seasonId)?.name||'Club match';
    return `<div class="instrument-title"><span class="hardware-label">MATCH DAY / CLUB 04</span><h1>${shortModeName(m.game)}<span>${m.status==='finished'?'FINAL SCORE':'LIVE MATCH'}</span></h1></div>
      <div class="instrument-meta"><span><small>SEASON</small>${escapeHTML(season)}</span><span><small>ROUND</small>${String(m.round).padStart(2,'0')}${m.game==='COUNTUP'?' / '+m.countUpRounds:''}</span><span><small>RULES</small>${['301','501'].includes(m.game)?m.doubleOut?'DOUBLE OUT':'STRAIGHT OUT':m.game==='CRICKET'?'STANDARD':'HIGH SCORE'}</span></div>`;
  }
  function rackV4(){
    const m=state.match;
    return `<div class="hardware-label rack-label">PLAYER RACK <span>${String(m.players.length).padStart(2,'0')}</span></div><div class="rack-players ${m.players.length>4?'dense':''}" style="--players:${m.players.length}">${m.players.map((p,i)=>{
      const active=m.activeIndex===i,winner=m.winnerIds.includes(p.id),person=metaFor(p.id);
      return `<article class="score-module ${active&&m.status==='playing'?'active':''} ${winner?'champion':''}" style="--player-color:${colorFor(p.id)}">
        <div class="module-portrait">${avatarHTML(person,i)}</div><div class="module-person"><strong>${escapeHTML(person.name)}</strong><span><i></i>${winner?'MATCH WINNER':active?(m.turnPhase==='handoff'?'TURN COMPLETE':'AT THE OCHE'):'STANDING BY'}</span></div>
        <div class="module-score"><b>${p.score}</b><small>${scoreLabel(m.game)}</small></div></article>`;
    }).join('')}</div><div class="rack-foot"><span class="hardware-label">HOUSE RULES</span><p>${GAMES[m.game].hint}</p><span class="key-help"><kbd>Z</kbd> Undo &nbsp; <kbd>N</kbd> Next player</span></div>`;
  }
  function controlV4(){
    const m=state.match,p=m.players[m.activeIndex],incoming=m.players[(m.activeIndex+1)%m.players.length];
    const ready=m.status==='playing'&&m.turnPhase==='handoff'&&!flightBusy&&!clearingBusy;
    const total=m.turnBusted?0:Math.max(0,['301','501'].includes(m.game)?m.turnStartScore-p.score:p.score-m.turnStartScore);
    const status=m.status==='finished'?'MATCH COMPLETE':clearingBusy?'CLEARING THE BOARD':flightBusy?'DART IN FLIGHT':m.turnBusted?'BUST / TURN ENDED':m.turnPhase==='handoff'?'TURN COMPLETE':`${3-m.currentDarts.length} DART${3-m.currentDarts.length===1?'':'S'} REMAIN`;
    return `<div class="control-top"><span class="hardware-label">CURRENT VISIT</span><div class="visit-display ${m.turnBusted?'busted':''}"><small>${m.turnBusted?'BUST':'POINTS'}</small><b>${String(total).padStart(3,'0')}</b></div></div>
      <div class="throw-register"><span class="hardware-label">THREE DART REGISTER</span><div class="register-slots">${[0,1,2].map(i=>{const d=m.currentDarts[i];return `<div class="register-slot ${d?'used':''}" style="--dart-color:${d?.dartColor||colorFor(p.id)}"><i></i><small>0${i+1}</small><b>${d?escapeHTML(d.label.replace('BULL ','B')):'&mdash;'}</b><span>${d?d.score+' PTS':'READY'}</span></div>`;}).join('')}</div></div>
      <div class="turn-status ${ready?'complete':''}" role="status" aria-live="polite"><i></i>${status}</div>
      <div class="last-readout"><span class="hardware-label">LAST IMPACT</span><b>${m.lastHit?escapeHTML(m.lastHit.bust?'BUST':m.lastHit.label):'AWAITING THROW'}</b><p>${m.lastHit?escapeHTML(m.lastHit.note):'Click the matching point on the board. Click the surround to record a miss.'}</p></div>
      <div class="controls-bottom"><div class="small-controls"><button class="hardware-button" data-action="undo" ${!m.undoStack.length?'disabled':''}>UNDO <span>&#8630;</span></button><button class="hardware-button" data-action="history">LOG <span>&#8599;</span></button>${m.game==='CRICKET'?'<button class="hardware-button" data-action="cricket-marks">MARKS</button>':''}</div>
        <button class="handoff-button ${ready?'armed':''}" data-action="end-turn" ${!ready?'disabled':''} aria-label="${ready?'Next player, '+escapeHTML(displayName(incoming.id)):'Next player. Complete this turn first.'}"><span class="handoff-led"></span><span class="handoff-copy"><small>${m.status==='finished'?'RESULT RECORDED':ready?'READY TO HAND OVER':'COMPLETE YOUR TURN'}</small><b>NEXT PLAYER</b><span>${escapeHTML(displayName(incoming.id))}</span></span><span class="handoff-arrow">&rarr;</span></button>
      </div>`;
  }
  function matchScreen() {
    const m=state.match;
    return `<main class="v4-match" id="v4-match" data-match-id="${escapeHTML(m.id)}"><header class="instrument-header" id="v4-header">${headerV4()}</header>
      <div class="instrument-body"><aside class="hardware-panel player-rack" id="score-rack">${rackV4()}</aside>
        <section class="hardware-panel board-assembly"><div class="stage-label"><div><i class="live-led"></i><span id="stage-player">${escapeHTML(displayName(m.players[m.activeIndex].id))}</span><small>/ AT THE OCHE</small></div><span id="renderer-label">3D / LOCAL</span></div>
          <div id="stage-mount" class="stage-mount"><div class="stage-event" id="stage-event" aria-live="polite"></div><div class="surround-label">CLICK SURROUND = MISS</div></div>
          <div class="aim-readout"><span class="hardware-label">TARGET</span><span id="hover-value">POINT TO THE IMPACT</span><span class="hardware-label input-lamp" id="input-lamp">INPUT READY</span></div>
          <div class="stage-settings"><span>STEEL TIP / SISAL 01</span><div><label>MOTION <select id="motion-mode" aria-label="Dart animation speed">${[['realistic','REALISTIC'],['quick','QUICK'],['reduced','REDUCED']].map(([id,l])=>`<option value="${id}" ${state.settings.motion===id?'selected':''}>${l}</option>`).join('')}</select></label><button data-action="quality" title="High: sharper image. Eco: lower rendering resolution.">${state.settings.quality==='eco'?'ECO':'HIGH'} QUALITY</button></div></div>
        </section><aside class="hardware-panel visit-console" id="control-stack">${controlV4()}</aside></div>
      <div class="instrument-foot"><span>PICK YOUR SPOT. <b>WE KEEP SCORE.</b></span><span>THE GOOD KIND OF COMPETITION</span></div></main>`;
  }
  function dartConfig(p){
    const col=colorFor(p.id);
    return `<section class="dart-config" style="--dart-color:${col}"><div class="dart-config-title"><span class="hardware-label">PLAYER EQUIPMENT</span><strong>YOUR DARTS.</strong><span>Flight color is saved with this player.</span></div>
      <div class="equipment-dart" aria-hidden="true"><i class="equip-point"></i><i class="equip-barrel"></i><i class="equip-shaft"></i><i class="equip-flight"></i></div>
      <div class="equipment-colors"><div class="dart-swatches" role="group" aria-label="Dart flight color">${COLORS.map(c=>`<button type="button" data-action="dart-color" data-id="${escapeHTML(p.id)}" data-color="${c}" class="dart-swatch ${col.toLowerCase()===c?'selected':''}" style="--swatch:${c}" aria-label="Use ${c} darts" aria-pressed="${col.toLowerCase()===c}"></button>`).join('')}</div>
      <label class="custom-dart-color"><input type="color" data-dart-color="${escapeHTML(p.id)}" value="${col}" aria-label="Custom dart color"> CUSTOM <span>${col.toUpperCase()}</span></label></div></section>`;
  }

  function makeArchive(match, profiles) {
    const is01 = ['301', '501'].includes(match.game);
    const person = id => profiles.find(p => p.id === id) || { name: 'Player' };
    return {
      id: match.id, game: match.game, seasonId:match.seasonId || null, startedAt: match.startedAt, endedAt: match.endedAt || Date.now(),
      winnerIds: [...match.winnerIds], rounds: match.round,
      players: match.players.map(p => {
        const turns = (match.history || []).filter(h => h.playerId === p.id);
        const shots = turns.flatMap(t => t.shots || []);
        return {
          id: p.id, name: person(p.id).name, result: match.winnerIds.includes(p.id) ? (match.winnerIds.length > 1 ? 'draw' : 'win') : 'loss',
          finalScore: p.score, turns: p.turns, darts: p.dartsThrown || shots.length,
          scored: turns.reduce((sum, t) => sum + (t.total || 0), 0),
          bestVisit: Math.max(0, ...turns.map(t => t.total || 0)),
          visits100: is01 ? turns.filter(t => t.total >= 100).length : 0,
          visits180: is01 ? turns.filter(t => t.total === 180).length : 0,
          bulls: shots.filter(s => s.base === 25 && s.multiplier === 2).length,
          outerBulls: shots.filter(s => s.base === 25 && s.multiplier === 1).length,
          misses: shots.filter(s => s.label === 'MISS').length,
          triples: shots.filter(s => s.multiplier === 3).length,
          doubles: shots.filter(s => s.multiplier === 2).length,
          // Compact historical coordinates. Outside-board misses keep coordinates; unknown bounce-outs use null.
          hits: shots.map(s => [Number.isFinite(s.x)?Math.round(s.x*10)/10:null,
                                 Number.isFinite(s.y)?Math.round(s.y*10)/10:null,
                                 Number(s.base)||0,Number(s.multiplier)||0])
        };
      })
    };
  }

  function statsFor(id, game = null) {
    const matches = state.archives.filter(m => !game || m.game === game);
    const rows = matches.map(m => ({ game: m.game, date: m.endedAt, ...(m.players.find(p => p.id === id) || {}) }))
      .filter(p => p.id === id);
    const sum = key => rows.reduce((a, b) => a + (Number(b[key]) || 0), 0);
    const darts01 = rows.filter(p => p.game === '301' || p.game === '501');
    const points01 = darts01.reduce((a, b) => a + (b.scored || 0), 0);
    const thrown01 = darts01.reduce((a, b) => a + (b.darts || 0), 0);
    return {
      played: rows.length, wins: rows.filter(p => p.result === 'win').length,
      draws: rows.filter(p => p.result === 'draw').length,
      losses: rows.filter(p => p.result === 'loss').length,
      darts: sum('darts'), scored: sum('scored'), bulls: sum('bulls'), outerBulls: sum('outerBulls'), triples:sum('triples'), misses:sum('misses'),
      visits180: sum('visits180'), visits100: sum('visits100'),
      bestVisit: Math.max(0, ...rows.map(p => p.bestVisit || 0)),
      avg01: thrown01 ? (points01 * 3 / thrown01) : null,
      winPct: rows.length ? (rows.filter(p => p.result === 'win').length / rows.length * 100) : 0,
      longestStreak: longestStreak(rows), comeback: hadComeback(rows), rivalWins:bestRivalWins(id, matches)
    };
  }

  // Lifetime performance, derived only from completed/archived matches.
  function longestStreak(rows) {
    let current = 0, best = 0;
    for (const row of [...rows].sort((a,b)=>a.date-b.date)) {
      current = row.result === 'win' ? current + 1 : 0;
      best = Math.max(best,current);
    }
    return best;
  }
  function hadComeback(rows) {
    let losses = 0;
    for (const row of [...rows].sort((a,b)=>a.date-b.date)) {
      if (row.result === 'win' && losses >= 3) return true;
      losses = row.result === 'loss' ? losses + 1 : 0;
    }
    return false;
  }
  function bestRivalWins(id, matches) {
    const counts = new Map();
    for (const match of matches) {
      if (!(match.winnerIds || []).includes(id) || match.winnerIds.length !== 1) continue;
      if (!match.players.some(p=>p.id===id)) continue;
      for (const other of match.players) if (other.id !== id)
        counts.set(other.id,(counts.get(other.id)||0)+1);
    }
    return Math.max(0,...counts.values());
  }
  function earnedAchievements(id) {
    const s = statsFor(id);
    return ACHIEVEMENTS.filter(a=>a.check(s));
  }
  function achievementSection(id) {
    const earned = new Set(earnedAchievements(id).map(a=>a.id));
    return `<div class="club-subheads"><h3>TROPHY CABINET <span>↘</span></h3><span class="mini-caption">${earned.size} / ${ACHIEVEMENTS.length} UNLOCKED</span></div>
      <div class="badge-grid">${ACHIEVEMENTS.map(a=>{
        const got = earned.has(a.id);
        return `<div class="award-badge ${got?'unlocked':'locked'}" title="${escapeHTML(a.desc)}">
          <span class="award-mark">${escapeHTML(a.icon)}</span><div><strong>${escapeHTML(a.name)}</strong><small>${escapeHTML(a.desc)}</small></div>
          <span class="award-status">${got?'✓':'○'}</span></div>`;
      }).join('')}</div>`;
  }
  function getHitPositions(id, game='ALL') {
    return state.archives.filter(a=>game==='ALL'||a.game===game)
      .flatMap(a=>(a.players.find(p=>p.id===id)?.hits||[]))
      .filter(h=>Array.isArray(h)&&Number.isFinite(h[0])&&Number.isFinite(h[1])&&Math.hypot(h[0],h[1])<=192);
  }
  function heatmapSection(id) {
    const hits = getHitPositions(id,state.ui.heatmapMode);
    const histogram = new Map();
    for (const hit of hits) if (hit[2]>0 && hit[2]!==25) histogram.set(hit[2],(histogram.get(hit[2])||0)+1);
    const top = [...histogram].sort((a,b)=>b[1]-a[1])[0];
    const bulls = hits.filter(h=>h[2]===25&&h[3]===2).length;
    const historic = state.archives.some(a=>a.players.some(p=>p.id===id));
    return `<div class="club-subheads"><h3>DART HEATMAP <span>↘</span></h3><select id="heatmap-mode" class="select-mini" aria-label="Filter heatmap by game"><option value="ALL" ${state.ui.heatmapMode==='ALL'?'selected':''}>ALL GAMES</option>
        ${Object.keys(GAMES).map(key=>`<option value="${key}" ${state.ui.heatmapMode===key?'selected':''}>${escapeHTML(GAMES[key].label)}</option>`).join('')}</select></div>
      <div class="heatmap-panel"><div class="heatmap-board">${boardSvg(true)}<canvas id="heatmap-canvas" width="350" height="350" aria-label="Heatmap of recorded dart hit positions"></canvas></div>
        <div class="heatmap-summary"><div class="heatmap-label">WHERE YOUR DARTS ACTUALLY LANDED</div>
          <div class="heatmap-big">${hits.length}<span> RECORDED HITS</span></div>
          <div class="heatmap-facts"><div><strong>${top?top[0]:'—'}</strong><small>MOST HIT NUMBER</small></div><div><strong>${bulls}</strong><small>INNER BULLS</small></div><div><strong>${hits.length ? Math.round(hits.filter(h=>h[3]>=2).length/hits.length*100)+'%' : '—'}</strong><small>DOUBLE / TRIPLE</small></div></div>
          <p>${hits.length ? 'Brighter areas show where more darts landed. Coordinates include busted throws and are collected from finished matches.' : historic ? 'This profile has match results but no stored aim coordinates yet. Heatmap tracking begins with V3 games.' : 'Finish a game to start collecting impact positions automatically.'}</p>
          <div class="heatmap-legend"><span>LOW FREQUENCY</span><i></i><span>HIGH FREQUENCY</span></div>
        </div></div>`;
  }
  function drawHeatmap() {
    const canvas = document.getElementById('heatmap-canvas');
    if (!canvas) return;
    const selectedId = state.ui.profileId || state.profiles[0]?.id;
    const hits = getHitPositions(selectedId,state.ui.heatmapMode);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    if (!hits.length) return;
    // Density kernel avoids a separate SVG element per dart and stays fast after hundreds of games.
    const density = new Float32Array(w*h);
    const radius=12, sigma=5.8, inv=1/(2*sigma*sigma);
    for (const [bx,by] of hits) {
      const cx=Math.round((bx+250)*w/500), cy=Math.round((by+250)*h/500);
      for(let y=Math.max(0,cy-radius);y<=Math.min(h-1,cy+radius);y++) {
        const row=y*w, dy=y-cy;
        for(let x=Math.max(0,cx-radius);x<=Math.min(w-1,cx+radius);x++) {
          const d2=(x-cx)*(x-cx)+dy*dy;
          if(d2<=radius*radius) density[row+x]+=Math.exp(-d2*inv);
        }
      }
    }
    let max=0;
    for (let i=0;i<density.length;i++) max=Math.max(max,density[i]);
    const image=ctx.createImageData(w,h);
    for(let i=0;i<density.length;i++) {
      const t=Math.min(1, Math.pow(density[i]/Math.max(1,max*.77),.65));
      if(t<.035) continue;
      const j=i*4;
      // Cool lime → peach → saturated orange for dense impact clusters.
      const blend=Math.min(1,Math.max(0,(t-.43)/.57));
      image.data[j]=Math.round(193+62*blend);
      image.data[j+1]=Math.round(251-118*blend);
      image.data[j+2]=Math.round(120-35*blend);
      image.data[j+3]=Math.round(237*Math.min(1,t*1.18));
    }
    ctx.putImageData(image,0,0);
  }

  // Head-to-head is a win only when A won and B did not (or vice versa).
  // If a third person wins, that meeting has no 1v1 decision.
  function rivalryRecords(archives) {
    const pairs = new Map();
    for (const match of archives) {
      const ids=[...new Set(match.players.map(p=>p.id))].sort();
      for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++) {
        const a=ids[i], b=ids[j], key=a+'::'+b;
        const pair=pairs.get(key)||{a,b,meetings:0,winsA:0,winsB:0,ties:0,noDecision:0,mostRecent:0};
        pair.meetings++;
        const aWon=match.winnerIds.includes(a), bWon=match.winnerIds.includes(b);
        if(aWon&&!bWon) pair.winsA++;
        else if(bWon&&!aWon) pair.winsB++;
        else if(aWon&&bWon) pair.ties++;
        else pair.noDecision++;
        pair.mostRecent=Math.max(pair.mostRecent, match.endedAt||0);
        pairs.set(key,pair);
      }
    }
    return [...pairs.values()].sort((a,b)=>b.meetings-a.meetings || (b.winsA+b.winsB)-(a.winsA+a.winsB));
  }
  function leagueArchives() {
    const seasonId=state.ui.leagueSeasonId||state.activeSeasonId;
    return seasonId==='all' ? state.archives : state.archives.filter(a=>a.seasonId===seasonId);
  }
  function standingsFor(archives) {
    return state.profiles.map(player=>{
      const rows=archives.flatMap(m=>m.players.filter(p=>p.id===player.id).map(p=>({...p,game:m.game})));
      const wins=rows.filter(p=>p.result==='win').length;
      const draws=rows.filter(p=>p.result==='draw').length;
      const scored01=rows.filter(p=>['301','501'].includes(p.game));
      const d=scored01.reduce((n,p)=>n+(p.darts||0),0);
      const pts=scored01.reduce((n,p)=>n+(p.scored||0),0);
      return {id:player.id, name:player.name, played:rows.length,wins,draws, losses:rows.length-wins-draws,
        points:wins*3+draws, bulls:rows.reduce((n,p)=>n+(p.bulls||0),0),
        average:d?pts*3/d:null};
    }).sort((a,b)=>b.points-a.points || b.wins-a.wins || b.played-a.played || a.name.localeCompare(b.name));
  }
  function loserOfNight(at=Date.now()) {
    const today = new Date(at).toDateString();
    const archive = state.archives.filter(m => m.endedAt && new Date(m.endedAt).toDateString() === today);
    if (archive.length < 2) return null;
    const results = new Map();
    for (const match of archive) for (const p of match.players) {
      if (!state.profiles.some(q=>q.id===p.id)) continue;
      const r = results.get(p.id) || {id:p.id,played:0,wins:0,losses:0,misses:0};
      r.played++;
      if (p.result === 'win') r.wins++;
      else if (p.result === 'loss') r.losses++;
      r.misses += Number(p.misses)||0;
      results.set(p.id,r);
    }
    const candidates = [...results.values()].filter(r => r.played >= 2 && r.losses > 0);
    candidates.sort((a,b) => b.losses / b.played - a.losses / a.played ||
      b.losses-a.losses || a.wins-b.wins || b.misses-a.misses || a.id.localeCompare(b.id));
    return candidates[0] || null;
  }
  function currentWinStreak(id) {
    let streak=0;
    const recent=[...state.archives].filter(m=>m.players.some(p=>p.id===id)).sort((a,b)=>b.endedAt-a.endedAt);
    for (const match of recent) {
      if (match.players.find(p=>p.id===id)?.result !== 'win') break;
      streak++;
    }
    return streak;
  }

  function leagueScreen() {
    const scope=state.ui.leagueSeasonId||state.activeSeasonId;
    const archive=leagueArchives();
    const standings=standingsFor(archive);
    const rivals=rivalryRecords(archive);
    const tab=state.ui.leagueTab;
    const loser = loserOfNight();
    const allAwards=state.profiles.map(p=>({...p,badges:earnedAchievements(p.id)}))
      .filter(p=>p.badges.length).sort((a,b)=>b.badges.length-a.badges.length);
    const filters=`<select id="league-season" class="select-mini league-season-select" aria-label="Season leaderboard">
      <option value="all" ${scope==='all'?'selected':''}>ALL TIME</option>
      ${state.seasons.map(s=>`<option value="${escapeHTML(s.id)}" ${scope===s.id?'selected':''}>${escapeHTML(s.name)}${s.endedAt?' · FINISHED':''}</option>`).join('')}</select>`;
    const standingsView=`<div class="league-overview"><div><small>MATCHES ON RECORD</small><strong>${archive.length}</strong></div>
      <div><small>REGISTERED PLAYERS</small><strong>${state.profiles.length}</strong></div>
      <div><small>LEADING PLAYER</small><strong class="league-leader">${escapeHTML(standings[0]?.played?standings[0].name:'NO ONE YET')}</strong></div></div>
      <div class="league-table-scroll"><table class="league-table"><thead><tr><th>RANK / PLAYER</th><th>PLAYED</th><th>W</th><th>D</th><th>L</th><th>PTS</th><th>3-DART AVG</th><th>BULLS</th></tr></thead>
      <tbody>${standings.map((p,i)=>`<tr><td><button data-action="player-from-league" data-id="${escapeHTML(p.id)}" class="standings-player"><span class="standings-rank ${i===0?'first':''}">${String(i+1).padStart(2,'0')}</span><span class="standings-avatar">${avatarHTML(metaFor(p.id),state.profiles.findIndex(q=>q.id===p.id))}</span><b>${escapeHTML(p.name)}</b></button></td>
        <td>${p.played}</td><td>${p.wins}</td><td>${p.draws}</td><td>${p.losses}</td><td class="league-points">${p.points}</td><td>${p.average===null?'—':p.average.toFixed(1)}</td><td>${p.bulls}</td></tr>`).join('')}</tbody></table></div>
        <p class="league-fineprint">POINTS: WIN = 3 · TIE = 1 · LOSS = 0. 3-DART AVG USES COMPLETED 301/501 MATCHES.</p>`;
    const rivalsView=`<div class="rival-summary"><strong>${rivals.length}</strong><span>ACTIVE RIVALRIES</span><p>Every shared match counts as a meeting. A head-to-head win is credited only when one rival is the actual winner. Third-party victories remain undecided.</p></div>
      <div class="rivals-list">${rivals.map((r,i)=>`<div class="rivalry-row"><div class="rivalry-index">${String(i+1).padStart(2,'0')}</div>
      <div class="rival-person"><div class="rival-avatar">${avatarHTML(metaFor(r.a),state.profiles.findIndex(p=>p.id===r.a))}</div><b>${escapeHTML(displayName(r.a))}</b></div>
      <div class="rival-score"><span>${r.winsA}</span><small>–</small><span>${r.winsB}</span><div>${r.meetings} MEETINGS · ${r.ties} TIES${r.noDecision?` · ${r.noDecision} UNDECIDED`:''}</div></div>
      <div class="rival-person right"><div class="rival-avatar">${avatarHTML(metaFor(r.b),state.profiles.findIndex(p=>p.id===r.b))}</div><b>${escapeHTML(displayName(r.b))}</b></div></div>`).join('')||'<p class="league-empty">Finish a game together to start a rivalry. Grudges need data.</p>'}</div>`;
    const nightlyView=loser
      ? `<div class="nightly-award"><div class="nightly-label">☹ TODAY'S VERY SPECIAL AWARD</div><div class="nightly-hero"><span class="nightly-avatar">${avatarHTML(metaFor(loser.id),state.profiles.findIndex(p=>p.id===loser.id))}</span><div><strong>LOSER OF THE NIGHT.</strong><span>${escapeHTML(displayName(loser.id))} · ${loser.losses} losses across ${loser.played} matches. An unforgettable performance, for all the wrong reasons.</span></div></div></div>`
      : `<div class="nightly-award nightly-pending"><div class="nightly-label">☹ LOSER OF THE NIGHT</div><p>Play at least two matches tonight. Someone will earn the dubious honour.</p></div>`;
    const awardsView=`<div class="awards-banner"><div><span class="eyebrow">UNOFFICIAL HONOURS</span><h3>THE WALL OF SHAME. <span>AND FAME.</span></h3></div><b>${allAwards.reduce((n,p)=>n+p.badges.length,0)} BADGES EARNED</b></div>
      ${nightlyView}
      <div class="league-award-list">${allAwards.map(p=>`<section class="league-award-person"><button type="button" data-action="player-from-league" data-id="${escapeHTML(p.id)}" class="league-award-head"><span class="standings-avatar">${avatarHTML(p,state.profiles.findIndex(q=>q.id===p.id))}</span><strong>${escapeHTML(p.name)}</strong><small>${p.badges.length} / ${ACHIEVEMENTS.length} UNLOCKED</small></button>
        <div class="league-award-pills">${p.badges.map(a=>`<span title="${escapeHTML(a.desc)}"><b>${escapeHTML(a.icon)}</b>${escapeHTML(a.name)}</span>`).join('')}</div></section>`).join('')||'<p class="league-empty">Win a match, land a bullseye, or hit a hundred-point visit to unlock awards.</p>'}</div>`;
    return `<main class="league-page"><header class="league-heading"><div><div class="eyebrow">✳ THE VERY UNOFFICIAL CHAMPIONSHIP</div>
      <h1>THE <span>LEAGUE.</span></h1><p>Lifetime grudges, seasonal glory and ridiculous little trophies.</p></div>
      <div class="league-controls"><span class="mini-caption">VIEWING</span>${filters}<button type="button" data-action="rename-season" class="outline-button" ${scope==='all'?'disabled':''}>RENAME</button><button type="button" data-action="new-season" class="action-button league-new">+ NEW SEASON</button></div></header>
      <div class="league-tabs" role="tablist" aria-label="League sections">${[['standings','↗ STANDINGS'],['rivals','⚔ RIVALRIES'],['awards','★ ACHIEVEMENTS']].map(([id,title])=>`<button type="button" role="tab" aria-selected="${tab===id}" class="league-tab ${tab===id?'current':''}" data-action="league-tab" data-value="${id}">${title}</button>`).join('')}</div>
      <section class="league-content pane">${tab==='standings'?standingsView:tab==='rivals'?rivalsView:awardsView}</section>
      <div class="league-bottom"><span>EVERY FINISHED MATCH IS COUNTED AUTOMATICALLY.</span><span>SEASON: ${escapeHTML(state.seasons.find(s=>s.id===state.activeSeasonId)?.name||'NONE')} · ${archive.length} ARCHIVED MATCHES</span></div></main>`;
  }

  function statTile(value, label, hint = '') {
    return `<div class="stat-tile"><strong>${escapeHTML(value)}</strong><span>${escapeHTML(label)}</span>${hint ? `<small>${escapeHTML(hint)}</small>` : ''}</div>`;
  }

  function clubScreen() {
    const selected = state.profiles.find(p => p.id === state.ui.profileId) || state.profiles[0];
    const people = [...state.profiles].sort((a, b) => statsFor(b.id).wins - statsFor(a.id).wins || statsFor(b.id).played - statsFor(a.id).played);
    const listing = people.map((p, i) => {
      const s = statsFor(p.id);
      const active = selected && selected.id === p.id;
      const playing = state.roster.includes(p.id);
      return `<button type="button" class="club-player ${active ? 'selected' : ''}" data-action="select-profile" data-id="${escapeHTML(p.id)}">
        <div class="club-ranking">${String(i + 1).padStart(2, '0')}</div><div class="club-avatar">${avatarHTML(p, state.profiles.findIndex(q => q.id === p.id))}</div>
        <span class="club-player-name">${escapeHTML(p.name)}<small>${playing ? '● SELECTED FOR NEXT MATCH' : '○ ON THE BENCH'}</small></span>
        <span class="club-win-count"><strong>${s.wins}</strong><small>WINS</small></span></button>`;
    }).join('');
    const activeStats = selected && statsFor(selected.id);
    const detail = selected ? `<div class="club-profile-head"><label class="avatar-upload club-photo" title="Update profile photo">${avatarHTML(selected, state.profiles.findIndex(p => p.id === selected.id))}<span class="avatar-plus">+</span><input type="file" accept="image/*" data-avatar-input="${escapeHTML(selected.id)}" aria-label="Upload photo for ${escapeHTML(selected.name)}"></label>
       <div class="club-profile-meta"><div class="panel-label">PERMANENT PLAYER PROFILE / #${String(state.profiles.findIndex(p => p.id === selected.id)+1).padStart(2,'0')}</div>
       <label class="sr-only" for="club-profile-name">Edit player name</label><input id="club-profile-name" class="club-name-input" data-player-name="${escapeHTML(selected.id)}" maxlength="24" spellcheck="false" autocomplete="off" value="${escapeHTML(selected.name)}" aria-label="Edit ${escapeHTML(selected.name)} name">
       <span class="club-profile-hint">Edit name · click the photo to replace</span></div>
       <button type="button" class="club-lineup-btn ${state.roster.includes(selected.id) ? 'is-in' : ''}" data-action="toggle-lineup" data-id="${escapeHTML(selected.id)}">${state.roster.includes(selected.id) ? '✓ IN LINEUP' : '+ ADD TO LINEUP'}</button></div>
       ${dartConfig(selected)}
       <div class="walkon-config"><div class="walkon-intro"><strong>♪ PLAYER ENTRANCE THEME</strong><small>Plays as their turn begins when SOUND is ON. Custom clips stay offline in your club backup.</small></div>
         <select class="select-mini walkon-select" id="walkon-preset" aria-label="Walk-on theme for ${escapeHTML(selected.name)}">
           ${[['arcade','8-BIT HERO'],['stadium','STADIUM CHAMPION'],['villain','THE VILLAIN'],['chaos','ABSOLUTE CHAOS'],['none','SILENCE']].map(([id,name])=>`<option value="${id}" ${selected.walkon===id?'selected':''}>${name}</option>`).join('')}
         </select><label class="walkon-upload" title="Upload MP3, M4A or WAV, maximum 2 MB">↑ ${selected.walkonAudio?'REPLACE CLIP':'UPLOAD CLIP'}<input id="walkon-upload" type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" aria-label="Upload custom entrance sound for ${escapeHTML(selected.name)}"></label>
         <button type="button" class="walkon-test" data-action="walkon-preview">▶ TEST</button>
         ${selected.walkonAudio?'<button type="button" class="walkon-clear" data-action="walkon-clear">✕ REMOVE CLIP</button>':''}
       </div>
       <div class="club-stats-grid">
       ${statTile(activeStats.played, 'MATCHES')}${statTile(activeStats.wins, 'WINS')}${statTile(`${activeStats.winPct.toFixed(0)}%`, 'WIN RATE')}
       ${statTile(activeStats.avg01 === null ? '—' : activeStats.avg01.toFixed(1), '3-DART AVG', '301 + 501')}
       ${statTile(activeStats.bestVisit, 'BEST VISIT')}${statTile(activeStats.bulls, '50-POINT BULLS')}${statTile(activeStats.visits180, '180 VISITS')}${statTile(activeStats.darts, 'DARTS THROWN')}
       </div>
       <div class="club-subheads"><h3>GAME BY GAME <span>↘</span></h3><span class="mini-caption">COMPLETED MATCHES ONLY</span></div>
       <div class="game-stats-grid">${Object.keys(GAMES).map(game => {
         const s = statsFor(selected.id, game);
         return `<div class="game-stat"><div class="game-stat-title">${GAMES[game].label}</div><div class="game-stat-number">${s.wins}<span>W / ${s.played} G</span></div><div class="game-stat-foot">${s.avg01 !== null ? `${s.avg01.toFixed(1)} THREE-DART AVG` : s.played ? `${s.bulls} INNER BULLS` : 'NO MATCHES YET'}</div></div>`;
       }).join('')}</div>
       ${heatmapSection(selected.id)}
       ${achievementSection(selected.id)}
       <div class="club-subheads"><h3>RECENT FORM <span>↘</span></h3><button class="tiny-link danger-link" type="button" data-action="delete-profile" data-id="${escapeHTML(selected.id)}">DELETE PROFILE</button></div>
       <div class="recent-matches">${state.archives.filter(m => m.players.some(p => p.id === selected.id)).slice(0, 15).map(m => {
         const result = m.players.find(p => p.id === selected.id);
         return `<div class="recent-row"><span class="result-tag result-${result.result}">${result.result.toUpperCase()}</span><strong>${escapeHTML(GAMES[m.game].label)}</strong><span>${new Date(m.endedAt).toLocaleDateString()}</span><small>BEST VISIT: ${result.bestVisit || 0}</small></div>`;
       }).join('') || '<p class="note">No finished matches yet. This page updates automatically when you finish a game.</p>'}</div>`
      : `<div class="empty-club"><h2>YOUR CLUB. YOUR RULES.</h2><p>Add a player to start recording lifetime scores.</p></div>`;
    return `<main class="club-page"><header class="club-heading"><div><div class="eyebrow">★ THE PERMANENT RECORD</div><h1>HALL OF <span>FAME.</span></h1><p>Same players, every match. Scores and rivalries live here.</p></div>
       <div class="club-backup-controls"><button type="button" class="outline-button" data-action="backup">↓ EXPORT ALL DATA</button><label class="outline-button import-label">↑ RESTORE BACKUP<input type="file" id="import-backup" accept=".json,application/json" aria-label="Restore Double Trouble backup"></label></div></header>
       <div class="club-layout"><aside class="club-sidebar pane"><div class="club-side-heading"><span class="panel-label">REGISTERED LEGENDS / ${state.profiles.length}</span><button type="button" data-action="create-profile" class="tiny-link">+ NEW</button></div>
         <div class="club-list">${listing || '<p class="note">No saved profiles.</p>'}</div>
         <div class="club-sidebar-bottom"><div><strong>${state.archives.length}</strong> MATCHES IN THE ARCHIVE</div><button type="button" class="tiny-link danger-link" data-action="clear-data">CLEAR ALL DATA</button></div>
       </aside><section class="pane club-detail" aria-label="Player stats">${detail}</section></div>
       <div class="club-footnote">${IS_MAC ? 'AUTO-SAVED IN ~/LIBRARY/APPLICATION SUPPORT/DOUBLE TROUBLE DARTS · UPDATES KEEP YOUR DATA' : 'SAVED IN THIS BROWSER · EXPORT A BACKUP BEFORE CHANGING DEVICES'}</div></main>`;
  }

  function historyDialog() {
    const m = state.match;
    if (!state.ui.showHistory || !m) return '';
    return `<div class="history-backdrop" role="dialog" aria-modal="true" aria-label="Throw history">
       <section class="history-modal"><header><div><span class="panel-label">MATCH RECORD / ${escapeHTML(m.game)}</span><h2>THE THROW LOG.</h2></div><button type="button" class="outline-button" data-action="history">✕ CLOSE</button></header>
       ${m.game === 'CRICKET' ? cricketTable() : ''}
       <div class="history-modal-list">${historyHTML()}</div><button type="button" data-action="export" class="outline-button full-width">↓ EXPORT MATCH JSON</button></section>
       </div>`;
  }

  function winnerScreen() {
    const m = state.match;
    if (m.status !== 'finished' || !state.ui.showWinner) return '';
    const winners = m.winnerIds.map(id => displayName(id));
    const isTie = m.winnerIds.length > 1;
    const winner = isTie ? null : metaFor(m.winnerIds[0]);
    const streak = winner ? currentWinStreak(winner.id) : 0;
    const top = isTie ? 'NOBODY WINS.' : streak >= 5 ? 'PUBLIC ENEMY NO. 1.' : streak >= 3 ? 'CAN’T STOP. WON’T STOP.' : 'A LEGEND IS BORN.';
    return `<div class="winner-backdrop" role="dialog" aria-modal="true" aria-label="Match results">
      <div class="winner-modal"><div class="winner-kicker">✳ &nbsp; THE OFFICIAL VERDICT &nbsp; ✳</div>
        ${winner ? `<div class="winner-portrait">${avatarHTML(winner, state.profiles.findIndex(p => p.id === winner.id))}</div>` : ''}
        <h2>${top}<br><span style="color:var(--acid)">${escapeHTML(winners.join(' + '))}</span></h2>
        ${streak >= 2 ? `<div class="streak-callout">✳ ${streak} WINS IN A ROW. ${streak >= 5?'SOMEONE CHECK THE DARTS.':streak>=3?'THE OTHERS ARE GETTING NERVOUS.':'BEGINNER’S LUCK? MAYBE NOT.'}</div>` : ''}
        ${state.ui.lastUnlocks?.length ? `<div class="new-achievements"><div>✳ ACHIEVEMENTS UNLOCKED</div>${state.ui.lastUnlocks.map(a=>`<span>${escapeHTML(a.icon)} ${escapeHTML(displayName(a.playerId))} · ${escapeHTML(a.name)}</span>`).join('')}</div>` : ''}
        <div class="winner-sub">${isTie ? 'A tie. The rivalry remains unresolved.' : `Winner of ${shortModeName(m.game)}. Boasting rights valid until the next match.`}<br><b>Player stats saved to the Hall of Fame.</b></div>
        <div class="winner-actions"><button type="button" data-action="new" class="action-button full-width">PLAY AGAIN ↗</button>
        <button type="button" data-action="league" class="outline-button full-width">♛ VIEW LEAGUE STANDINGS</button>
        <button type="button" data-action="close-winner" class="outline-button full-width">VIEW FINAL SCOREBOARD</button>
        <button type="button" data-action="export" class="ghost-button full-width">↓ DOWNLOAD THE EVIDENCE (JSON)</button></div>
      </div></div>`;
  }

  function render() {
    const same=state.screen==='match'&&state.match&&document.getElementById('v4-match')?.dataset.matchId===state.match.id;
    if (same) {
      document.querySelector('.topbar').outerHTML=topbar();
      document.getElementById('v4-header').innerHTML=headerV4();
      document.getElementById('score-rack').innerHTML=rackV4();
      document.getElementById('control-stack').innerHTML=controlV4();
      document.getElementById('overlay-root').innerHTML=overlaysV4();
    } else {
      if(stageHost)stageHost.remove();
      app.innerHTML=`<div class="shell screen-${state.screen}">${topbar()}${state.screen==='club'?clubScreen():state.screen==='league'?leagueScreen():state.screen==='match'&&state.match?matchScreen():setupScreen()}<footer class="footer"><div>DOUBLE TROUBLE / SOFT SPORT CLUB</div><div>OFFLINE CLUB / V4.1</div></footer></div><div id="overlay-root">${overlaysV4()}</div>`;
    }
    if(state.screen==='match'&&state.match){
      if(sceneMatchId!==state.match.id){stage?.dispose();stage=null;stageHost=null;sceneMatchId=state.match.id;}
      if(!stageHost){
        stageHost=document.createElement('div');stageHost.className='dart-stage';stageHost.id='dart-stage';
        document.getElementById('stage-mount').prepend(stageHost);
        stage=new window.DoubleTroubleStage(stageHost,{
          onThrow:p=>{if(inputReady())registerThrow(dartAt(p.x,p.y));},
          onHover:p=>{const el=document.getElementById('hover-value');if(el)el.textContent=p?hoverLabel(dartAt(p.x,p.y)):inputReady()?'POINT TO THE IMPACT':state.match?.turnPhase==='handoff'?'TURN COMPLETE / PRESS NEXT PLAYER':'BOARD LOCKED';},
          onImpact:shot=>impactV4(shot),onSettled:shot=>settledV4(shot),
          onFallback:()=>setTimeout(()=>{const el=document.getElementById('renderer-label');if(el)el.textContent='2D / COMPATIBILITY';toast('3D graphics unavailable. Scores are safe; using compatibility view.',true);},0)
        });
      }else if(!stageHost.isConnected){document.getElementById('stage-mount').prepend(stageHost);stage.resume();}
      stage.setOptions({motion:effectiveMotion(),quality:state.settings.quality});
      const pending=pendingShotId;pendingShotId=null;
      const animated=stage.setDarts(state.match.currentDarts,{animateId:pending,clear:clearOnSync});clearOnSync=false;
      const shot=pending&&state.match.currentDarts.find(d=>d.id===pending);
      if(shot&&!animated)queueMicrotask(()=>{impactV4(shot);settledV4(shot);});
      const status=document.getElementById('input-lamp');status.textContent=flightBusy?'IN FLIGHT':clearingBusy?'CLEARING':inputReady()?'INPUT READY':'INPUT LOCKED';
      stageHost.classList.toggle('input-locked',!inputReady());
      document.getElementById('renderer-label').textContent=stage.mode==='3d'?'3D / LOCAL':'2D / COMPATIBILITY';
      document.getElementById('stage-player').textContent=displayName(state.match.players[state.match.activeIndex].id);
      const motion=document.getElementById('motion-mode');if(motion)motion.value=state.settings.motion;
    }else{
      if(stage){stage.pause();flightBusy=false;clearingBusy=false;pendingShotId=null;}
      if(state.match?.status==='finished'&&state.ui.pendingWinner){state.ui.showWinner=true;state.ui.pendingWinner=false;}
      if(state.screen==='club')drawHeatmap();
    }
    document.documentElement.dataset.motion=effectiveMotion();
  }
  function overlaysV4(){
    return `${state.match?historyDialog():''}${state.screen==='match'&&state.match?winnerScreen():''}${state.ui.showCricket&&state.screen==='match'?`<div class="history-backdrop" role="dialog" aria-modal="true" aria-label="Cricket closure tracker"><section class="history-modal"><div class="history-modal-head"><h2>CRICKET MARKS</h2><button class="hardware-button" data-action="cricket-marks">CLOSE</button></div>${cricketTable()}</section></div>`:''}`;
  }
  function impactV4(shot){
    const m=state.match;if(state.screen!=='match'||!m?.currentDarts.some(d=>d.id===shot.id))return;
    const is180=!m.turnBusted&&m.game!=='CRICKET'&&m.currentDarts.length===3&&m.currentDarts.reduce((n,d)=>n+d.score,0)===180;
    const type=m.status==='finished'?'win':m.turnBusted?'bust':is180?'180':shot.kind;
    impactSound(shot.kind);
    if(['bullseye','outerbull','180','win','bust'].includes(type)){
      if(type!=='outerbull')playSound(type);
      stage?.effectFor(type);
      const el=document.getElementById('stage-event');if(el){
        clearTimeout(effectTimer);el.className=`stage-event show event-${type}`;
        const text=type==='win'?'MATCH WON':type==='bust'?'BUST':type==='180'?'ONE EIGHTY':type==='bullseye'?'BULLSEYE':'OUTER BULL';
        el.innerHTML=`<span>${text}</span><b>${type==='180'?'180':type==='bullseye'?'50':type==='outerbull'?'25':type==='bust'?'0':'&check;'}</b>`;
        effectTimer=setTimeout(()=>{el.classList.remove('show');},effectiveMotion()==='reduced'?700:type==='180'?1600:1100);
      }
    }
    const c=document.querySelector('.visit-display');if(c){c.classList.remove('readout-hit');void c.offsetWidth;c.classList.add('readout-hit');}
  }
  function settledV4(shot){
    const m=state.match;if(!m||!m.currentDarts.some(d=>d.id===shot.id))return;
    flightBusy=false;
    if(m.status==='finished'){
      clearTimeout(winnerTimer);const id=m.id;
      winnerTimer=setTimeout(()=>{if(state.match?.id!==id||state.match.status!=='finished')return;state.ui.showWinner=true;state.ui.pendingWinner=false;save();render();},effectiveMotion()==='reduced'?0:550);
    }
    if(state.screen==='match')render();
  }
  function impactSound(kind){
    if(!state.settings.sound)return;
    try{
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!soundContext)soundContext=new AC();if(soundContext.state==='suspended')soundContext.resume();
      const duration=kind==='miss'?.065:.045,buffer=soundContext.createBuffer(1,Math.ceil(soundContext.sampleRate*duration),soundContext.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/data.length*7);
      const src=soundContext.createBufferSource(),filter=soundContext.createBiquadFilter(),gain=soundContext.createGain();src.buffer=buffer;filter.type='lowpass';filter.frequency.value=kind==='miss'?850:2700;gain.gain.value=.28;src.connect(filter);filter.connect(gain);gain.connect(soundContext.destination);src.start();src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
    }catch(error){console.warn('Impact sound unavailable',error);}
  }

  function dartAt(x, y) {
    const r = Math.hypot(x, y);
    if (!Number.isFinite(r)) return null;
    if (r > 192) return { x, y, base:0, multiplier:0, score:0, label:'MISS', kind:'miss' };
    if (r <= 7.5) return { x, y, base: 25, multiplier: 2, score: 50, label: 'BULL 50', kind: 'bullseye' };
    if (r <= 18) return { x, y, base: 25, multiplier: 1, score: 25, label: 'BULL 25', kind: 'outerbull' };
    const degrees = Math.atan2(y, x) * 180 / Math.PI;
    const segmentIndex = Math.floor(((degrees + 90 + 9 + 360) % 360) / 18);
    const base = SECTORS[segmentIndex];
    const multiplier = r >= 180 ? 2 : (r >= 108 && r <= 120 ? 3 : 1);
    const kind = multiplier === 3 ? 'triple' : multiplier === 2 ? 'double' : 'single';
    const label = `${multiplier === 3 ? 'T' : multiplier === 2 ? 'D' : ''}${base}`;
    return { x, y, base, multiplier, score: base * multiplier, label, kind };
  }

  function localPoint(svg, event) {
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(screenMatrix.inverse());
  }

  function hoverLabel(shot) {
    if (!shot) return 'POINT TO THE IMPACT';
    if (shot.kind==='miss') return 'MISS / 0 POINTS / BACKSTOP';
    if (state.match && state.match.game === 'CRICKET' && !CRICKET_TARGETS.includes(shot.base)) return `${shot.label} · NO CRICKET MARKS`;
    if (state.match && state.match.game === 'CRICKET') return `${shot.label} · ${shot.multiplier} MARK${shot.multiplier > 1 ? 'S' : ''}`;
    return `${shot.label} · ${shot.score} POINTS`;
  }

  function attachBoardHandlers() { /* V4 stage owns pointer and keyboard hit testing. */ }

  function startMatch() {
    if (state.roster.length < 2 || state.roster.length > 8) { toast('Select 2–8 saved players to start.', true); return; }
    state.roster.forEach((id, i) => {
      const p = state.profiles.find(profile => profile.id === id);
      if (p) p.name = p.name.trim().slice(0, 24) || `Player ${i + 1}`;
    });
    cancelTransient();
    const game = state.settings.game;
    const initialScore = Number(game) || 0;
    state.match = {
      id: uid(), game, seasonId:state.activeSeasonId, doubleOut: Boolean(state.settings.doubleOut), countUpRounds: state.settings.countUpRounds || 8,
      players: state.roster.map(id => ({ id, score: initialScore, marks: Object.fromEntries(CRICKET_TARGETS.map(t => [t, 0])), turns: 0, dartsThrown: 0 })),
      activeIndex: 0, round: 1, turnStartScore: initialScore, currentDarts: [], turnPhase:'aiming', turnCommitted:false, turnBusted:false,
      history: [], lastHit: null, status: 'playing', winnerIds: [], startedAt: Date.now(), endedAt: null, undoStack: []
    };
    state.ui.showWinner = true;state.ui.pendingWinner=false;
    state.ui.showHistory = false;state.ui.showCricket=false;
    state.screen = 'match';
    save(); render();
    playWalkOn(state.match.players[0].id);
  }

  function recordUndo() {
    const m = state.match;
    const { undoStack, ...snapshot } = m;
    m.undoStack.push(JSON.parse(JSON.stringify(snapshot)));
    if (m.undoStack.length > 25) m.undoStack.shift();
  }

  function isCricketWinner(player) {
    const m = state.match;
    return CRICKET_TARGETS.every(t => (player.marks[t] || 0) >= 3) &&
      m.players.every(opponent => opponent.id === player.id || player.score >= opponent.score);
  }

  function recordLastHit(shot, playerId, note = '', bust = false) {
    state.match.lastHit = { label: shot.label, score: shot.score, playerId, note, bust };
  }

  function registerThrow(input) {
    const m = state.match;
    if (!input || !inputReady()) return false;
    recordUndo();
    const shot = { ...input, id:uid(), x: input.x ?? null, y: input.y ?? null, at: Date.now(), dartColor:colorFor(m.players[m.activeIndex].id) };
    const player = m.players[m.activeIndex];
    player.dartsThrown++;
    m.currentDarts.push(shot);
    let win = false;
    let bust = false;
    let note = '';

    if (m.game === '301' || m.game === '501') {
      if (player.score - shot.score < 0 || (m.doubleOut && player.score - shot.score === 1) ||
        (player.score - shot.score === 0 && m.doubleOut && shot.multiplier !== 2)) {
        bust = true;
        player.score = m.turnStartScore;
        note = `Busted! Score returns to ${m.turnStartScore}.`;
      } else {
        player.score -= shot.score;
        win = player.score === 0;
        note = win ? 'Perfect finish. Match won!' : `${player.score} points remaining.`;
      }
    } else if (m.game === 'CRICKET') {
      if (CRICKET_TARGETS.includes(shot.base)) {
        const prev = player.marks[shot.base] || 0;
        const added = Math.min(shot.multiplier, Math.max(0, 3 - prev));
        const overflow = shot.multiplier - added;
        player.marks[shot.base] = prev + added;
        const someoneStillOpen = m.players.some(opponent => opponent.id !== player.id && (opponent.marks[shot.base] || 0) < 3);
        const earned = someoneStillOpen ? overflow * shot.base : 0;
        player.score += earned;
        note = earned ? `+${earned} cricket points, ${added} new mark${added === 1 ? '' : 's'}.` : `${added} new mark${added === 1 ? '' : 's'} on ${shot.base === 25 ? 'bull' : shot.base}.`;
      } else {
        note = 'Outside cricket targets. No marks.';
      }
      win = isCricketWinner(player);
    } else {
      player.score += shot.score;
      note = `+${shot.score} points this dart.`;
    }

    recordLastHit(shot, player.id, note, bust);
    if (bust) finalizeTurn(true);
    else if (win) {finalizeTurn(false);finish([player.id]);}
    else if (m.currentDarts.length===3) {
      finalizeTurn(false);
      if (m.game==='COUNTUP' && m.activeIndex===m.players.length-1 && m.round>=m.countUpRounds) {
        const high=Math.max(...m.players.map(p=>p.score));finish(m.players.filter(p=>p.score===high).map(p=>p.id));
      }
    }
    flightBusy=true;pendingShotId=shot.id;
    save();render();return true;
  }

  function finalizeTurn(bust=false) {
    const m=state.match;if(m.turnCommitted)return;
    const player=m.players[m.activeIndex];
    const total=bust?0:(['301','501'].includes(m.game)?m.turnStartScore-player.score:player.score-m.turnStartScore);
    m.history.unshift({playerId:player.id,round:m.round,shots:m.currentDarts.map(s=>({...s})),before:m.turnStartScore,after:player.score,total,bust,at:Date.now()});
    player.turns++;m.turnCommitted=true;m.turnBusted=bust;m.turnPhase='handoff';
    // The current player and all physical darts remain until explicit handoff.
  }

  function finish(winnerIds) {
    state.match.status = 'finished';
    state.match.turnPhase = 'finished';
    state.ui.pendingWinner = true;
    state.match.winnerIds = winnerIds;
    state.match.endedAt = Date.now();
    state.ui.showWinner = false;
    if (!state.archives.some(a => a.id === state.match.id)) {
      const previous = Object.fromEntries(state.match.players.map(p=>[p.id, earnedAchievements(p.id)]));
      state.archives.unshift(makeArchive(state.match, state.profiles));
      state.ui.lastUnlocks = state.match.players.flatMap(p=> earnedAchievements(p.id)
        .filter(a=>!previous[p.id].some(old=>old.id===a.id)).map(a=>({...a,playerId:p.id})));
    }
  }

  function queueWinnerReveal() { /* V4 reveals after the final physical impact, in settledV4. */ }

  function undo() {
    const m = state.match;
    if (!m || !m.undoStack.length) return;
    cancelTransient();
    const previous = m.undoStack.pop();
    const remaining = m.undoStack;
    state.match = { ...previous, undoStack: remaining };
    state.archives = state.archives.filter(a => a.id !== state.match.id);
    state.ui.showWinner = false;state.ui.pendingWinner=false;
    state.ui.lastUnlocks = [];
    save(); render(); toast('Last action undone. Nobody saw that.');
  }

  function nextPlayer() {
    const m=state.match;if(!m||m.status!=='playing'||m.turnPhase!=='handoff'||flightBusy||clearingBusy)return false;
    recordUndo();clearTimeout(effectTimer);document.getElementById('stage-event')?.classList.remove('show');
    m.activeIndex=(m.activeIndex+1)%m.players.length;if(m.activeIndex===0)m.round++;
    m.currentDarts=[];m.turnStartScore=m.players[m.activeIndex].score;m.lastHit=null;m.turnPhase='aiming';m.turnCommitted=false;m.turnBusted=false;
    clearingBusy=effectiveMotion()!=='reduced';clearOnSync=clearingBusy;
    save();render();const id=m.id,incoming=m.players[m.activeIndex].id;
    clearTimeout(handoffTimer);handoffTimer=setTimeout(()=>{
      clearingBusy=false;if(state.match?.id!==id)return;
      if(state.screen==='match')render();if(state.match.players[state.match.activeIndex]?.id===incoming)playWalkOn(incoming);
    },clearingBusy?220:0);
    return true;
  }

  function exportMatch() {
    const m = state.match;
    if (!m) return;
    const { undoStack, ...cleanMatch } = m;
    const payload = {
      app: 'Double Trouble Darts', exportedAt: new Date().toISOString(),
      players: m.players.map(({ id }) => ({ id, name: displayName(id) })),
      match: { ...cleanMatch, history: [...m.history].reverse() }
    };
    saveJSON(payload, `double-trouble-${m.game.toLowerCase()}-${new Date(m.startedAt).toISOString().slice(0, 10)}.json`);
    toast('Match log exported. Receipts acquired.');
  }

  function animateDart() { /* Replaced by engine/dart-stage.js. */ }

  function saveJSON(data, filename) {
    if (IS_MAC && window.webkit.messageHandlers.dartsExport) {
      window.webkit.messageHandlers.dartsExport.postMessage({filename, content:JSON.stringify(data,null,2)});
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1200);
  }

  function exportBackup() {
    saveJSON({ app: 'Double Trouble Darts', backupVersion: 4, exportedAt: new Date().toISOString(),
      settings: state.settings, profiles: state.profiles, roster: state.roster,
      archives: state.archives, seasons:state.seasons, activeSeasonId:state.activeSeasonId, match: state.match,
      screen: state.match ? 'match' : 'setup' },
      `double-trouble-club-backup-${new Date().toISOString().slice(0,10)}.json`);
    toast('Backup downloaded. This includes player photos and lifetime stats.');
  }

  async function importBackup(file) {
    if (!file || file.size > 40 * 1024 * 1024) throw new Error('Backup file must be below 40 MB.');
    const input = JSON.parse(await file.text());
    if (input?.app !== 'Double Trouble Darts' || ![2,3,4].includes(input.backupVersion))
      throw new Error('Not a compatible Double Trouble player backup.');
    const candidate = sanitiseLoaded(input);
    if (!candidate) throw new Error('Backup data is incomplete or invalid.');
    if (!window.confirm('Replace ALL players, lifetime stats, and any current match with this backup?')) return;
    candidate.screen = 'club';
    candidate.ui.returnScreen = candidate.match ? 'match' : 'setup';
    cancelTransient();
    state = candidate;
    save(); render(); toast('Club restored. Welcome back.');
  }

  function toast(message, bad = false) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = message;
    el.className = `toast ${bad ? 'bad' : ''}`;
    clearTimeout(toastTimer);
    requestAnimationFrame(() => el.classList.add('show'));
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function spawnConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const parent = document.createElement('div'); parent.className = 'confetti-container';
    const palette = ['#e0fd78', '#fe927a', '#baa9ff', '#8edcdb', '#ffca64'];
    for (let i = 0; i < 72; i++) {
      const el = document.createElement('i');
      el.className = 'confetti';
      el.style.cssText = `left:${Math.random() * 100}%;background:${palette[i % palette.length]};animation-delay:${Math.random() * .65}s;animation-duration:${1.5 + Math.random() * 1.5}s;transform:rotate(${Math.random() * 360}deg)`;
      parent.append(el);
    }
    document.body.append(parent);
    setTimeout(() => parent.remove(), 3700);
  }

  function playSound(kind) {
    if (!state.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!soundContext) soundContext = new AC();
      if (soundContext.state === 'suspended') soundContext.resume();
      const now = soundContext.currentTime;
      const freqs = kind === '180' ? [440,660,880] : kind === 'win' ? [494, 622, 740, 987] : kind === 'bust' ? [210, 155] : kind === 'bullseye' ? [700, 1120] : kind === 'triple' ? [650, 860] : kind === 'double' ? [570, 715] : [415];
      freqs.forEach((frequency, index) => {
        const osc = soundContext.createOscillator();
        const gain = soundContext.createGain();
        osc.type = kind === 'bust' ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime(frequency, now + index * .09);
        gain.gain.setValueAtTime(.0001, now + index * .09);
        gain.gain.exponentialRampToValueAtTime(.05, now + index * .09 + .01);
        gain.gain.exponentialRampToValueAtTime(.0001, now + index * .09 + .17);
        osc.connect(gain); gain.connect(soundContext.destination);
        osc.start(now + index * .09); osc.stop(now + index * .09 + .18);
      });
    } catch (error) { console.warn('Sound unavailable:', error); }
  }

  function playWalkOn(id, force=false) {
    if (!force && !state.settings.sound) return;
    const p = state.profiles.find(p=>p.id===id);
    if (!p) return;
    if (currentWalkOnAudio) { currentWalkOnAudio.pause(); currentWalkOnAudio.currentTime=0; currentWalkOnAudio=null; }
    if (p.walkon === 'none') return;
    if (p.walkonAudio) {
      const player = new Audio(p.walkonAudio);
      player.volume=.42;
      currentWalkOnAudio=player;
      player.play().catch(error => console.warn('Custom walk-on audio unavailable:',error));
      return;
    }
    const themes={
      arcade:{type:'square',notes:[523,659,784,1047],beat:.12},
      stadium:{type:'sawtooth',notes:[196,294,392,587],beat:.17},
      villain:{type:'triangle',notes:[330,277,233,165],beat:.22},
      chaos:{type:'square',notes:[740,440,860,370,1080],beat:.115},
    };
    const theme=themes[p.walkon||'arcade'];
    if (!theme) return;
    try {
      const AC=window.AudioContext||window.webkitAudioContext;
      if (!AC) return;
      if (!soundContext) soundContext=new AC();
      if (soundContext.state==='suspended') soundContext.resume();
      const start=soundContext.currentTime+.025;
      theme.notes.forEach((hz,i)=>{
        const osc=soundContext.createOscillator(), gain=soundContext.createGain();
        const time=start+i*theme.beat;
        osc.type=theme.type;
        osc.frequency.setValueAtTime(hz,time);
        gain.gain.setValueAtTime(.0001,time);
        gain.gain.exponentialRampToValueAtTime(.025,time+.018);
        gain.gain.exponentialRampToValueAtTime(.0001,time+theme.beat*.82);
        osc.connect(gain);gain.connect(soundContext.destination);
        osc.start(time);osc.stop(time+theme.beat*.9);
      });
    } catch (error) { console.warn('Entrance theme unavailable:',error); }
  }

  async function readWalkOn(file) {
    if (!file || (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav)$/i.test(file.name)))
      throw new Error('Choose an MP3, M4A or WAV audio file.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Custom entrance clip must be 2 MB or smaller. Use a short excerpt.');
    const result=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Could not read the audio file.'));
      reader.onload=()=>resolve(reader.result);
      reader.readAsDataURL(file);
    });
    if (typeof result !== 'string' || !/^data:audio\/[-+.\w]+;base64,/.test(result))
      throw new Error('Unsupported audio format. Try MP3, M4A or WAV.');
    return result;
  }

  async function makeAvatar(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Photo must be smaller than 20 MB.');
    const objectURL = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not load this photo.'));
        el.src = objectURL;
      });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.height = 192;
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      ctx.fillStyle = '#f4f1e8'; ctx.fillRect(0,0,192,192);
      ctx.drawImage(image, (image.naturalWidth - size)/2, (image.naturalHeight - size)/2, size, size, 0,0,192,192);
      return canvas.toDataURL('image/jpeg', .76);
    } finally { URL.revokeObjectURL(objectURL); }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action === 'league-tab') { state.ui.leagueTab=target.dataset.value; save(); render(); }
    else if (action === 'league') {
      state.ui.returnScreen=state.screen==='match'?'match':state.screen==='club'?'club':'setup';
      state.ui.showHistory=false; state.screen='league';save();render();
    }
    else if (action === 'back-from-league') {
      state.screen=state.ui.returnScreen==='match'&&state.match?'match':state.ui.returnScreen==='club'?'club':'setup';save();render();
    }
    else if (action === 'player-from-league') {
      state.ui.returnScreen='league'; state.ui.profileId=target.dataset.id;state.screen='club';save();render();
    }
    else if (action === 'new-season') {
      if (state.match?.status==='playing') {toast('Finish or abandon your current game before starting a new season.',true);return;}
      const suggested=`Season ${String(state.seasons.length+1).padStart(2,'0')}`;
      const input=window.prompt('Name your new league season:',suggested);
      if (input===null) return;
      const name=input.trim().slice(0,40);
      if (!name) {toast('Please enter a season name.',true);return;}
      const now=Date.now();
      for (const season of state.seasons) if (!season.endedAt) season.endedAt=now;
      const next={id:uid(),name,createdAt:now,endedAt:null};
      state.seasons.push(next);state.activeSeasonId=next.id;state.ui.leagueSeasonId=next.id;
      save();render();toast(`${name} is now the active season.`);
    }
    else if (action === 'rename-season') {
      const season=state.seasons.find(x=>x.id===(state.ui.leagueSeasonId||state.activeSeasonId));
      if (!season) return;
      const input=window.prompt('Rename this season:',season.name);
      if (input===null) return;
      const name=input.trim().slice(0,40);
      if (!name) {toast('Season name cannot be empty.',true);return;}
      season.name=name;save();render();
    }
    else if (action === 'dart-color') {
      const p=state.profiles.find(p=>p.id===target.dataset.id);
      if(p&&validColor(target.dataset.color)){p.dartColor=target.dataset.color;save();render();}
    }
    else if (action === 'quality') {state.settings.quality=state.settings.quality==='eco'?'high':'eco';save();render();const b=document.querySelector('[data-action=quality]');if(b)b.textContent=state.settings.quality.toUpperCase()+' QUALITY';}
    else if (action === 'cricket-marks') {state.ui.showCricket=!state.ui.showCricket;render();}
    else if (action === 'mode') { state.settings.game = target.dataset.value; save(); render(); }
    else if (action === 'double-out') { state.settings.doubleOut = !state.settings.doubleOut; save(); render(); }
    else if (action === 'add-player' || action === 'create-profile') {
      const p = newProfile(`Player ${state.profiles.length + 1}`);
      p.dartColor = COLORS[state.profiles.length % COLORS.length];
      state.profiles.push(p);
      state.ui.profileId = p.id;
      if (action === 'add-player' && state.roster.length < 8) state.roster.push(p.id);
      save(); render();
      if (action === 'add-player') {
        const newInput = document.querySelector(`[data-player-name="${p.id}"]`);
        if (newInput) { newInput.focus(); newInput.select(); }
      }
    }
    else if (action === 'remove-player' || action === 'toggle-lineup' || action === 'join-roster') {
      const id = target.dataset.id, exists = state.roster.includes(id);
      if (exists && action !== 'join-roster') {
        if (state.roster.length <= 2) { toast('A match needs at least two players. Add another before removing this one.', true); return; }
        state.roster = state.roster.filter(p => p !== id);
      } else if (!exists) {
        if (state.roster.length >= 8) { toast('Eight is the maximum number of players.', true); return; }
        if (state.profiles.some(p => p.id === id)) state.roster.push(id);
      }
      save(); render();
    }
    else if (action === 'select-profile') { state.ui.profileId = target.dataset.id; save(); render(); }
    else if (action === 'walkon-preview') playWalkOn(state.ui.profileId,true);
    else if (action === 'walkon-clear') {
      const p=state.profiles.find(p=>p.id===state.ui.profileId);
      if (p) { p.walkonAudio=null; save(); render(); toast('Custom entrance clip removed. Preset theme restored.'); }
    }
    else if (action === 'delete-profile') {
      const id = target.dataset.id;
      if (state.match && state.match.status === 'playing' && state.match.players.some(p => p.id === id)) {
        toast('Finish or abandon the active match before deleting this player.', true); return;
      }
      if (!window.confirm(`Permanently delete ${displayName(id)}? Their match history will no longer appear under a player profile. This cannot be undone without a backup.`)) return;
      state.profiles = state.profiles.filter(p => p.id !== id);
      state.roster = state.roster.filter(p => p !== id);
      state.ui.profileId = state.profiles[0]?.id || null;
      save(); render();
    }
    else if (action === 'start') startMatch();
    else if (action === 'sound') {
      state.settings.sound = !state.settings.sound;
      if (!state.settings.sound && currentWalkOnAudio) { currentWalkOnAudio.pause(); currentWalkOnAudio.currentTime=0; currentWalkOnAudio=null; }
      save();render();if (state.settings.sound) playSound('single');
    }
    else if (action === 'club') {
      state.ui.returnScreen = state.screen === 'match' ? 'match' : state.screen === 'league' ? 'league' : 'setup';
      state.ui.showHistory = false;
      state.screen = 'club'; save(); render();
    }
    else if (action === 'back-from-club') {
      state.screen = state.ui.returnScreen === 'match' && state.match ? 'match' : state.ui.returnScreen === 'league' ? 'league' : 'setup'; save(); render();
    }
    else if (action === 'new') {
      if (state.match && state.match.status === 'playing' && !window.confirm('Abandon the unfinished match? Lifetime stats only include finished matches. Saved player profiles are kept.')) return;
      cancelTransient();state.ui.showCricket=false;
      state.match = null; state.screen = 'setup'; state.ui.showWinner = true; state.ui.lastUnlocks=[]; save(); render();
    }
    else if (action === 'history') { state.ui.showHistory = !state.ui.showHistory; save(); render(); }
    else if (action === 'backup') exportBackup();
    else if (action === 'clear-data') {
      if (!window.confirm(`Delete ALL saved player profiles, face photos, player stats, and match archives from this ${IS_MAC?'Mac app':'browser'}? Export a backup first if you want to keep them.`)) return;
      try { if (!IS_MAC) {localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PREVIOUS_KEY); localStorage.removeItem(LEGACY_KEY);}} catch (error) { console.warn(error); }
      cancelTransient();state = defaultState(); save(); render(); toast('All local darts data cleared.');
    }
    else if (action === 'miss') registerThrow({ base: 0, multiplier: 0, score: 0, label: 'MISS', kind: 'miss', x: null, y: null });
    else if (action === 'undo') undo();
    else if (action === 'end-turn') nextPlayer();
    else if (action === 'close-winner') { state.ui.pendingWinner=false;state.ui.showWinner = false; save(); render(); }
    else if (action === 'export') exportMatch();
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (input.matches('[data-player-name]')) {
      const player = state.profiles.find(p => p.id === input.dataset.playerName);
      if (player) { player.name = input.value.slice(0, 24); save(); }
    }
  });

  document.addEventListener('change', async event => {
    const input = event.target;
    if (input.matches('[data-dart-color]')) {
      const p=state.profiles.find(p=>p.id===input.dataset.dartColor);
      if(p&&validColor(input.value)){p.dartColor=input.value;save();render();}
    }
    else if (input.id==='motion-mode') {if(['realistic','quick','reduced'].includes(input.value)){state.settings.motion=input.value;save();render();}}
    else if (input.id === 'active-season') { state.activeSeasonId = input.value; save(); render(); }
    else if (input.id === 'heatmap-mode') { state.ui.heatmapMode = input.value; save(); render(); }
    else if (input.id === 'walkon-preset') {
      const p=state.profiles.find(p=>p.id===state.ui.profileId);
      if (p) {p.walkon=input.value;save();render();}
    }
    else if (input.id === 'walkon-upload' && input.files && input.files[0]) {
      try {
        const audio=await readWalkOn(input.files[0]);
        const p=state.profiles.find(p=>p.id===state.ui.profileId);
        if (p) { p.walkonAudio=audio;save();render();toast('Custom walk-on sound saved to this player.'); }
      } catch (error) {toast(error.message||'Could not load audio.',true);}
    }
    else if (input.id === 'league-season') { state.ui.leagueSeasonId = input.value; save(); render(); }
    else if (input.id === 'rounds') { state.settings.countUpRounds = Number(input.value) || 8; save(); }
    else if (input.id === 'import-backup' && input.files && input.files[0]) {
      try { await importBackup(input.files[0]); }
      catch (error) { toast(error.message || 'Could not restore backup.', true); }
    }
    else if (input.matches('[data-avatar-input]') && input.files && input.files[0]) {
      const id = input.dataset.avatarInput;
      try {
        const jpeg = await makeAvatar(input.files[0]);
        const player = state.profiles.find(p => p.id === id);
        if (player) { player.avatar = jpeg; save(); render(); toast(`${displayName(id)} looks ready for the big leagues.`); }
      } catch (error) { toast(error.message || 'Photo could not be loaded.', true); }
    }
  });

  document.addEventListener('keydown', event => {
    if(event.key==='Escape' && (state.ui.showCricket || state.ui.showHistory)){
      event.preventDefault();state.ui.showCricket=false;state.ui.showHistory=false;render();return;
    }
    if (state.screen !== 'match' || event.altKey || event.ctrlKey || event.metaKey || state.ui.showCricket || state.ui.showHistory || state.ui.showWinner && state.match?.status === 'finished') return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); registerThrow({ base: 0, multiplier: 0, score: 0, label: 'MISS', kind: 'miss', x: null, y: null }); }
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); nextPlayer(); }
  });

  // Exposed for local automated testing and extension, not required for gameplay.
  window.DoubleTrouble = Object.freeze({
    getState: () => JSON.parse(JSON.stringify(state)), dartAt, statsFor, earnedAchievements,
    sceneInfo:()=>stage?.debug()||null, boardPoint:(x,y)=>stage?.project(x,y), isInputReady:()=>inputReady(),
    exportBackup, loserOfNight, currentWinStreak, importBackupJSON:async json => {
      const file = new File([json], 'native-backup.json', {type:'application/json'});
      return importBackup(file);
    },
    openClub:()=>{state.ui.returnScreen = state.screen==='match'?'match':'setup';state.screen='club';save();render();}
  });
  render();
  // Seed the native Application Support data file on first launch.
  if (IS_MAC && !window.__DOUBLE_TROUBLE_SAVED_JSON__) save();
})();
