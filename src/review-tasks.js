// Vážné nálezy z nočního code review jako úkoly pro agenta Fixer v Paperclipu.
// Fixer nález ověří, opraví ve vlastní kopii repozitáře a otevře pull request;
// mergeuje Erik (Dispečink → Ke kontrole). Spouští scripts/daily.sh po review.js.
//   node src/review-tasks.js              poslední review
//   node src/review-tasks.js --dry        jen vypíše, co by založil
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const STATE = join(ROOT, 'out', 'review-tasks.json');
const API = 'http://127.0.0.1:3100/api';
const OWNER = 'ErikKarasek';
const MAX = 8; // za jedno review; každý úkol stojí Fixera kus limitu Claude
const dry = process.argv.includes('--dry');

// .env (Telegram) the same way review.js reads it.
for (const line of existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8').split('\n') : []) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

const api = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
};

function latestReview() {
  const dir = join(ROOT, 'reviews');
  const files = readdirSync(dir).flatMap((y) => readdirSync(join(dir, y)).map((f) => join(dir, y, f))).filter((f) => f.endsWith('.md'));
  return files.sort().at(-1);
}

/** "## repo" sections, each "### 🔴 high — title" with its body up to the next heading. */
function findings(md) {
  const out = [];
  let repo = null;
  let cur = null;
  for (const line of md.split('\n')) {
    const r = /^## (\S+)\s*$/.exec(line);
    const f = /^### \S+ (high|medium|low) — (.+)$/.exec(line);
    if (r) { repo = r[1]; cur = null; continue; }
    if (f && repo) { cur = { repo, severity: f[1], title: f[2].trim(), body: [] }; out.push(cur); continue; }
    if (cur && line.trim() !== '---') cur.body.push(line);
  }
  return out.map((x) => ({ ...x, body: x.body.join('\n').trim() }));
}

const file = latestReview();
const day = file.match(/(\d{4}-\d{2}-\d{2})\.md$/)[1];
const text = readFileSync(file, 'utf8');
// A review run twice in a day (by hand in the afternoon) rewrites the same file: its content tells the runs apart.
const key = `${day}#${createHash('sha1').update(text).digest('hex').slice(0, 10)}`;
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: [] };
if (state.done.includes(key)) {
  console.log(`[${new Date().toISOString()}] review ${day}: úkoly už založené`);
  process.exit(0);
}

// Every high one first, then the medium ones taking turns across repos, so one busy
// repo doesn't use up the whole night's budget.
const serious = findings(text).filter((x) => x.severity !== 'low');
const byRepo = new Map();
for (const x of serious.filter((x) => x.severity === 'medium')) byRepo.set(x.repo, [...(byRepo.get(x.repo) ?? []), x]);
const turns = [];
for (let i = 0; turns.length < serious.length && i < 20; i++) for (const list of byRepo.values()) if (list[i]) turns.push(list[i]);
const picked = [...serious.filter((x) => x.severity === 'high'), ...turns].slice(0, MAX);

try {
  const company = (await api('GET', '/companies')).find((c) => c.name === 'Nexus Grind Ops');
  if (!company) throw new Error('firma Nexus Grind Ops v Paperclipu není');
  const agents = await api('GET', `/companies/${company.id}/agents`);
  const fixer = agents.find((a) => a.name === 'Fixer' && a.status !== 'terminated');
  const project = (await api('GET', `/companies/${company.id}/projects`)).find((p) => p.name === 'Moje projekty a web');
  const existing = new Set((await api('GET', `/companies/${company.id}/issues`)).map((i) => i.title));
  let made = 0;
  const titles = [];
  for (const x of picked) {
    const title = `[review] ${x.repo}: ${x.title}`.slice(0, 200);
    if (existing.has(title)) continue;
    const description = [
      `Repozitář: ${OWNER}/${x.repo}`,
      `Závažnost: ${x.severity}`,
      `Nález z nočního code review (devlog, ${day}). Nejdřív ověř, že platí; když je planý, napiš proč a úkol zavři.`,
      '',
      x.body,
    ].join('\n');
    if (dry) { console.log(`by založil: ${title}`); continue; }
    await api('POST', `/companies/${company.id}/issues`, {
      title, description, status: 'todo', priority: x.severity === 'high' ? 'high' : 'medium',
      assigneeAgentId: fixer?.id ?? null, projectId: project?.id ?? null,
    });
    made++;
    titles.push(`• <b>${esc(x.repo)}</b>: ${esc(x.title)}`);
  }
  if (fixer && made && !dry) {
    await api('POST', `/agents/${fixer.id}/heartbeat/invoke`, {}).catch(() => {});
    await telegram(`🛠 <b>Fixer dostal ${made} ${made === 1 ? 'úkol' : made < 5 ? 'úkoly' : 'úkolů'} z code review</b>\n${titles.join('\n')}\n\nKaždý ověří a opraví v pull requestu; najdeš je ve Wispu → Ke kontrole.`);
  }
  if (!dry) {
    state.done = [...state.done, key].slice(-60);
    writeFileSync(STATE, JSON.stringify(state, null, 1));
  }
  console.log(`[${new Date().toISOString()}] review ${day}: ${made} úkolů pro Fixera (${picked.length} vážných nálezů)`);
} catch (err) {
  // Paperclip nejede: příště to zkusí znovu (den se nezapsal jako hotový).
  console.log(`[${new Date().toISOString()}] review ${day}: Paperclip neodpovídá (${err.message})`);
}
