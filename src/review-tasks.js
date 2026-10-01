// Vážné nálezy z nočního code review jako úkoly pro agenta Fixer v Paperclipu.
// Fixer nález ověří, opraví ve vlastní kopii repozitáře a otevře pull request;
// mergeuje Erik (Dispečink → Ke kontrole). Spouští scripts/daily.sh po review.js.
//   node src/review-tasks.js              poslední review
//   node src/review-tasks.js --dry        jen vypíše, co by založil
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const STATE = join(ROOT, 'out', 'review-tasks.json');
const API = 'http://127.0.0.1:3100/api';
const OWNER = 'ErikKarasek';
const MAX = 6; // za noc; každý úkol stojí Fixera kus limitu Claude
const dry = process.argv.includes('--dry');

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
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: [] };
if (state.done.includes(day)) {
  console.log(`[${new Date().toISOString()}] review ${day}: úkoly už založené`);
  process.exit(0);
}

const picked = findings(readFileSync(file, 'utf8'))
  .filter((x) => x.severity !== 'low')
  .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
  .slice(0, MAX);

try {
  const company = (await api('GET', '/companies')).find((c) => c.name === 'Nexus Grind Ops');
  const agents = await api('GET', `/companies/${company.id}/agents`);
  const fixer = agents.find((a) => a.name === 'Fixer' && a.status !== 'terminated');
  const project = (await api('GET', `/companies/${company.id}/projects`)).find((p) => p.name === 'Moje projekty a web');
  const existing = new Set((await api('GET', `/companies/${company.id}/issues`)).map((i) => i.title));
  let made = 0;
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
  }
  if (fixer && made && !dry) await api('POST', `/agents/${fixer.id}/heartbeat/invoke`, {}).catch(() => {});
  if (!dry) {
    state.done = [...state.done, day].slice(-30);
    writeFileSync(STATE, JSON.stringify(state, null, 1));
  }
  console.log(`[${new Date().toISOString()}] review ${day}: ${made} úkolů pro Fixera (${picked.length} vážných nálezů)`);
} catch (err) {
  // Paperclip nejede: příště to zkusí znovu (den se nezapsal jako hotový).
  console.log(`[${new Date().toISOString()}] review ${day}: Paperclip neodpovídá (${err.message})`);
}
