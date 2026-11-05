// 기여 기록 카드(activity.svg, activity-dark.svg)를 만든다. GITHUB_TOKEN 으로 기여 달력을 읽는다.
// 사용: GITHUB_TOKEN=... node activity.mjs <사용자> <출력 폴더>
import fs from 'fs';

const [user, out = 'dist'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!user || !token) throw new Error('usage: GITHUB_TOKEN=... node activity.mjs <user> [outDir]');

async function gql(query, variables) {
	const r = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables })
	});
	const j = await r.json();
	if (j.errors) throw new Error(JSON.stringify(j.errors));
	return j.data;
}

const Q = `query($u:String!,$f:DateTime!,$t:DateTime!){user(login:$u){contributionsCollection(from:$f,to:$t){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
const { user: info } = await gql('query($u:String!){user(login:$u){createdAt}}', { u: user });
const now = new Date();
const days = new Map();
for (let y = new Date(info.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
	const f = new Date(Date.UTC(y, 0, 1)).toISOString();
	const t = (y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59))).toISOString();
	const d = await gql(Q, { u: user, f, t });
	for (const w of d.user.contributionsCollection.contributionCalendar.weeks)
		for (const x of w.contributionDays) days.set(x.date, x.contributionCount);
}
const list = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
// 총합은 프로필 잔디와 같은 범위(지난 1년)로 센다
const { user: yr } = await gql('query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{totalContributions}}}}', { u: user });
const total = yr.contributionsCollection.contributionCalendar.totalContributions;

// 연속 기록: 오늘 기여가 아직 없으면 어제부터 센다
let cur = 0, i = list.length - 1;
if (list[i][1] === 0) i--;
for (; i >= 0 && list[i][1] > 0; i--) cur++;
let best = 0, run = 0;
for (const [, c] of list) { run = c > 0 ? run + 1 : 0; best = Math.max(best, run); }

// 언어 비율: STATS_TOKEN(비공개 저장소를 읽는 토큰)이 있으면 새로 세고, 없으면 저장해 둔 집계를 쓴다
const LANG_FILE = new URL('../data/languages.json', import.meta.url);
const HIDE = new Set(['HTML', 'CSS', 'SCSS', 'Shell', 'PowerShell', 'Batchfile', 'Dockerfile', 'Makefile']);
async function countLanguages(tk) {
	const sum = {}, color = {};
	let after = null, repos = 0;
	do {
		const r = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: `query($a:String){viewer{repositories(first:50,after:$a,ownerAffiliations:OWNER,isFork:false){pageInfo{hasNextPage endCursor} nodes{isArchived languages(first:20,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}}}}}`, variables: { a: after } })
		}).then(r => r.json());
		if (r.errors) throw new Error(JSON.stringify(r.errors));
		const rs = r.data.viewer.repositories;
		for (const n of rs.nodes) {
			if (n.isArchived) continue;
			repos++;
			for (const e of n.languages.edges) { sum[e.node.name] = (sum[e.node.name] || 0) + e.size; color[e.node.name] = e.node.color; }
		}
		after = rs.pageInfo.hasNextPage ? rs.pageInfo.endCursor : null;
	} while (after);
	const shown = Object.entries(sum).filter(([n]) => !HIDE.has(n));
	const total = shown.reduce((a, [, v]) => a + v, 0);
	return { repos, langs: shown.sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, color: color[name], pct: +(v / total * 100).toFixed(1) })) };
}
let lang;
if (process.env.STATS_TOKEN) {
	lang = await countLanguages(process.env.STATS_TOKEN);
	if (process.env.SAVE_LANGUAGES) fs.writeFileSync(LANG_FILE, JSON.stringify(lang, null, 1) + '\n');
} else lang = JSON.parse(fs.readFileSync(LANG_FILE, 'utf8'));

const fmt = n => n.toLocaleString('en-US');

// narrow: 휴대폰용. 기여 수와 연속 기록을 위에 나란히, 언어를 아래에 둔다
function card(t, narrow = false) {
	const W = narrow ? 480 : 840, H = narrow ? 396 : 210;
	const g1 = narrow ? 'translate(-20 0)' : '', g2 = narrow ? 'translate(-60 0)' : '', g3 = narrow ? 'translate(-460 196)' : '';
	// 1열: 숫자가 올라가는 장면 14장
	const N = 14, step = 0.07;
	const frames = Array.from({ length: N }, (_, k) => {
		const p = 1 - Math.pow(1 - (k + 1) / N, 3);
		const v = k === N - 1 ? total : Math.round(total * p);
		const last = k === N - 1;
		return `<text class="num cnt${last ? ' last' : ''}" x="140" y="112" style="animation-delay:${(k * step).toFixed(2)}s">${fmt(v)}</text>`;
	}).join('');
	// 2열: 연속 기록 원
	const R = 44, C = 2 * Math.PI * R, cx = 420, cy = 92;
	// 3열: 언어별 가로 막대(가장 많은 언어를 꽉 찬 길이로)
	const top = lang.langs.slice(0, 4), LX = 596, BX = 676, LW = 96;
	const label = { PLpgSQL: 'PL/pgSQL' };
	const rows = top.map((l, k) => {
		const y = 56 + k * 24, w = Math.max(4, (l.pct / top[0].pct) * LW), d = (0.4 + k * 0.12).toFixed(2);
		return `<g class="leg" style="animation-delay:${d}s"><text class="li" x="${LX}" y="${y}">${label[l.name] ?? l.name}</text>`
			+ `<rect x="${BX}" y="${y - 8}" width="${LW}" height="8" rx="4" fill="${t.track}"/>`
			+ `<rect class="seg" x="${BX}" y="${y - 8}" width="${w.toFixed(1)}" height="8" rx="4" fill="${l.color}" style="animation-delay:${d}s"/>`
			+ `<text class="lp" x="${BX + LW + 48}" y="${y}">${Math.round(l.pct)}%</text></g>`;
	}).join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${fmt(total)} contributions, ${cur} day streak">
<style>
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;text-anchor:middle}
.num{font-size:40px;font-weight:700;fill:${t.fg}}
.lab{font-size:14px;font-weight:600;fill:${t.fg}}
.sub{font-size:12px;fill:${t.muted}}
.cnt{opacity:0;animation:show ${step}s linear}
.cnt.last{animation:show ${step}s linear forwards,glow 3.2s ease-in-out ${(N * step + 0.4).toFixed(2)}s infinite}
@keyframes show{from,to{opacity:1}}
@keyframes glow{0%,100%{fill:${t.fg}}50%{fill:${t.accent}}}
.ring{stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${C.toFixed(1)};animation:draw 1.3s cubic-bezier(.3,.7,.2,1) .2s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.orbit{transform-origin:${cx}px ${cy}px;animation:spin 4.5s linear 1.5s infinite;opacity:0}
@keyframes spin{0%{transform:rotate(-90deg);opacity:1}100%{transform:rotate(270deg);opacity:1}}
.fl{transform-box:fill-box;transform-origin:50% 100%}
.f1{animation:b1 .9s ease-in-out infinite}
.f2{animation:b2 .7s ease-in-out infinite}
.f3{animation:b3 .55s ease-in-out infinite}
.f4{animation:b2 .45s ease-in-out infinite reverse}
@keyframes b1{0%,100%{transform:scale(1,1) skewX(0)}25%{transform:scale(.9,1.14) skewX(-5deg)}50%{transform:scale(1.06,.93) skewX(3deg)}75%{transform:scale(.94,1.1) skewX(4deg)}}
@keyframes b2{0%,100%{transform:scale(1,1) skewX(0)}30%{transform:scale(1.08,.9) skewX(5deg)}60%{transform:scale(.88,1.16) skewX(-4deg)}}
@keyframes b3{0%,100%{transform:scale(1,1) translateY(0)}50%{transform:scale(.85,1.2) translateY(-1px)}}
.glow{transform-box:fill-box;transform-origin:50% 50%;animation:glow2 1.2s ease-in-out infinite}
@keyframes glow2{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.95;transform:scale(1.18)}}
.em{opacity:0}
.e1{animation:r1 1.5s ease-out infinite}
.e2{animation:r2 1.8s ease-out .5s infinite}
.e3{animation:r3 1.3s ease-out .9s infinite}
.e4{animation:r1 1.7s ease-out 1.2s infinite}
@keyframes r1{0%{opacity:0;transform:translate(0,0)}15%{opacity:1}100%{opacity:0;transform:translate(-9px,-30px)}}
@keyframes r2{0%{opacity:0;transform:translate(0,0)}15%{opacity:1}100%{opacity:0;transform:translate(8px,-34px)}}
@keyframes r3{0%{opacity:0;transform:translate(0,0)}15%{opacity:1}100%{opacity:0;transform:translate(-3px,-26px)}}
.pop{opacity:0;animation:pop .5s ease-out 1.1s forwards}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.seg{transform-box:fill-box;transform-origin:0 50%;transform:scaleX(0);animation:fill .5s cubic-bezier(.3,.8,.3,1) forwards}
@keyframes fill{to{transform:scaleX(1)}}
.li{font-size:12px;fill:${t.fg};text-anchor:start}
.lp{font-size:12px;fill:${t.muted};text-anchor:end;font-variant-numeric:tabular-nums}
.leg{opacity:0;animation:pop .5s ease-out forwards}
.fade{opacity:0;animation:pop .6s ease-out .3s forwards}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.cnt{opacity:0}.cnt.last,.pop,.fade,.orbit,.leg{opacity:1}.ring{stroke-dashoffset:0}.seg{transform:none}}
</style>
${narrow ? `<line x1="240" y1="30" x2="240" y2="186" stroke="${t.line}"/>
<line x1="40" y1="204" x2="440" y2="204" stroke="${t.line}"/>` : `<line x1="280" y1="30" x2="280" y2="186" stroke="${t.line}"/>
<line x1="560" y1="30" x2="560" y2="186" stroke="${t.line}"/>`}
<g transform="${g1}">
${frames}
<text class="lab fade" x="140" y="160">Contributions</text>
<text class="sub fade" x="140" y="180">in the last year</text>
</g>
<g transform="${g2}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.ring[0]}"/><stop offset="1" stop-color="${t.ring[1]}"/></linearGradient>
<radialGradient id="dot"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${t.ring[1]}"/><stop offset="1" stop-color="${t.ring[1]}" stop-opacity="0"/></radialGradient></defs>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${t.track}" stroke-width="7"/>
<circle class="ring" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
<g class="orbit"><circle cx="${cx + R}" cy="${cy}" r="7" fill="url(#dot)"/></g>
<defs><radialGradient id="fg"><stop offset="0" stop-color="#FB923C" stop-opacity=".9"/><stop offset=".6" stop-color="#F97316" stop-opacity=".25"/><stop offset="1" stop-color="#F97316" stop-opacity="0"/></radialGradient></defs>
<g transform="translate(${cx} ${cy - R + 3}) scale(.86)">
<ellipse class="glow" cx="0" cy="-16" rx="26" ry="28" fill="url(#fg)"/>
<path class="fl f1" d="M0-44C7-33 18-26 18-13C18-3 10 3 0 3S-18-3-18-13C-18-22-11-27-9-34C-7-27-4-24-1-23C-2-31-4-37 0-44Z" fill="#EA580C"/>
<path class="fl f2" d="M1-34C6-26 13-21 13-11C13-3 7 2 0 2S-13-3-13-11C-13-18-8-21-6-26C-5-21-3-18-1-18C-1-24-2-29 1-34Z" fill="#F97316"/>
<path class="fl f3" d="M0-22C4-16 8-13 8-7C8-2 4 1 0 1S-8-2-8-7C-8-12-4-15-3-18C-2-15-1-14 0-13C0-17-1-19 0-22Z" fill="#FBBF24"/>
<path class="fl f4" d="M0-11C2-8 4-6 4-3C4-1 2 0 0 0S-4-1-4-3C-4-6-2-8 0-11Z" fill="#FEF3C7"/>
<circle class="em e1" cx="-3" cy="-36" r="2.2" fill="#FBBF24"/><circle class="em e2" cx="4" cy="-32" r="1.9" fill="#FB923C"/><circle class="em e3" cx="1" cy="-40" r="1.7" fill="#FDE68A"/><circle class="em e4" cx="-6" cy="-30" r="1.8" fill="#F97316"/>
</g>
<text class="num pop" x="${cx}" y="${cy + 11}" style="font-size:32px">${cur}</text>
<text class="lab pop" x="${cx}" y="160" style="fill:${t.accent}">Day streak</text>
</g>
<g transform="${g3}">
${rows}
<text class="lab fade" x="700" y="160">Top languages</text>
<text class="sub fade" x="700" y="180">${lang.repos} repositories</text>
</g>
</svg>`;
}

const light = { fg: '#1F2328', muted: '#59636E', line: '#D0D7DE', track: '#EAEEF2', accent: '#1A7F37', other: '#D0D7DE', ring: ['#2DA44E', '#7EE787'], fire: ['#F97316', '#FBBF24'], lv: ['#EBEDF0', '#9BE9A8', '#40C463', '#30A14E', '#216E39'] };
const dark = { fg: '#E6EDF3', muted: '#9198A1', line: '#30363D', track: '#21262D', accent: '#3FB950', other: '#484F58', ring: ['#2EA043', '#7EE787'], fire: ['#F97316', '#FBBF24'], lv: ['#161B22', '#0E4429', '#006D32', '#26A641', '#39D353'] };
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/activity.svg`, card(light));
fs.writeFileSync(`${out}/activity-dark.svg`, card(dark));
fs.writeFileSync(`${out}/activity-narrow.svg`, card(light, true));
fs.writeFileSync(`${out}/activity-narrow-dark.svg`, card(dark, true));
console.log(`last year ${total}, streak ${cur}, longest ${best}`);
