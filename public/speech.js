// Pure text helpers for speech output (no DOM): make model text sound natural, and cut it into speakable pieces.
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'e.g', 'i.e', 'etc', 'approx', 'no', 'jr', 'sr', 'prof', 'mt', 'u.s', 'a.m', 'p.m', 'inc', 'ltd']);

/** markdown, links, emoji and symbols -> plain words that a voice can say */
export function cleanForSpeech(text) {
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1');                     // code
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');    // images, [text](url) -> text
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\b[\w.-]+\.(?:com|org|net|io|gov|edu)\b\S*/gi, ' ');   // bare links are not read aloud
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s{0,3}>\s?/gm, '');                // headings, quotes
  t = t.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/gm, '');                                   // bullets / numbered lists (the number is not spoken)
  t = t.replace(/(\*\*|__|\*|_|~~)/g, '');                                                // emphasis markers
  t = t.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '');                         // emoji
  t = t.replace(/\be\.g\.,?/gi, 'for example,').replace(/\bi\.e\.,?/gi, 'that is,').replace(/\betc\./gi, 'and so on.').replace(/\bvs\.?(?=\s)/gi, 'versus');
  t = t.replace(/\b(Dr|Mr|Mrs|Ms|St|Mt|Prof)\./g, (m, a) => ({ Dr: 'Doctor', Mr: 'Mister', Mrs: 'Missus', Ms: 'Miss', St: 'Saint', Mt: 'Mount', Prof: 'Professor' }[a]));
  t = t.replace(/(-?\d+(?:\.\d+)?)\s?°\s?([CF])\b/g, (m, n, u) => `${n} degrees ${u === 'C' ? 'Celsius' : 'Fahrenheit'}`).replace(/°/g, ' degrees ');
  t = t.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, '$1 dollars').replace(/(\d)\s?%/g, '$1 percent').replace(/\s%/g, ' percent');
  t = t.replace(/\band\/or\b/gi, 'and or').replace(/(\w)\/(\w)/g, '$1 or $2');
  t = t.replace(/\s*&\s*/g, ' and ').replace(/\s*\+\s*(?=\d)/g, ' plus ').replace(/\s=\s/g, ' equals ').replace(/~\s?(?=\d)/g, 'about ').replace(/\s*[×x]\s*(?=\d)(?<=\d\s*[×x]\s*)/g, ' times ');
  t = t.replace(/[<>{}\[\]|\\^]/g, ' ').replace(/[#*_~`]/g, '');
  t = t.replace(/\s*[-\u2013\u2014]{1,2}\s+/g, ', ').replace(/\.{3,}|\u2026/g, '...');  // dashes become a pause
  return t.replace(/\s+/g, ' ').trim();
}

/** true when the text before position i ends in an abbreviation or a number like "3." (not a real sentence end) */
function notAnEnd(s, i) {
  const m = /([A-Za-z.]+)$/.exec(s.slice(0, i + 1).replace(/[.!?]+$/, ''));
  const w = m ? m[1].toLowerCase() : '';
  if (w && ABBR.has(w.replace(/\.$/, ''))) return true;
  return /\b[A-Z]$/.test(s.slice(0, i).trim()) && s[i] === '.';        // an initial: "J. K. Rowling"
}

/** Incrementally split streamed text. Returns { sentences, rest }. With `first` true, a long first sentence is also allowed to start
 *  at a comma, so the voice starts as early as possible. */
export function takeSentences(buf, { first = false, max = 190 } = {}) {
  const out = []; let s = buf;
  for (;;) {
    let cut = -1;
    const re = /[.!?]+["')\]]*(?=\s)/g; let m;
    while ((m = re.exec(s))) {
      const end = m.index + m[0].length;
      if (/\d\.$/.test(m[0]) && /^\s*\d/.test(s.slice(end))) continue;        // 3. 5 style splits
      if (notAnEnd(s, m.index)) continue;
      cut = end; break;
    }
    if (cut < 0 && s.length > max) {                                            // very long run without a stop: cut at a comma / space
      const c = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf('; ', max), s.lastIndexOf(': ', max));
      cut = c > 30 ? c + 1 : s.lastIndexOf(' ', max) > 30 ? s.lastIndexOf(' ', max) : max;
    }
    if (cut < 0 && first && !out.length && s.length >= 55) {                    // speak sooner: break the very first clause at a comma
      const c = s.indexOf(', ', 35);
      if (c > 0 && c < 120) cut = c + 1;
    }
    if (cut < 0) break;
    const piece = s.slice(0, cut).trim();
    if (piece) out.push(piece);
    s = s.slice(cut).replace(/^\s+/, '');
    first = false;
  }
  return { sentences: out, rest: s };
}

/** one finished piece of text -> utterance-sized chunks (Chrome stops long utterances after ~15 s) */
export function chunkForSpeech(text, max = 180) {
  const t = cleanForSpeech(text);
  if (!t) return [];
  const out = []; let rest = t;
  while (rest.length > max) {
    const { sentences, rest: r } = takeSentences(rest + ' ', { max });
    if (!sentences.length) break;
    out.push(...sentences); rest = r.trim();
  }
  if (rest) out.push(rest);
  return out.flatMap((p) => (p.length > max * 1.4 ? p.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')).map((x) => x.trim()) : [p])).filter((p) => /[\p{L}\p{N}]/u.test(p));
}

/** rough speaking time (ms) for the watchdog: used when a browser never fires onend */
export const speakMs = (text, rate = 1) => 3500 + (String(text).length * 90) / Math.max(0.5, rate);
