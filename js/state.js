// App state: defaults, load/save, and small helpers shared by every screen.
import { db } from './db.js';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_SCRIPTS = {
  welcome: "Good evening, and welcome to {homeSchool} for tonight's varsity volleyball match between the {visitorSchool} {visitorMascot} and your {homeSchool} {homeMascot}!",
  sportsmanship: "As a reminder, this is a high school athletic event. Please show respect to the student-athletes, coaches, and officials, cheer for your team and not against the opponent, and help us keep tonight a positive experience for everyone. Thank you.",
  anthemRecorded: "Ladies and gentlemen, please rise and remove your caps for the playing of our national anthem.",
  anthemLive: "Ladies and gentlemen, please rise and remove your caps for the singing of our national anthem, performed tonight by {singer}.",
  visitorIntro: "And now, please welcome the visiting {visitorMascot} of {visitorSchool}!",
  homeIntro: "And now, the moment you've been waiting for. Introducing your {homeSchool} {homeMascot}!",
  player: "[{grade} ][{position}, ][number {number}, ]{name}!",
  manager: "Team manager, {name}!",
  coach: "And the head coach of the {mascot}, {name}!",
  closing: "Ladies and gentlemen, let's give one more round of applause for both teams. Enjoy tonight's match!",
};

export const SCRIPT_INFO = [
  { key: 'welcome', title: 'Welcome', hint: 'Opens the night.', fields: ['homeSchool', 'homeMascot', 'visitorSchool', 'visitorMascot'] },
  { key: 'sportsmanship', title: 'Sportsmanship statement', hint: 'Read right after the welcome when it is switched on for the match.', fields: ['homeSchool', 'visitorSchool'] },
  { key: 'anthemRecorded', title: 'Anthem intro (recorded)', hint: 'Read before the anthem file plays.', fields: ['homeSchool'] },
  { key: 'anthemLive', title: 'Anthem intro (live singer)', hint: 'Read before a live singer. The app then waits for you to tap Next.', fields: ['singer', 'homeSchool'] },
  { key: 'visitorIntro', title: 'Visitor roster intro', hint: '', fields: ['visitorSchool', 'visitorMascot'] },
  { key: 'homeIntro', title: 'Home roster intro', hint: 'Read over the home music after the intro portion plays at full volume.', fields: ['homeSchool', 'homeMascot'] },
  { key: 'player', title: 'Each athlete', hint: 'Anything inside [square brackets] is skipped when a field inside it is blank.', fields: ['number', 'name', 'grade', 'position', 'school', 'mascot'] },
  { key: 'manager', title: 'Team manager', hint: 'Only read when the manager is switched on for that team.', fields: ['name', 'school', 'mascot'] },
  { key: 'coach', title: 'Head coach', hint: 'Closes each roster.', fields: ['name', 'school', 'mascot'] },
  { key: 'closing', title: 'Closing statement', hint: 'Its own cue. Tap Next once the home team is set.', fields: ['homeSchool', 'homeMascot', 'visitorSchool', 'visitorMascot'] },
];

export const DEFAULT_SETTINGS = {
  engine: 'device',            // 'device' | 'elevenlabs'
  elevenKey: '',
  elevenVoiceId: '',
  elevenVoiceName: '',
  elevenModel: 'eleven_multilingual_v2',
  deviceVoice: '',             // voiceURI
  rate: 0.95,                  // 1 = normal
  gapAthletes: 2.5,            // seconds between athletes
  gapSegments: 1.5,            // seconds between parts of a cue (e.g. intro → anthem)
  musicIntro: 8,               // seconds of home music at full volume before speaking
  duckLevel: 0.25,             // music volume under the voice (0–1)
  liftBetween: false,          // raise music between names
  liftLevel: 0.6,
  swell: 4,                    // seconds at full volume after the coach
  fadeOut: 3,                  // seconds to fade the music out
  theme: 'auto',
};

export function blankTeam(isHome = false) {
  return {
    id: uid(), isHome,
    school: '', schoolSay: '', mascot: '', mascotSay: '',
    coach: { name: '', say: '', approved: '' },
    manager: { name: '', say: '', approved: '' },
    players: [],
  };
}

export function blankPlayer(p = {}) {
  return { id: uid(), number: '', name: '', grade: '', position: '', say: '', approved: '', ...p };
}

export function defaultState() {
  const home = blankTeam(true);
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    scripts: { ...DEFAULT_SCRIPTS },
    teams: [home],
    match: {
      homeId: home.id, visitorId: '',
      sportsmanship: false,
      anthemMode: 'recorded',   // 'recorded' | 'live'
      singer: { name: '', say: '', approved: '' },
      homeManager: false, visitorManager: false,
      musicStart: 0,
    },
    files: { anthem: null, music: null },   // { name, size, type } — data lives in the blobs store
  };
}

export const store = {
  state: defaultState(),
  listeners: new Set(),
  async load() {
    const saved = await db.get('kv', 'state');
    if (saved) this.state = mergeDefaults(saved);
    return this.state;
  },
  _t: 0,
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => db.put('kv', 'state', this.state).catch(e => console.error(e)), 250);
    this.listeners.forEach(fn => fn(this.state));
  },
  async saveNow() { clearTimeout(this._t); await db.put('kv', 'state', this.state); },
  replace(next) { this.state = mergeDefaults(next); this.save(); },
};

function mergeDefaults(s) {
  const d = defaultState();
  return {
    ...d, ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    scripts: { ...d.scripts, ...(s.scripts || {}) },
    match: { ...d.match, ...(s.match || {}), singer: { ...d.match.singer, ...((s.match || {}).singer || {}) } },
    files: { ...d.files, ...(s.files || {}) },
    teams: (s.teams && s.teams.length ? s.teams : d.teams),
  };
}

// ---------- People & pronunciation ----------

// What the announcer actually says for a person: the "say as" respelling if given, else the written name.
export const spoken = (person) => (person.say && person.say.trim()) || (person.name || '').trim();
// Approval is tied to the exact spoken text, so editing a name or respelling automatically un-approves it.
export const isApproved = (person) => !!spoken(person) && person.approved === spoken(person);
export const approve = (person) => { person.approved = spoken(person); };

export const teamById = (id) => store.state.teams.find(t => t.id === id);
export const homeTeam = () => teamById(store.state.match.homeId);
export const visitorTeam = () => teamById(store.state.match.visitorId);

export const schoolSaid = (t) => (t && ((t.schoolSay || '').trim() || t.school)) || '';
export const mascotSaid = (t) => (t && ((t.mascotSay || '').trim() || t.mascot)) || '';

// Every person whose name will be read in the current match, with where they come from.
export function matchPeople() {
  const s = store.state, out = [];
  const add = (team, side) => {
    if (!team) return;
    const label = team.mascot || team.school || (side === 'home' ? 'Home' : 'Visitor');
    team.players.forEach(p => { if (p.name.trim()) out.push({ person: p, role: 'Athlete', team: label, side }); });
    const mgrOn = side === 'home' ? s.match.homeManager : s.match.visitorManager;
    if (mgrOn && team.manager.name.trim()) out.push({ person: team.manager, role: 'Manager', team: label, side });
    if (team.coach.name.trim()) out.push({ person: team.coach, role: 'Head coach', team: label, side });
  };
  add(visitorTeam(), 'visitor');
  add(homeTeam(), 'home');
  if (s.match.anthemMode === 'live' && s.match.singer.name.trim()) out.push({ person: s.match.singer, role: 'Anthem singer', team: '', side: 'anthem' });
  return out;
}
