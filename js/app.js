// Match Announcer — screens and wiring.
import { db, requestPersistence } from './db.js';
import {
  store, uid, blankTeam, blankPlayer, DEFAULT_SCRIPTS, SCRIPT_INFO, spoken, isApproved, approve,
  teamById, homeTeam, visitorTeam, matchPeople,
} from './state.js';
import { parseRoster, positionSpoken, gradeSpoken } from './parse.js';
import { flagName } from './names.js';
import { render, matchVars, playerLine, buildCues, allLines } from './script.js';
import {
  ELEVEN_MODELS, elevenVoices, elevenUsage, elevenReady, ensureClip, clipStatus, deviceVoices,
  preview, stopPreview,
} from './voice.js';
import { Show } from './show.js';
import { exportPack, importPack } from './pack.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => store.state;
const view = $('#view');

let current = 'match';
let editingTeam = null;
let namesFilter = 'review';
let people = [];
let voiceList = [];

// ---------- Toast ----------
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
const fail = (e) => { console.error(e); toast(e && e.message ? e.message : String(e), 5000); };

// ---------- Binding: data-bind="scope|field" ----------
function scopeObj(scope) {
  const [kind, a, b] = scope.split(':');
  switch (kind) {
    case 'settings': return S().settings;
    case 'scripts': return S().scripts;
    case 'match': return S().match;
    case 'singer': return S().match.singer;
    case 'team': return teamById(a);
    case 'coach': return teamById(a)?.coach;
    case 'manager': return teamById(a)?.manager;
    case 'player': return teamById(a)?.players.find(p => p.id === b);
    case 'person': return people[+a]?.person;
  }
}
function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.type === 'range') return el.value === '' ? 0 : +el.value;
  return el.value;
}
view.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  const [scope, field] = el.dataset.bind.split('|');
  const obj = scopeObj(scope);
  if (!obj) return;
  obj[field] = readInput(el);
  store.save();
  el.dispatchEvent(new CustomEvent('bound', { bubbles: true }));
});
view.addEventListener('change', (e) => {
  const el = e.target.closest('[data-bind][data-rerender]');
  if (el) draw();
});

// ---------- Navigation ----------
function go(v) {
  current = v;
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  draw();
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) { stopPreview(); go(b.dataset.view); }
});

function draw() {
  $$('#tabs button').forEach(b => { if (b.dataset.view === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  view.classList.toggle('wide', current === 'run');
  ({ match: drawMatch, teams: drawTeams, names: drawNames, script: drawScript, voice: drawVoice, run: drawRun }[current] || drawMatch)();
  drawMatchup();
}

function drawMatchup() {
  const h = homeTeam(), v = visitorTeam();
  const n = (t) => t ? (t.mascot || t.school || 'Unnamed team') : '';
  $('#matchup').textContent = h && v ? `${n(v)} at ${n(h)}` : (h ? n(h) : '');
}

function applyTheme() {
  const t = S().settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- Shared bits ----------
const teamName = (t) => t ? [t.school, t.mascot].filter(Boolean).join(' ') || 'Unnamed team' : '';
const field = (label, inner, small = '') => `<label class="field"><span>${label}</span>${inner}${small ? `<small>${small}</small>` : ''}</label>`;
const check = (bind, checked, label, small = '', rerender = true) =>
  `<label class="check"><input type="checkbox" data-bind="${bind}" ${checked ? 'checked' : ''} ${rerender ? 'data-rerender' : ''}><span><b>${label}</b>${small ? `<small>${small}</small>` : ''}</span></label>`;

function readiness() {
  const ppl = matchPeople();
  const approved = ppl.filter(x => isApproved(x.person)).length;
  return { ppl, approved, total: ppl.length };
}

// =====================================================================
// MATCH
// =====================================================================
function drawMatch() {
  const s = S(), m = s.match;
  const h = homeTeam();
  const others = s.teams.filter(t => t.id !== m.homeId);
  const r = readiness();
  const fileRow = (key, label) => {
    const f = s.files[key];
    return `
      <div class="list-row">
        <div class="grow">
          <b>${label}</b><br>
          <span class="hint">${f ? esc(f.name) + ` (${(f.size / 1048576).toFixed(1)} MB)` : 'No file loaded'}</span>
        </div>
        <div class="btn-row">
          ${f ? `<button data-act="preview-file" data-key="${key}">Preview</button>` : ''}
          <label class="btn ${f ? '' : 'btn-primary'}">${f ? 'Replace' : 'Load file'}<input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" data-act="load-file" data-key="${key}" class="sr-only"></label>
          ${f ? `<button class="btn-quiet btn-danger" data-act="remove-file" data-key="${key}">Remove</button>` : ''}
        </div>
      </div>`;
  };

  view.innerHTML = `
    <section class="section">
      <h1>Tonight's match</h1>
      <p class="hint" style="margin-top:6px">Only the opponent and rosters change from match to match. Everything else is saved for the season.</p>
    </section>

    <section class="section panel stack">
      <div class="row">
        ${field('Home team', `<select data-act="pick-home">${s.teams.map(t => `<option value="${t.id}" ${t.id === m.homeId ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}</select>`)}
        ${field('Opponent', `<select data-act="pick-visitor">
          <option value="">Choose the visiting team</option>
          ${others.map(t => `<option value="${t.id}" ${t.id === m.visitorId ? 'selected' : ''}>${esc(teamName(t))}</option>`).join('')}
          <option value="__new">Add a new opponent…</option></select>`)}
      </div>
      ${!h || !h.school ? `<p class="hint">Start by entering your home team on the <a href="#teams" data-go="teams">Teams</a> screen.</p>` : ''}
    </section>

    <section class="section">
      <h2>Options</h2>
      <div class="panel">
        ${check('match|sportsmanship', m.sportsmanship, 'Read the sportsmanship statement', 'Right after the welcome, before the anthem.')}
        ${check('match|visitorManager', m.visitorManager, 'Announce the visiting team manager', visitorTeam()?.manager.name ? esc(visitorTeam().manager.name) : 'No manager entered for the opponent yet.')}
        ${check('match|homeManager', m.homeManager, 'Announce the home team manager', h?.manager.name ? esc(h.manager.name) : 'No manager entered for the home team yet.')}
        <div style="margin-top:10px">
          <div class="field"><span>National anthem</span></div>
          <div class="seg" role="group" aria-label="Anthem" style="margin-top:6px">
            <button data-act="anthem-mode" data-mode="recorded" aria-pressed="${m.anthemMode === 'recorded'}">Recorded file</button>
            <button data-act="anthem-mode" data-mode="live" aria-pressed="${m.anthemMode === 'live'}">Live singer</button>
          </div>
          ${m.anthemMode === 'live' ? `<div class="row" style="margin-top:10px">
            ${field("Singer's name", `<input type="text" data-bind="singer|name" value="${esc(m.singer.name)}" placeholder="Optional">`)}
            ${field('Say it as', `<input type="text" data-bind="singer|say" value="${esc(m.singer.say)}" placeholder="Only if it needs a respelling">`)}
          </div>` : ''}
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Audio files</h2>
      <p class="hint">Save the files to your iPhone's Files app first. Songs streamed from Spotify or Apple Music can't be used.</p>
      <ul class="list">
        <li>${fileRow('anthem', 'National anthem')}</li>
        <li>${fileRow('music', 'Home roster music')}
          ${s.files.music ? `<div class="row" style="margin-top:10px">
            ${field('Start the song at (seconds)', `<input type="number" min="0" step="0.5" inputmode="decimal" data-bind="match|musicStart" value="${m.musicStart}">`, 'Skip a slow intro. Preview plays from this point.')}
          </div>` : ''}
        </li>
      </ul>
    </section>

    <section class="section">
      <h2>Ready check</h2>
      <div class="panel stack">
        <div class="status-grid" id="ready-chips">
          <span class="chip ${r.total && r.approved === r.total ? 'ok' : 'warn'}">${r.approved} of ${r.total} names approved</span>
          <span class="chip ${s.files.anthem || m.anthemMode === 'live' ? 'ok' : 'warn'}">${m.anthemMode === 'live' ? 'Live anthem' : s.files.anthem ? 'Anthem loaded' : 'No anthem file'}</span>
          <span class="chip ${s.files.music ? 'ok' : 'warn'}">${s.files.music ? 'Music loaded' : 'No home music'}</span>
          <span class="chip" id="clip-chip">${s.settings.engine === 'elevenlabs' ? 'Checking voice clips…' : 'Device voice'}</span>
        </div>
        ${r.total && r.approved < r.total ? `<p><a href="#names" data-go="names">Review the remaining names</a></p>` : ''}
        ${s.settings.engine === 'elevenlabs' ? `<div class="btn-row"><button class="btn-primary" data-act="gen-clips" id="gen-btn">Generate voice clips</button><span class="hint" id="gen-status"></span></div>
        <p class="hint">Do this on Wi-Fi before the match. Clips are saved on this device, so the match itself runs with no internet.</p>` : ''}
      </div>
    </section>

    <section class="section">
      <h2>Match pack</h2>
      <p class="hint">One file with everything: rosters, approved names, script, settings, audio, and voice clips. Use it as a backup or to run the match on another device. Your API key is never included.</p>
      <div class="panel stack">
        ${check('settings|packClips', s.settings.packClips !== false, 'Include generated voice clips', 'Lets another device play the match offline without generating anything.', false)}
        <div class="btn-row">
          <button class="btn-primary" data-act="export">Export match pack</button>
          <label class="btn">Import match pack<input type="file" accept=".json,application/json" data-act="import" class="sr-only"></label>
        </div>
      </div>
    </section>`;

  if (s.settings.engine === 'elevenlabs') refreshClipChip();
}

async function refreshClipChip() {
  const chip = $('#clip-chip'); if (!chip) return;
  const st = await clipStatus(allLines());
  chip.className = 'chip ' + (st.ready === st.total ? 'ok' : 'warn');
  chip.textContent = `${st.ready} of ${st.total} voice clips ready`;
  const gs = $('#gen-status');
  if (gs) gs.textContent = st.ready === st.total ? 'All clips are ready.' : `About ${st.missingChars.toLocaleString()} characters to generate.`;
  const gb = $('#gen-btn'); if (gb) gb.disabled = st.ready === st.total;
}

async function generateClips(statusEl) {
  if (!elevenReady()) { toast('Add your ElevenLabs API key and choose a voice on the Voice screen first.', 4000); return false; }
  const lines = allLines();
  let made = 0;
  for (let i = 0; i < lines.length; i++) {
    if (statusEl) statusEl.textContent = `Generating ${i + 1} of ${lines.length}…`;
    try { const r = await ensureClip(lines[i]); if (!r.cached) made++; }
    catch (e) { fail(e); if (statusEl) statusEl.textContent = `Stopped at ${i + 1} of ${lines.length}.`; return false; }
  }
  toast(made ? `Generated ${made} new clips.` : 'All clips were already ready.');
  return true;
}

let filePreview;
function stopFilePreview() { if (filePreview) { filePreview.pause(); URL.revokeObjectURL(filePreview.src); filePreview = null; } }

view.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.matches('[data-act="pick-home"]')) { S().match.homeId = el.value; if (S().match.visitorId === el.value) S().match.visitorId = ''; store.save(); draw(); }
    if (el.matches('[data-act="pick-visitor"]')) {
      if (el.value === '__new') { const t = blankTeam(); S().teams.push(t); S().match.visitorId = t.id; store.save(); editingTeam = t.id; go('teams'); return; }
      S().match.visitorId = el.value; store.save(); draw();
    }
    if (el.matches('[data-act="load-file"]') && el.files[0]) {
      const f = el.files[0], key = el.dataset.key;
      await db.put('blobs', key, f);
      S().files[key] = { name: f.name, size: f.size, type: f.type };
      store.save(); toast(`Loaded ${f.name}`); draw();
    }
    if (el.matches('[data-act="import"]') && el.files[0]) {
      if (!confirm('Importing replaces the rosters, script, settings, and audio on this device. Continue?')) { el.value = ''; return; }
      await importPack(el.files[0]); applyTheme(); toast('Match pack imported.'); draw();
    }
  } catch (err) { fail(err); }
});

view.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-go]');
  if (a) { e.preventDefault(); go(a.dataset.go); return; }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  try {
    switch (act) {
      case 'anthem-mode': S().match.anthemMode = b.dataset.mode; store.save(); draw(); break;
      case 'remove-file': stopFilePreview(); await db.del('blobs', b.dataset.key); S().files[b.dataset.key] = null; store.save(); draw(); break;
      case 'preview-file': {
        if (filePreview) { stopFilePreview(); b.textContent = 'Preview'; break; }
        const blob = await db.get('blobs', b.dataset.key);
        filePreview = new Audio(URL.createObjectURL(blob));
        if (b.dataset.key === 'music') filePreview.currentTime = +S().match.musicStart || 0;
        await filePreview.play(); b.textContent = 'Stop preview';
        filePreview.onended = () => { stopFilePreview(); b.textContent = 'Preview'; };
        break;
      }
      case 'gen-clips': b.disabled = true; await generateClips($('#gen-status')); refreshClipChip(); break;
      case 'export': {
        b.disabled = true; b.textContent = 'Preparing…';
        const name = await exportPack({ includeClips: S().settings.packClips !== false });
        if (name) toast(`Saved ${name}`);
        b.disabled = false; b.textContent = 'Export match pack';
        break;
      }
      default: return handleTeamsClick(b, act) || handleNamesClick(b, act) || handleScriptClick(b, act) || handleVoiceClick(b, act) || handleRunClick(b, act);
    }
  } catch (err) { fail(err); }
});

// =====================================================================
// TEAMS
// =====================================================================
function drawTeams() {
  const s = S();
  const t = editingTeam && teamById(editingTeam);
  if (!t) { editingTeam = null; return drawTeamList(); }
  const isHome = t.id === s.match.homeId;
  const posList = ['OH', 'MB', 'MH', 'S', 'OPP', 'RS', 'L', 'DS', 'OH/DS'];

  view.innerHTML = `
    <section class="section">
      <button class="btn-quiet" data-act="team-back" style="margin-left:-10px">All teams</button>
      <h1 style="margin-top:6px">${esc(teamName(t))}${isHome ? ' (home)' : ''}</h1>
    </section>

    <section class="section panel stack">
      <div class="row">
        ${field('School', `<input type="text" data-bind="team:${t.id}|school" value="${esc(t.school)}" placeholder="e.g. Central High School">`)}
        ${field('Say it as', `<input type="text" data-bind="team:${t.id}|schoolSay" value="${esc(t.schoolSay)}" placeholder="Only if it needs a respelling">`)}
      </div>
      <div class="row">
        ${field('Mascot', `<input type="text" data-bind="team:${t.id}|mascot" value="${esc(t.mascot)}" placeholder="e.g. Eagles">`)}
        ${field('Say it as', `<input type="text" data-bind="team:${t.id}|mascotSay" value="${esc(t.mascotSay)}" placeholder="Only if it needs a respelling">`)}
      </div>
      <div class="row">
        ${field('Head coach', `<input type="text" data-bind="coach:${t.id}|name" value="${esc(t.coach.name)}">`)}
        ${field('Team manager', `<input type="text" data-bind="manager:${t.id}|name" value="${esc(t.manager.name)}" placeholder="Optional">`, 'Switched on per match on the Match screen.')}
      </div>
    </section>

    <section class="section">
      <div class="list-row" style="margin-bottom:8px">
        <div class="grow"><h2>Roster</h2><p class="hint">Read in this order. ${t.players.length} athletes.</p></div>
      </div>
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn-primary" data-act="paste-open">Paste a roster</button>
        <button data-act="player-add">Add an athlete</button>
      </div>
      <div class="panel">
        ${t.players.length ? `
        <div class="roster-head"><span>Number</span><span>Name</span><span>Grade</span><span>Position</span><span></span></div>
        <ul class="roster">
          ${t.players.map((p, i) => `
            <li data-pid="${p.id}">
              <div class="r-num"><input type="text" inputmode="numeric" aria-label="Number" data-bind="player:${t.id}:${p.id}|number" value="${esc(p.number)}" placeholder="#"></div>
              <div class="r-main">
                <div class="r-name"><input type="text" aria-label="Name" data-bind="player:${t.id}:${p.id}|name" value="${esc(p.name)}" placeholder="First Last"></div>
                <select aria-label="Grade" data-bind="player:${t.id}:${p.id}|grade">
                  ${['', 'Fr', 'So', 'Jr', 'Sr'].map(g => `<option value="${g}" ${p.grade === g ? 'selected' : ''}>${g ? gradeSpoken(g).replace(/^./, c => c.toUpperCase()) : 'Grade'}</option>`).join('')}
                </select>
                <input type="text" aria-label="Position" list="positions" data-bind="player:${t.id}:${p.id}|position" value="${esc(p.position)}" placeholder="Position">
              </div>
              <div class="r-tools">
                <button class="btn-icon" data-act="player-up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button class="btn-icon" data-act="player-down" data-i="${i}" aria-label="Move down" ${i === t.players.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="btn-icon btn-danger" data-act="player-del" data-i="${i}" aria-label="Remove">✕</button>
              </div>
            </li>`).join('')}
        </ul>` : `<p class="empty">No athletes yet. Paste a roster from MaxPreps, a school site, or a photo of a printed roster.</p>`}
      </div>
      <datalist id="positions">${posList.map(p => `<option value="${p}">${positionSpoken(p)}</option>`).join('')}</datalist>
    </section>

    <section class="section btn-row">
      ${isHome ? '' : `<button data-act="team-home">Make this the home team</button>`}
      <button class="btn-danger" data-act="team-del">Delete team</button>
    </section>

    <dialog id="paste-dlg">
      <div class="dlg">
        <h2>Paste a roster</h2>
        <p class="hint">Copy the roster table from MaxPreps or a school site and paste it here. For a printed roster, take a photo, press and hold the text to select it with Live Text, then copy and paste. Athletes are kept in the order they appear.</p>
        <textarea id="paste-text" rows="8" placeholder="1  Jane Smith  Sr  OH&#10;4  Ava Nguyen  Jr  S&#10;Head Coach: Pat Jones"></textarea>
        <div id="paste-preview"></div>
        <div class="btn-row">
          <button class="btn-primary" data-act="paste-replace" disabled>Replace roster</button>
          <button data-act="paste-append" disabled>Add to the end</button>
          <button class="btn-quiet" data-act="paste-close">Cancel</button>
        </div>
      </div>
    </dialog>`;

  const ta = $('#paste-text');
  ta.addEventListener('input', () => {
    const r = parseRoster(ta.value);
    $('#paste-preview').innerHTML = r.players.length || r.coach || r.manager ? `
      <p class="progress-line">Found ${r.players.length} athletes${r.coach ? `, head coach ${esc(r.coach)}` : ''}${r.manager ? `, manager ${esc(r.manager)}` : ''}. Check them below; you can fix anything after adding.</p>
      <div style="overflow:auto"><table class="parsed"><thead><tr><th>#</th><th>Name</th><th>Grade</th><th>Position</th></tr></thead>
      <tbody>${r.players.map(p => `<tr><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td>${esc(p.grade)}</td><td>${esc(p.position)}</td></tr>`).join('')}</tbody></table></div>` : '';
    $$('[data-act="paste-replace"],[data-act="paste-append"]').forEach(x => x.disabled = !r.players.length);
  });
}

function drawTeamList() {
  const s = S();
  const sorted = [...s.teams].sort((a, b) => (b.id === s.match.homeId) - (a.id === s.match.homeId) || teamName(a).localeCompare(teamName(b)));
  view.innerHTML = `
    <section class="section">
      <h1>Teams</h1>
      <p class="hint" style="margin-top:6px">Each team is saved for the season with its roster and approved pronunciations, so a rematch is already done.</p>
    </section>
    <section class="section">
      <ul class="list">
        ${sorted.map(t => `<li><div class="list-row">
          <div class="grow"><b>${esc(teamName(t))}</b><br><span class="hint">${t.players.length} athletes${t.coach.name ? `, coach ${esc(t.coach.name)}` : ''}</span></div>
          ${t.id === s.match.homeId ? '<span class="chip ok">Home</span>' : t.id === s.match.visitorId ? '<span class="chip">Tonight\'s opponent</span>' : ''}
          <button data-act="team-edit" data-id="${t.id}">Edit</button>
        </div></li>`).join('')}
      </ul>
      <div class="btn-row" style="margin-top:12px"><button class="btn-primary" data-act="team-new">Add a team</button></div>
    </section>`;
}

function handleTeamsClick(b, act) {
  const t = editingTeam && teamById(editingTeam);
  const i = +b.dataset.i;
  switch (act) {
    case 'team-edit': editingTeam = b.dataset.id; draw(); return true;
    case 'team-new': { const nt = blankTeam(); S().teams.push(nt); store.save(); editingTeam = nt.id; draw(); return true; }
    case 'team-back': editingTeam = null; draw(); return true;
    case 'team-home': S().match.homeId = t.id; if (S().match.visitorId === t.id) S().match.visitorId = ''; store.save(); draw(); toast('Home team changed.'); return true;
    case 'team-del': {
      if (S().teams.length === 1) { toast('Keep at least one team.'); return true; }
      if (!confirm(`Delete ${teamName(t)} and its roster?`)) return true;
      S().teams = S().teams.filter(x => x.id !== t.id);
      if (S().match.homeId === t.id) S().match.homeId = S().teams[0].id;
      if (S().match.visitorId === t.id) S().match.visitorId = '';
      store.save(); editingTeam = null; draw(); return true;
    }
    case 'player-add': t.players.push(blankPlayer()); store.save(); draw(); setTimeout(() => { const ins = $$('.roster .r-name input'); ins[ins.length - 1]?.focus(); }, 0); return true;
    case 'player-up': if (i > 0) { [t.players[i - 1], t.players[i]] = [t.players[i], t.players[i - 1]]; store.save(); draw(); } return true;
    case 'player-down': if (i < t.players.length - 1) { [t.players[i + 1], t.players[i]] = [t.players[i], t.players[i + 1]]; store.save(); draw(); } return true;
    case 'player-del': t.players.splice(i, 1); store.save(); draw(); return true;
    case 'paste-open': $('#paste-dlg').showModal(); $('#paste-text').focus(); return true;
    case 'paste-close': $('#paste-dlg').close(); return true;
    case 'paste-replace':
    case 'paste-append': {
      const r = parseRoster($('#paste-text').value);
      if (act === 'paste-replace' && t.players.length && !confirm(`Replace the ${t.players.length} athletes already on this roster?`)) return true;
      // Keep approved pronunciations for athletes who were already on the roster.
      const old = new Map(t.players.map(p => [p.name.trim().toLowerCase(), p]));
      const incoming = r.players.map(p => {
        const prev = old.get(p.name.trim().toLowerCase());
        return blankPlayer({ ...p, say: prev ? prev.say : '', approved: prev ? prev.approved : '' });
      });
      t.players = act === 'paste-replace' ? incoming : t.players.concat(incoming);
      if (r.coach && !t.coach.name) t.coach.name = r.coach;
      if (r.manager && !t.manager.name) t.manager.name = r.manager;
      store.save(); $('#paste-dlg').close(); draw(); toast(`Added ${incoming.length} athletes.`);
      return true;
    }
  }
  return false;
}

// =====================================================================
// NAMES
// =====================================================================
function drawNames() {
  const all = matchPeople().map(x => ({ ...x, flag: flagName(x.person.name) }));
  all.sort((a, b) => (isApproved(a.person) - isApproved(b.person)) || (b.flag.score - a.flag.score));
  people = namesFilter === 'review' ? all.filter(x => !isApproved(x.person)) : all;
  const approvedN = all.filter(x => isApproved(x.person)).length;

  view.innerHTML = `
    <section class="section">
      <h1>Names</h1>
      <p class="hint" style="margin-top:6px">Listen to every name and approve it. If it's wrong, type how the whole name sounds, like <i>LAY-uh JOHN-son</i> or <i>Ava WIN</i>, and listen again. Approvals are saved with the roster for the season. Names that look easy to get wrong are listed first.</p>
    </section>
    <section class="section">
      <div class="list-row" style="margin-bottom:12px; flex-wrap:wrap">
        <div class="grow"><span class="chip ${all.length && approvedN === all.length ? 'ok' : 'warn'}" id="names-count">${approvedN} of ${all.length} approved</span></div>
        <div class="seg" role="group" aria-label="Show">
          <button data-act="names-filter" data-f="review" aria-pressed="${namesFilter === 'review'}">Needs review</button>
          <button data-act="names-filter" data-f="all" aria-pressed="${namesFilter === 'all'}">All names</button>
        </div>
      </div>
      ${!all.length ? `<p class="empty panel">No names yet. Choose tonight's teams on the <a href="#match" data-go="match">Match</a> screen and add rosters on the <a href="#teams" data-go="teams">Teams</a> screen.</p>`
        : !people.length ? `<p class="empty panel">Every name for tonight is approved.</p>` : `
      <ul class="list">
        ${people.map((x, i) => `
          <li class="${isApproved(x.person) ? 'approved' : ''}" data-i="${i}">
            <div class="namecard">
              <div class="who"><strong>${esc(x.person.name)}</strong><span class="team">${esc(x.role)}${x.team ? `, ${esc(x.team)}` : ''}</span></div>
              ${x.flag.reasons.length ? `<div class="why">${esc(x.flag.reasons.join('. '))}.</div>` : ''}
              <div class="act">
                <input type="text" aria-label="Say it as" data-bind="person:${i}|say" value="${esc(x.person.say)}" placeholder="How it sounds">
                <button data-act="name-listen" data-i="${i}" aria-label="Listen">Listen</button>
                <button data-act="name-approve" data-i="${i}" class="${isApproved(x.person) ? 'btn-go' : ''}">${isApproved(x.person) ? 'Approved' : 'Approve'}</button>
              </div>
            </div>
          </li>`).join('')}
      </ul>`}
    </section>`;

  // Typing a respelling un-approves the name until it's approved again.
  $$('[data-bind^="person:"]').forEach(inp => inp.addEventListener('bound', () => {
    const li = inp.closest('li'), i = +li.dataset.i, p = people[i].person;
    const btn = $('[data-act="name-approve"]', li);
    btn.className = isApproved(p) ? 'btn-go' : ''; btn.textContent = isApproved(p) ? 'Approved' : 'Approve';
    li.classList.toggle('approved', isApproved(p));
  }));
}

function handleNamesClick(b, act) {
  switch (act) {
    case 'names-filter': namesFilter = b.dataset.f; draw(); return true;
    case 'name-listen': {
      const p = people[+b.dataset.i].person;
      b.disabled = true;
      preview(spoken(p)).catch(fail).finally(() => { b.disabled = false; });
      return true;
    }
    case 'name-approve': {
      const li = b.closest('li'), p = people[+b.dataset.i].person;
      if (isApproved(p)) p.approved = ''; else approve(p);
      store.save();
      b.className = isApproved(p) ? 'btn-go' : ''; b.textContent = isApproved(p) ? 'Approved' : 'Approve';
      li.classList.toggle('approved', isApproved(p));
      const all = matchPeople(), n = all.filter(x => isApproved(x.person)).length;
      const c = $('#names-count'); c.textContent = `${n} of ${all.length} approved`; c.className = 'chip ' + (n === all.length ? 'ok' : 'warn');
      return true;
    }
  }
  return false;
}

// =====================================================================
// SCRIPT
// =====================================================================
function samplePreview(key) {
  const vars = matchVars();
  const h = homeTeam(), v = visitorTeam();
  const team = v || h;
  const sc = S().scripts;
  if (key === 'player') {
    const p = team && team.players.find(x => x.name.trim());
    return p ? playerLine(team, p) : render(sc.player, { number: '7', name: 'Jane Smith', grade: 'senior', position: 'outside hitter' });
  }
  if (key === 'coach' || key === 'manager') {
    const who = team ? spoken(team[key]) : '';
    return render(sc[key], { ...vars, school: team?.school, mascot: team?.mascot, name: who || (key === 'coach' ? 'Pat Jones' : 'Sam Lee') });
  }
  return render(sc[key], { ...vars, singer: vars.singer || 'our guest singer' });
}

function drawScript() {
  const sc = S().scripts;
  view.innerHTML = `
    <section class="section">
      <h1>Script</h1>
      <p class="hint" style="margin-top:6px">Saved for the season. Words in {braces} are filled in from the match automatically; tap one below a box to insert it. The italic line shows what will be said for tonight's match.</p>
    </section>
    ${SCRIPT_INFO.map(info => `
      <section class="section tpl panel" data-key="${info.key}">
        <div class="tpl-head"><h3>${info.title}</h3>
          <div class="btn-row">
            <button class="btn-quiet" data-act="tpl-listen" data-key="${info.key}">Listen</button>
            ${sc[info.key] !== DEFAULT_SCRIPTS[info.key] ? `<button class="btn-quiet" data-act="tpl-reset" data-key="${info.key}">Reset</button>` : ''}
          </div>
        </div>
        ${info.hint ? `<p class="hint" style="margin-bottom:6px">${info.hint}</p>` : ''}
        <textarea data-bind="scripts|${info.key}" rows="${info.key === 'player' || info.key === 'coach' || info.key === 'manager' ? 2 : 3}">${esc(sc[info.key])}</textarea>
        <div class="fields">${info.fields.map(f => `<button type="button" class="fieldchip" data-ins="{${f}}"><code>{${f}}</code></button>`).join('')}</div>
        <p class="preview" data-preview="${info.key}">${esc(samplePreview(info.key))}</p>
      </section>`).join('')}`;

  $$('.tpl textarea').forEach(ta => ta.addEventListener('bound', () => {
    const k = ta.closest('.tpl').dataset.key;
    $(`[data-preview="${k}"]`).textContent = samplePreview(k);
  }));
  $$('.fieldchip').forEach(btn => {
    btn.style.cssText = 'min-height:0;padding:0;border:0;background:none';
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      const ta = $('textarea', btn.closest('.tpl'));
      const ins = btn.dataset.ins, s0 = ta.selectionStart ?? ta.value.length, s1 = ta.selectionEnd ?? s0;
      ta.value = ta.value.slice(0, s0) + ins + ta.value.slice(s1);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s0 + ins.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

function handleScriptClick(b, act) {
  switch (act) {
    case 'tpl-reset': S().scripts[b.dataset.key] = DEFAULT_SCRIPTS[b.dataset.key]; store.save(); draw(); return true;
    case 'tpl-listen': b.disabled = true; preview(samplePreview(b.dataset.key)).catch(fail).finally(() => { b.disabled = false; }); return true;
  }
  return false;
}

// =====================================================================
// VOICE & PACING
// =====================================================================
async function drawVoice() {
  const st = S().settings;
  const el = st.engine === 'elevenlabs';
  const pct = (v) => Math.round(v * 100);
  const compareText = samplePreview('player');

  view.innerHTML = `
    <section class="section">
      <h1>Voice and pacing</h1>
    </section>

    <section class="section">
      <h2>Announcer voice</h2>
      <p class="hint">Use the comparison below on your actual names before deciding whether ElevenLabs is worth paying for.</p>
      <div class="seg" role="group" aria-label="Voice engine">
        <button data-act="engine" data-engine="device" aria-pressed="${!el}">Device voice (free, offline)</button>
        <button data-act="engine" data-engine="elevenlabs" aria-pressed="${el}">ElevenLabs</button>
      </div>
    </section>

    <section class="section panel stack">
      <h3>ElevenLabs</h3>
      <p class="hint">Create a free account at <a href="https://elevenlabs.io" target="_blank" rel="noopener">elevenlabs.io</a>, then open Developers, then API keys, and create a key with access to Text to Speech, Voices, and User. The key stays on this device and is never put in a match pack.</p>
      ${field('API key', `<input type="password" autocomplete="off" data-bind="settings|elevenKey" value="${esc(st.elevenKey)}" placeholder="sk_…">`)}
      <div class="row">
        ${field('Voice', `<select id="el-voice" ${voiceList.length ? '' : 'disabled'}>
          ${voiceList.length ? voiceList.map(v => `<option value="${v.id}" ${v.id === st.elevenVoiceId ? 'selected' : ''}>${esc(v.name)}${v.desc ? ` (${esc(v.desc)})` : ''}</option>`).join('')
            : `<option>${st.elevenVoiceName ? esc(st.elevenVoiceName) : 'Load voices first'}</option>`}
        </select>`)}
        <div class="btn-row"><button data-act="el-voices">Load voices</button></div>
      </div>
      ${field('Model', `<select data-bind="settings|elevenModel">${ELEVEN_MODELS.map(m => `<option value="${m.id}" ${m.id === st.elevenModel ? 'selected' : ''}>${m.label}</option>`).join('')}</select>`)}
      <div class="btn-row"><button data-act="el-usage">Check credits used</button><span class="hint" id="el-usage"></span></div>
    </section>

    <section class="section panel stack">
      <h3>Device voice</h3>
      ${field('Voice', `<select data-bind="settings|deviceVoice" id="dev-voice"><option value="">Default English voice</option></select>`,
        'On iPhone, better voices are free: Settings, Accessibility, Spoken Content, Voices, English. Download an "Enhanced" or "Premium" voice, then reopen this app.')}
    </section>

    <section class="section panel stack">
      <h3>Compare</h3>
      ${field('Line to compare', `<input type="text" id="cmp-text" value="${esc(compareText)}">`)}
      <div class="btn-row">
        <button data-act="cmp" data-engine="elevenlabs">Play ElevenLabs</button>
        <button data-act="cmp" data-engine="device">Play device voice</button>
        <button class="btn-quiet" data-act="cmp-stop">Stop</button>
      </div>
    </section>

    <section class="section">
      <h2>Pacing</h2>
      <p class="hint">Saved for the season. Changing the speaking rate means ElevenLabs clips are generated again.</p>
      <div class="panel stack">
        ${field(`Speaking rate <span id="rate-v">${pct(st.rate)}%</span>`, `<input type="range" min="0.8" max="1.15" step="0.01" data-bind="settings|rate" value="${st.rate}" data-out="rate-v">`, 'A little slower than normal carries better in an echoey gym.')}
        <div class="row">
          ${field('Gap between athletes (seconds)', `<input type="number" min="0" max="15" step="0.5" inputmode="decimal" data-bind="settings|gapAthletes" value="${st.gapAthletes}">`, 'Time for each athlete to run out and slap hands down the line.')}
          ${field('Gap between parts (seconds)', `<input type="number" min="0" max="10" step="0.5" inputmode="decimal" data-bind="settings|gapSegments" value="${st.gapSegments}">`, 'For example, after the anthem intro before the anthem starts.')}
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Home roster music</h2>
      <div class="panel stack">
        <div class="row">
          ${field('Full-volume intro (seconds)', `<input type="number" min="0" max="60" step="0.5" inputmode="decimal" data-bind="settings|musicIntro" value="${st.musicIntro}">`)}
          ${field('Swell after the coach (seconds)', `<input type="number" min="0" max="30" step="0.5" inputmode="decimal" data-bind="settings|swell" value="${st.swell}">`)}
          ${field('Fade out (seconds)', `<input type="number" min="0.5" max="15" step="0.5" inputmode="decimal" data-bind="settings|fadeOut" value="${st.fadeOut}">`)}
        </div>
        ${field(`Music under the voice <span id="duck-v">${pct(st.duckLevel)}%</span>`, `<input type="range" min="0" max="0.7" step="0.05" data-bind="settings|duckLevel" value="${st.duckLevel}" data-out="duck-v">`, 'Lower keeps names clear over the music.')}
        ${check('settings|liftBetween', st.liftBetween, 'Raise the music between names', 'Brings energy up while each athlete runs out.')}
        ${st.liftBetween ? field(`Music between names <span id="lift-v">${pct(st.liftLevel)}%</span>`, `<input type="range" min="0.2" max="1" step="0.05" data-bind="settings|liftLevel" value="${st.liftLevel}" data-out="lift-v">`) : ''}
      </div>
    </section>

    <section class="section">
      <h2>Appearance and storage</h2>
      <div class="panel stack">
        <div class="seg" role="group" aria-label="Theme">
          ${['auto', 'light', 'dark'].map(t => `<button data-act="theme" data-t="${t}" aria-pressed="${st.theme === t}">${t === 'auto' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
        <div class="btn-row"><button class="btn-danger" data-act="clear-clips">Delete saved voice clips</button><span class="hint">Frees space. Clips are generated again when needed.</span></div>
      </div>
    </section>`;

  $$('input[type="range"][data-out]').forEach(r => r.addEventListener('input', () => { $('#' + r.dataset.out).textContent = pct(+r.value) + '%'; }));
  const vs = $('#el-voice');
  vs.addEventListener('change', () => {
    const v = voiceList.find(x => x.id === vs.value);
    if (v) { st.elevenVoiceId = v.id; st.elevenVoiceName = v.name; store.save(); }
  });
  const dv = await deviceVoices();
  const sel = $('#dev-voice');
  if (sel) {
    sel.innerHTML = `<option value="">Default English voice</option>` + dv.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === st.deviceVoice ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  }
}

function handleVoiceClick(b, act) {
  const st = S().settings;
  switch (act) {
    case 'engine': st.engine = b.dataset.engine; store.save(); draw(); return true;
    case 'theme': st.theme = b.dataset.t; store.save(); applyTheme(); draw(); return true;
    case 'el-voices':
      if (!st.elevenKey) { toast('Paste your API key first.'); return true; }
      b.disabled = true; b.textContent = 'Loading…';
      elevenVoices(st.elevenKey).then(list => {
        voiceList = list;
        if (!st.elevenVoiceId && list[0]) { st.elevenVoiceId = list[0].id; st.elevenVoiceName = list[0].name; store.save(); }
        draw(); toast(`${list.length} voices loaded.`);
      }).catch(fail).finally(() => { b.disabled = false; b.textContent = 'Load voices'; });
      return true;
    case 'el-usage':
      if (!st.elevenKey) { toast('Paste your API key first.'); return true; }
      elevenUsage(st.elevenKey).then(u => {
        $('#el-usage').textContent = `${u.used.toLocaleString()} of ${u.limit.toLocaleString()} credits used this month (${u.tier} plan).`;
      }).catch(fail);
      return true;
    case 'cmp': {
      const text = $('#cmp-text').value.trim();
      if (!text) return true;
      b.disabled = true;
      preview(text, b.dataset.engine).catch(fail).finally(() => { b.disabled = false; });
      return true;
    }
    case 'cmp-stop': stopPreview(); return true;
    case 'clear-clips':
      if (!confirm('Delete all saved voice clips on this device?')) return true;
      db.clear('clips').then(() => toast('Voice clips deleted.')).catch(fail);
      return true;
  }
  return false;
}

// =====================================================================
// RUN
// =====================================================================
const run = {
  show: null, started: false, cues: [], index: 0, done: new Set(), lastPlayed: -1,
  line: '', label: '', via: '', progress: 0,
};

function drawRun() {
  const r = readiness();
  run.cues = buildCues();
  const s = S();

  if (!run.started) {
    view.innerHTML = `
      <section class="section">
        <h1>Run the match</h1>
        <p class="hint" style="margin-top:6px">Do these once the phone is plugged into the PA, then tap Start session.</p>
      </section>
      <section class="section panel preflight">
        ${[
          ['Voice clips generated and names approved', 'Check the Match screen while you still have Wi-Fi.'],
          ['Airplane mode on, Wi-Fi off', 'Stops calls and notifications from cutting into the PA.'],
          ['Focus or Do Not Disturb on', ''],
          ['Aux cable connected, phone volume all the way up', 'Set the level on the mixer, not the phone.'],
          ['Ring/silent switch on ring', 'This app asks to play through it, but older iOS versions may still mute.'],
          ['Auto-Lock set to Never', 'Settings, Display & Brightness. The app also tries to keep the screen on.'],
        ].map(([a, b]) => `<label class="check"><input type="checkbox"><span><b>${a}</b>${b ? `<small>${b}</small>` : ''}</span></label>`).join('')}
      </section>
      <section class="section">
        <div class="status-grid" style="margin-bottom:12px">
          <span class="chip ${r.total && r.approved === r.total ? 'ok' : 'bad'}">${r.approved} of ${r.total} names approved</span>
          <span class="chip ${s.files.anthem || s.match.anthemMode === 'live' ? 'ok' : 'warn'}">${s.match.anthemMode === 'live' ? 'Live anthem' : s.files.anthem ? 'Anthem loaded' : 'No anthem file'}</span>
          <span class="chip ${s.files.music ? 'ok' : 'warn'}">${s.files.music ? 'Music loaded' : 'No home music'}</span>
          <span class="chip">${s.settings.engine === 'elevenlabs' ? 'ElevenLabs voice' : 'Device voice'}</span>
        </div>
        <button class="go" data-act="run-start">Start session<small>Unlocks audio and keeps the screen on</small></button>
        <p class="hint" id="run-status" style="margin-top:10px"></p>
      </section>`;
    return;
  }

  const n = run.cues.length;
  const cur = run.cues[run.index];
  view.innerHTML = `
    <div class="run">
      <ol class="rundown" aria-label="Cues">
        ${run.cues.map((c, i) => `<li class="${run.done.has(i) ? 'done' : ''} ${i === run.index ? 'current' : ''}">
          <button data-act="run-cue" data-i="${i}" ${run.show.playing ? 'disabled' : ''}>
            <span class="dot">${run.done.has(i) ? '✓' : i + 1}</span>
            <span class="lbl"><b>${esc(c.title)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>
          </button></li>`).join('')}
      </ol>
      <div class="stage">
        <div class="now-label"><span id="now-label">${run.line ? esc(run.label) : 'Up next'}</span><span id="now-via"></span></div>
        <div class="now ${run.line ? '' : 'idle'}" id="now">${run.line ? esc(run.line) : cur ? esc(cur.title) : 'All cues done'}</div>
        <div class="meter" aria-hidden="true"><i id="meter" style="width:${Math.round(run.progress * 100)}%"></i></div>
        <button class="go" id="go-btn" data-act="run-go"></button>
        <div class="controls">
          <button data-act="run-pause" id="pause-btn">Pause</button>
          <button data-act="run-stop" id="stop-btn" class="btn-danger">Stop</button>
          <button data-act="run-replay" id="replay-btn">Replay</button>
          <button data-act="run-skip" id="skip-btn">Skip</button>
        </div>
        <p class="hint">Pause lets the current name finish, then holds before the next one. Music keeps playing under it. Stop fades everything out and leaves this cue ready to play again.</p>
        <div class="btn-row"><button class="btn-quiet" data-act="run-end">End session</button></div>
      </div>
    </div>`;
  updateRunControls();
  void n;
}

function updateRunControls() {
  const btn = $('#go-btn'); if (!btn) return;
  const sh = run.show, cur = run.cues[run.index];
  const playing = sh.playing;
  btn.classList.toggle('playing', playing);
  if (playing) { btn.innerHTML = `${sh.paused ? 'Paused' : 'Playing'}<small>${esc(run.cues[run.lastPlayed]?.title || '')}</small>`; btn.disabled = true; }
  else if (cur) { btn.innerHTML = `${run.done.size ? 'Next' : 'Play'}<small>${esc(cur.title)}</small>`; btn.disabled = false; }
  else { btn.innerHTML = `Done<small>Tap a cue to play it again</small>`; btn.disabled = true; }
  const hasHolds = playing && run.cues[run.lastPlayed]?.steps.some(s => s.t === 'hold');
  const pb = $('#pause-btn');
  pb.disabled = !hasHolds; pb.textContent = sh.paused ? 'Resume' : 'Pause';
  pb.classList.toggle('btn-primary', sh.paused);
  $('#stop-btn').disabled = !playing && !sh.musicSrc;
  $('#replay-btn').disabled = playing || run.lastPlayed < 0;
  $('#skip-btn').disabled = playing || !cur;
  $$('.rundown button').forEach(x => { x.disabled = playing; });
  const via = $('#now-via');
  if (via) via.textContent = run.via === 'fallback' ? 'Device voice (no clip)' : '';
}

async function playCue(i) {
  run.cues = buildCues();
  const cue = run.cues[i];
  if (!cue) return;
  run.index = i; run.lastPlayed = i; run.line = ''; run.progress = 0;
  drawRun();
  const result = await run.show.runCue(cue).catch(e => { fail(e); return 'error'; });
  if (result === 'done') {
    run.done.add(i);
    if (run.index === i) run.index = i + 1;
    run.line = '';
  }
  if (current === 'run') drawRun();
}

function handleRunClick(b, act) {
  switch (act) {
    case 'run-start': startSession(b); return true;
    case 'run-go': if (!run.show.playing) playCue(run.index); return true;
    case 'run-pause': run.show.paused ? run.show.resume() : run.show.pause(); return true;
    case 'run-stop': run.show.stop(); return true;
    case 'run-replay': if (run.lastPlayed >= 0) playCue(run.lastPlayed); return true;
    case 'run-skip': run.index = Math.min(run.cues.length, run.index + 1); run.line = ''; drawRun(); return true;
    case 'run-cue': run.index = +b.dataset.i; run.line = ''; drawRun(); return true;
    case 'run-end':
      if (!confirm('End the session? Audio stops and the cue list resets.')) return true;
      run.show.end(); run.started = false; run.done.clear(); run.index = 0; run.lastPlayed = -1; run.line = '';
      drawRun(); return true;
  }
  return false;
}

async function startSession(b) {
  const r = readiness();
  if (r.approved < r.total && !confirm(`${r.total - r.approved} names haven't been approved yet. They'll be read as written. Start anyway?`)) return;
  if (!homeTeam() || !visitorTeam()) { if (!confirm('Tonight\'s home team or opponent isn\'t set. Start anyway?')) return; }
  b.disabled = true;
  const status = $('#run-status');
  if (!run.show) run.show = new Show({
    line: (text, label, via) => {
      run.line = text; run.label = label; run.via = via;
      const nowEl = $('#now'); if (nowEl) { nowEl.textContent = text; nowEl.classList.remove('idle'); }
      const l = $('#now-label'); if (l) l.textContent = label;
      updateRunControls();
    },
    progress: (f) => { run.progress = f; const m = $('#meter'); if (m) m.style.width = Math.round(f * 100) + '%'; },
    state: () => updateRunControls(),
  });
  try {
    const res = await run.show.start(msg => { if (status) status.textContent = msg; });
    run.started = true; run.index = 0; run.done.clear(); run.lastPlayed = -1;
    drawRun();
    const notes = [...res.problems];
    if (res.fallback) notes.push(`${res.fallback} lines have no ElevenLabs clip and will use the device voice.`);
    if (notes.length) toast(notes.join(' '), 7000);
  } catch (e) { b.disabled = false; fail(e); }
}

// =====================================================================
// Boot
// =====================================================================
(async function boot() {
  try { await store.load(); } catch (e) { fail(e); }
  applyTheme();
  requestPersistence();
  const fromHash = location.hash.slice(1);
  const hasHome = homeTeam() && homeTeam().school;
  current = ['match', 'teams', 'names', 'script', 'voice', 'run'].includes(fromHash) ? fromHash : hasHome ? 'match' : 'teams';
  if (!hasHome && current === 'teams') editingTeam = S().match.homeId;
  draw();
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== current) go(h); });
  window.addEventListener('beforeunload', () => { store.saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.saveNow(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

void uid;
