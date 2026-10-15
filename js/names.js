// Simple, offline rules that decide which names to put at the top of the review list.
// Every name still gets reviewed; this only orders the list and explains why a name looks risky.

// Names with more than one common pronunciation in the US (lowercase).
const AMBIGUOUS = new Set(`
leah lea leia aubrey kaia kaya maya mya aaliyah aliyah nia tia gianna giana jana dana shana tanya mara
ana anna andrea alana ilana elena helena celine camille genevieve bianca leila layla laila lila keira kiera
ciara chiara kiara talia thalia alia gemma johanna maeve rhiannon xiomara yesenia ximena isla ainsley
desiree esme imani margaux naomi nadia paola raquel rhea seraphina zaria annika anika analise annalise
siobhan saoirse niamh caoimhe aoife sinead sian ione renee simone danica liana bria brielle gabrielle
jolie marisol daria karina carina katia sasha giselle aurelia oriana eliana adriana briana breanna
reagan regan sloane cayla kayla caila jaelyn jaylin kaelyn mckenna mikayla michaela mila milla kamila
camila lucia sofia sophia valeria zoe zoey chloe noemi noelle nyla nyah naya inez ines beatriz
nguyen tran pham huynh truong phan vu vo dang bui ngo duong ly le
kowalczyk wojcik nowak szymanski lewandowski wisniewski zielinski kaczmarek mazur krawczyk
schaefer schaffer lehmann koehler kohler mueller muller schmitt schroeder wagner weber meyer meier
dubois moreau gauthier leclerc thibodeaux boudreaux arceneaux fontenot guidry hebert breaux landry
giordano esposito romano ricci bianchi colombo ferrari gallo greco lombardi marino mancini
xu zhao zhou zhang qian wang huang
juan jose javier jimena julio jorge jesus joaquin guillermo
`.trim().split(/\s+/));

const ODD_CLUSTERS = [
  [/ngu|nhu|ngh/i, 'Vietnamese spelling'],
  [/aoi|aoibh|bhe|bhai|mh(?=[aeiou])|dh(?=[aeiou])/i, 'Irish spelling'],
  [/szcz|cz|sz|rz|wicz|czyk/i, 'Polish or Slavic spelling'],
  [/x[aeiou]|^x|zh|^q(?!u)/i, 'X, Zh, or Q sounds vary'],
  [/ij|uu|ii|aa(?!r)|eu|oo(?=[aeiou])/i, 'Unusual vowel pair'],
  [/eaux$|ault$|ois$|eau|ieux/i, 'French spelling'],
  [/[bcdfghjklmnpqrstvwxz]{5,}/i, 'Long consonant cluster'],
  [/y[bcdfghjklmnpqrstvwxz]{2}|[aeiou]y[aeiou]/i, 'Unusual use of Y'],
];

export function flagName(name) {
  const reasons = [];
  let score = 0;
  const n = (name || '').trim();
  if (!n) return { score: 0, reasons };
  if (/[À-ÖØ-öø-ÿĀ-ž]/.test(n)) { score += 3; reasons.push('Accented letters'); }
  if (/['’]/.test(n.replace(/\b[OD]['’](?=[A-Z])/g, ''))) { score += 2; reasons.push('Apostrophe'); }
  if (/-/.test(n)) { score += 1; reasons.push('Hyphenated'); }
  const words = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, '').split(/[\s-]+/).filter(Boolean);
  for (const w of words) {
    if (AMBIGUOUS.has(w)) { score += 3; reasons.push(`"${cap(w)}" has more than one common pronunciation`); }
  }
  for (const [re, why] of ODD_CLUSTERS) {
    if (words.some(w => re.test(w))) { score += 2; if (!reasons.includes(why)) reasons.push(why); }
  }
  if (words.length > 3) { score += 1; reasons.push('Several name parts'); }
  return { score, reasons: reasons.slice(0, 3) };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
