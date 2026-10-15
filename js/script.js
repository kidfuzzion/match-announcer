// Fills script templates with match data and builds the five cues the operator steps through.
import { store, spoken, homeTeam, visitorTeam, schoolSaid, mascotSaid } from './state.js';
import { gradeSpoken, positionSpoken } from './parse.js';

// Replace {field}s. A [bracketed part] is dropped entirely if any field inside it is blank.
export function render(tpl, vars) {
  let out = String(tpl || '').replace(/\[([^\[\]]*)\]/g, (m, inner) => {
    let blank = false;
    const filled = inner.replace(/\{(\w+)\}/g, (mm, k) => {
      const v = vars[k];
      if (v == null || String(v).trim() === '') blank = true;
      return v == null ? '' : String(v);
    });
    return blank ? '' : filled;
  });
  out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])));
  out = out.replace(/\s+/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/([,;:])(?=[,.!?])/g, '')
    .replace(/^[\s,;:]+/, '').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function matchVars() {
  const h = homeTeam(), v = visitorTeam(), m = store.state.match;
  return {
    homeSchool: schoolSaid(h), homeMascot: mascotSaid(h),
    visitorSchool: schoolSaid(v), visitorMascot: mascotSaid(v),
    singer: spoken(m.singer),
  };
}

export function playerLine(team, p) {
  return render(store.state.scripts.player, {
    ...matchVars(), school: schoolSaid(team), mascot: mascotSaid(team),
    number: p.number, name: spoken(p), grade: gradeSpoken(p.grade), position: positionSpoken(p.position),
  });
}

function rosterSteps(team, side) {
  const S = store.state.settings, sc = store.state.scripts, m = store.state.match;
  const base = { ...matchVars(), school: schoolSaid(team), mascot: mascotSaid(team) };
  const steps = [];
  const lift = side === 'home' && S.liftBetween;
  const between = () => {
    if (lift) { steps.push({ t: 'music', level: S.liftLevel, s: 0.4 }, { t: 'wait', s: Math.max(0, S.gapAthletes - 0.8) }, { t: 'music', level: S.duckLevel, s: 0.4 }); }
    else steps.push({ t: 'wait', s: S.gapAthletes });
  };
  steps.push({ t: 'say', text: render(side === 'home' ? sc.homeIntro : sc.visitorIntro, base), label: 'Intro' });
  between();
  team.players.filter(p => p.name.trim()).forEach(p => {
    steps.push({ t: 'hold' });
    steps.push({ t: 'say', text: playerLine(team, p), label: `#${p.number || '–'} ${p.name}`, person: p });
    between();
  });
  const mgrOn = side === 'home' ? m.homeManager : m.visitorManager;
  if (mgrOn && team.manager.name.trim()) {
    steps.push({ t: 'hold' });
    steps.push({ t: 'say', text: render(sc.manager, { ...base, name: spoken(team.manager) }), label: 'Team manager', person: team.manager });
    between();
  }
  if (team.coach.name.trim()) {
    steps.push({ t: 'hold' });
    steps.push({ t: 'say', text: render(sc.coach, { ...base, name: spoken(team.coach) }), label: 'Head coach', person: team.coach });
  }
  return steps;
}

export function buildCues() {
  const s = store.state, S = s.settings, sc = s.scripts, m = s.match;
  const vars = matchVars();
  const h = homeTeam(), v = visitorTeam();
  const cues = [];

  const welcome = [{ t: 'say', text: render(sc.welcome, vars), label: 'Welcome' }];
  if (m.sportsmanship) welcome.push({ t: 'wait', s: S.gapSegments }, { t: 'say', text: render(sc.sportsmanship, vars), label: 'Sportsmanship' });
  cues.push({ id: 'welcome', title: 'Welcome', sub: m.sportsmanship ? 'With sportsmanship statement' : '', steps: welcome });

  if (m.anthemMode === 'live') {
    cues.push({ id: 'anthem', title: 'National anthem', sub: 'Live singer. Tap Next when the anthem ends.',
      steps: [{ t: 'say', text: render(sc.anthemLive, vars), label: 'Anthem intro' }] });
  } else {
    cues.push({ id: 'anthem', title: 'National anthem', sub: s.files.anthem ? s.files.anthem.name : 'No anthem file loaded',
      steps: [{ t: 'say', text: render(sc.anthemRecorded, vars), label: 'Anthem intro' }, { t: 'wait', s: S.gapSegments }, { t: 'anthem' }] });
  }

  cues.push({ id: 'visitor', title: 'Visitor roster', sub: v ? `${v.school || 'Visitor'} ${v.mascot || ''}`.trim() : 'No opponent selected',
    steps: v ? rosterSteps(v, 'visitor') : [] });

  const homeSteps = [];
  if (h) {
    const hasMusic = !!s.files.music;
    if (hasMusic) homeSteps.push({ t: 'musicStart' }, { t: 'wait', s: S.musicIntro }, { t: 'music', level: S.duckLevel, s: 1.2 }, { t: 'wait', s: 0.6 });
    homeSteps.push(...rosterSteps(h, 'home'));
    if (hasMusic) homeSteps.push({ t: 'wait', s: 0.4 }, { t: 'music', level: 1, s: 0.8 }, { t: 'wait', s: S.swell }, { t: 'musicFade', s: S.fadeOut });
  }
  cues.push({ id: 'home', title: 'Home roster', sub: h ? `${h.school || 'Home'} ${h.mascot || ''}`.trim() + (s.files.music ? ', with music' : ', no music loaded') : 'No home team',
    steps: homeSteps });

  cues.push({ id: 'closing', title: 'Closing', sub: '', steps: [{ t: 'say', text: render(sc.closing, vars), label: 'Closing' }] });
  return cues;
}

// Every distinct line the voice will say for this match (used to pre-generate clips).
export function allLines() {
  const set = new Set();
  for (const c of buildCues()) for (const st of c.steps) if (st.t === 'say' && st.text) set.add(st.text);
  return [...set];
}
