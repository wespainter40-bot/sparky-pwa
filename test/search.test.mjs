// node test/search.test.mjs — lookup cap, early return and DuckDuckGo circuit breaker (mock sources, no network)
import { lookup, _setSources, resetBreaker, breakerState, LOOKUP_CAP_MS } from '../src/search.js';
let fails = 0;
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, x); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hit = (source) => ({ source, title: 't', text: 'x', url: '' });
const Q = 'what is the capital of France';
const timed = async (q, cap) => { const t = Date.now(); const r = await lookup(q, cap); return [r, Date.now() - t]; };
const calls = { ddg: 0, wiki: 0 };
const set = (ddg, wiki) => { calls.ddg = calls.wiki = 0; _setSources({ duckDuckGo: async () => { calls.ddg++; return ddg(); }, wikipedia: async () => { calls.wiki++; return wiki(); } }); };

ok('cap is ~1.2 s', LOOKUP_CAP_MS === 1200);

// early return: fast Wikipedia is not held up by a slow DuckDuckGo
resetBreaker(); set(() => wait(5000).then(() => hit('DuckDuckGo')), () => wait(60).then(() => hit('Wikipedia')));
let [r, ms] = await timed(Q);
ok('first useful result wins, slow source not awaited', r?.source === 'Wikipedia' && ms < 400, `${ms}ms`);

// ...and the other way round
resetBreaker(); set(() => wait(40).then(() => hit('DuckDuckGo')), () => wait(900).then(() => hit('Wikipedia')));
[r, ms] = await timed(Q); ok('fast DuckDuckGo wins too', r?.source === 'DuckDuckGo' && ms < 400, `${ms}ms`);

// an empty answer from the fast source does not end the race
resetBreaker(); set(() => wait(300).then(() => hit('DuckDuckGo')), () => wait(20).then(() => null));
[r, ms] = await timed(Q); ok('empty fast answer: waits for the other', r?.source === 'DuckDuckGo' && ms >= 250 && ms < 700, `${ms}ms`);

// both empty -> null right away
resetBreaker(); set(() => null, () => null);
[r, ms] = await timed(Q); ok('both empty -> null immediately', r === null && ms < 150, `${ms}ms`);

// cap: both hang
resetBreaker(); set(() => wait(5000), () => wait(5000));
[r, ms] = await timed(Q, 300); ok('cap honoured when both hang', r === null && ms >= 280 && ms < 600, `${ms}ms`);
[r, ms] = await timed(Q); ok('default cap ~1.2 s', r === null && ms >= 1100 && ms < 1600, `${ms}ms`);

// heuristics: chit-chat never looks anything up
set(() => hit('DuckDuckGo'), () => hit('Wikipedia'));
[r] = await timed('hi sparky'); ok('no lookup for chit-chat', r === null && calls.ddg + calls.wiki === 0);

// breaker: 2 DuckDuckGo failures in a row -> skipped
resetBreaker(); set(() => { throw new Error('timeout'); }, () => hit('Wikipedia'));
await lookup(Q); ok('1 failure: still closed', !breakerState().open && breakerState().fails === 1);
await lookup(Q); ok('2 failures: breaker open', breakerState().open);
const before = calls.ddg; [r] = await timed(Q);
ok('open breaker skips DuckDuckGo, Wikipedia still answers', calls.ddg === before && r?.source === 'Wikipedia');
const left = breakerState().until - Date.now(); ok('skip lasts ~10 min', left > 9.5 * 60e3 && left <= 10 * 60e3, `${Math.round(left / 1000)}s`);

// breaker: a success resets the streak; non-consecutive failures never open it
resetBreaker(); let n = 0; set(() => { if (++n % 2) throw new Error('boom'); return hit('DuckDuckGo'); }, () => wait(200).then(() => hit('Wikipedia')));
for (let i = 0; i < 4; i++) await lookup(Q);
ok('alternating failures do not open it', !breakerState().open);

// breaker closes again after the pause
resetBreaker(); set(() => { throw new Error('x'); }, () => hit('Wikipedia')); await lookup(Q); await lookup(Q);
ok('opened', breakerState().open);
const real = Date.now; Date.now = () => real() + 10 * 60e3 + 1000;
const b4 = calls.ddg; await lookup(Q); Date.now = real;
ok('after 10 min DuckDuckGo is tried again', calls.ddg === b4 + 1);

console.log('FAILS', fails); process.exit(fails ? 1 : 0);
