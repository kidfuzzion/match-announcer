// Turns pasted roster text (MaxPreps table, school website, emailed list, or iPhone Live Text
// from a printed roster) into players, in the order they appear.

const GRADE_WORDS = {
  '7': '7th', '7th': '7th', seventh: '7th',
  '8': '8th', '8th': '8th', eighth: '8th',
  fr: 'Fr', fresh: 'Fr', freshman: 'Fr', '9': 'Fr', '9th': 'Fr',
  so: 'So', soph: 'So', sophomore: 'So', '10': 'So', '10th': 'So',
  jr: 'Jr', junior: 'Jr', '11': 'Jr', '11th': 'Jr',
  sr: 'Sr', senior: 'Sr', '12': 'Sr', '12th': 'Sr',
};
export const GRADE_SPOKEN = { '7th': 'seventh-grade', '8th': 'eighth-grade', Fr: 'freshman', So: 'sophomore', Jr: 'junior', Sr: 'senior' };

// Longest phrases first so "right side hitter" wins over "right side".
const POS_PHRASES = [
  ['defensive specialist', 'DS'], ['outside hitter', 'OH'], ['middle blocker', 'MB'], ['middle hitter', 'MH'],
  ['right side hitter', 'RS'], ['right side', 'RS'], ['opposite hitter', 'OPP'], ['outside', 'OH'], ['middle', 'MB'],
  ['opposite', 'OPP'], ['setter', 'S'], ['libero', 'L'],
];
const POS_ABBR = ['OH', 'MB', 'MH', 'RS', 'RSH', 'OPP', 'OP', 'S', 'L', 'DS', 'LIB', 'SET', 'RH'];
export const POS_SPOKEN = {
  OH: 'outside hitter', MB: 'middle blocker', MH: 'middle hitter', RS: 'right side hitter', RSH: 'right side hitter',
  RH: 'right side hitter', OPP: 'opposite hitter', OP: 'opposite hitter', S: 'setter', SET: 'setter',
  L: 'libero', LIB: 'libero', DS: 'defensive specialist',
};

export const gradeSpoken = (g) => GRADE_SPOKEN[normGrade(g)] || (g || '').trim().toLowerCase();
export function positionSpoken(pos) {
  const p = (pos || '').trim();
  if (!p) return '';
  // "OH/DS" → "outside hitter and defensive specialist"
  const parts = p.split(/\s*[\/,&]\s*|\s+and\s+/i).filter(Boolean);
  return parts.map(x => POS_SPOKEN[x.toUpperCase()] || x.toLowerCase()).join(' and ');
}

function normGrade(g) {
  const k = String(g || '').toLowerCase().replace(/\./g, '').replace(/\b(grade|gr)\b/g, '').trim();
  return GRADE_WORDS[k] || '';
}

const HEIGHT_RE = /\b[4-7]\s*['’′]\s*\d{1,2}\s*(?:["”″]|'')?|\b[4-7]-\d{1,2}\b/g;

function titleCaseIfShouting(name) {
  if (!name || name !== name.toUpperCase() || !/[A-Z]{2}/.test(name)) return name;
  return name.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
}

function cleanName(raw) {
  let n = raw.replace(/[#*•·|]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^[,.;:\-–—\s]+|[,;:\-–—\s]+$/g, '');
  const m = n.match(/^([^,]+),\s*([^,]+)$/);          // "Smith, Jane" → "Jane Smith"
  if (m) n = `${m[2].trim()} ${m[1].trim()}`;
  return titleCaseIfShouting(n);
}

function takePosition(text) {
  let rest = text, found = [];
  const lower = () => rest.toLowerCase();
  for (const [phrase, code] of POS_PHRASES) {
    const i = lower().search(new RegExp(`\\b${phrase}\\b`));
    if (i >= 0) { found.push(code); rest = rest.slice(0, i) + ' ' + rest.slice(i + phrase.length); }
  }
  // Abbreviations, including combos like OH/DS. Single letters (S, L) only when uppercase and standalone.
  rest = rest.replace(/(^|[\s,(])((?:[A-Za-z]{1,3})(?:\s*\/\s*[A-Za-z]{1,3})+|[A-Za-z]{1,3})(?=$|[\s,)])/g, (m, pre, tok) => {
    const parts = tok.split('/').map(x => x.trim());
    const ok = parts.every(x => POS_ABBR.includes(x.toUpperCase()) && (x.length > 1 ? x === x.toUpperCase() : x === x.toUpperCase()));
    if (!ok) return m;
    if (parts.length === 1 && parts[0].length === 1 && found.length) return m;
    found.push(parts.map(x => x.toUpperCase()).join('/'));
    return pre + ' ';
  });
  return { position: [...new Set(found)].join('/'), rest };
}

function parseFree(line) {
  let s = ' ' + line.replace(/\t/g, ' ') + ' ';
  s = s.replace(HEIGHT_RE, ' ');
  let number = '', grade = '';

  let m = s.match(/^\s*(?:#|no\.?\s*)?(\d{1,2})\b[\s.,:)\-–]*/i);
  if (m) { number = m[1]; s = s.slice(m[0].length); }
  else if ((m = s.match(/(?:#|\bno\.?\s*)(\d{1,2})\b/i))) { number = m[1]; s = s.replace(m[0], ' '); }

  const gm = s.match(/\b(freshman|sophomore|junior|senior|fresh|soph|seventh|eighth|fr|so|jr|sr)\b\.?(?:\s+grade\b)?|\b([7-9]|1[0-2])th\b(?:\s+grade\b)?|\bgr(?:ade|\.)?\s*([7-9]|1[0-2])\b/i);
  if (gm) { grade = normGrade(gm[1] || gm[2] || gm[3]); s = s.replace(gm[0], ' '); }

  const pos = takePosition(s); s = pos.rest;

  if (!number) {
    const tm = s.match(/\b(\d{1,2})\s*$/) || s.match(/^\s*(\d{1,2})\b/);
    if (tm) { number = tm[1]; s = s.replace(tm[0], ' '); }
  }
  if (!grade) {
    const g2 = s.match(/\b([7-9]|1[0-2])\b/);
    if (g2 && number) { grade = normGrade(g2[1]); s = s.replace(g2[0], ' '); }
  }
  s = s.replace(/\b\d+(st|nd|rd|th)?\b/gi, ' ');        // leftover numbers (weights, years, ordinals)
  return { number, name: cleanName(s), grade, position: pos.position };
}

const HEADER_KEYS = {
  number: /^(#|no\.?|num(ber)?|jersey|uni(form)?)$/i,
  name: /^(name|player|athlete|full name)$/i,
  first: /^first( name)?$/i,
  last: /^last( name)?$/i,
  grade: /^(gr\.?|grade|yr\.?|year|class|cl\.?)$/i,
  position: /^(pos\.?|position)$/i,
};

function headerMap(cells) {
  const map = {};
  cells.forEach((c, i) => {
    const t = c.trim();
    for (const [k, re] of Object.entries(HEADER_KEYS)) if (re.test(t) && !(k in map)) map[k] = i;
  });
  return ('name' in map || 'last' in map) ? map : null;
}

export function parseRoster(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/ /g, ' ')).filter(l => l.trim());
  const players = []; let coach = '', manager = '';
  let cols = null;

  for (const line of lines) {
    const cells = line.split('\t');
    if (cells.length > 1) {
      const hm = headerMap(cells);
      if (hm) { cols = hm; continue; }
    }
    if (/^\s*(#|no\.?)?\s*(name|player|athlete)\b/i.test(line) && !/\d/.test(line)) continue;  // header without tabs

    const staff = line.match(/^\s*(?:(head)\s+)?(coach|manager|team manager|asst\.?\s*coach|assistant coach)\s*[:\-–]?\s*(.+)$/i)
      || line.match(/^(.+?)\s*[,\-–:(]\s*(head coach|coach|team manager|manager)\)?\s*$/i);
    if (staff) {
      const role = (staff[2] || '').toLowerCase();
      const who = cleanName(staff[3] || staff[1]);
      if (/assistant|asst/.test(role) || /assistant|asst/i.test(line)) continue;
      if (/manager/.test(role)) manager = manager || who; else coach = coach || who;
      continue;
    }

    let p;
    if (cols && cells.length > 1) {
      const get = (k) => (k in cols ? (cells[cols[k]] || '').trim() : '');
      const name = get('name') || [get('first'), get('last')].filter(Boolean).join(' ');
      const num = (get('number').match(/\d{1,2}/) || [''])[0];
      const posRaw = get('position');
      p = { number: num, name: cleanName(name), grade: normGrade(get('grade')) || get('grade'), position: posRaw ? (takePosition(posRaw).position || posRaw) : '' };
    } else {
      p = parseFree(line);
    }
    if (!/[A-Za-zÀ-ÿ]/.test(p.name)) continue;
    players.push(p);
  }
  return { players, coach, manager };
}
