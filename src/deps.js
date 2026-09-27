// Týdenní kontrola balíčků: pro každé moje repo v ~/Developer bezpečnostní chyby (npm/pnpm
// audit) a zastaralé balíčky (outdated). Jen report do Telegramu, nic neaktualizuje:
// aktualizace bez dozoru v noci umí rozbít build. Pouští ho daily.sh v noci na pondělí.
//   node src/deps.js         pošle report
//   node src/deps.js --dry   jen vypíše
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV = join(homedir(), 'Developer');
const AUTHORS = ['erikkarasek@centrum.cz', '40054004+ErikKarasek@users.noreply.github.com'];
const dry = process.argv.includes('--dry');

for (const line of existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// Jen repa, kde jsem za posledních 90 dní commitnul: naklonované cizí projekty mě nezajímají.
function mine(repo) {
  try {
    return git(repo, 'log', '--all', '-1', '--since=90 days ago', ...AUTHORS.map((a) => `--author=${a}`), '--format=%h').trim() !== '';
  } catch {
    return false;
  }
}

function git(repo, ...a) {
  return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// audit i outdated končí nenulovým kódem právě když něco najdou, takže se kód ignoruje a čte se JSON.
function json(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
  try {
    return JSON.parse(r.stdout || 'null');
  } catch {
    return null;
  }
}

const RANK = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };

function check(name) {
  const repo = join(DEV, name);
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  if (!pkg.dependencies && !pkg.devDependencies && !existsSync(join(repo, 'pnpm-workspace.yaml'))) return null;
  const pnpm = existsSync(join(repo, 'pnpm-lock.yaml'));

  const audit = pnpm ? json('pnpm', ['audit', '--json'], repo) : json('npm', ['audit', '--json'], repo);
  const counts = audit?.metadata?.vulnerabilities ?? {};
  // Nejhorší balíčky podle závažnosti; npm a pnpm je popisují jinak.
  const worst = pnpm
    ? Object.values(audit?.advisories ?? {}).map((a) => ({ name: a.module_name, severity: a.severity }))
    : Object.entries(audit?.vulnerabilities ?? {}).map(([n, v]) => ({ name: n, severity: v.severity, direct: v.isDirect }));
  const top = [...new Map(worst.sort((a, b) => RANK[b.severity] - RANK[a.severity]).map((w) => [w.name, w])).values()]
    .filter((w) => RANK[w.severity] >= 3).slice(0, 4);

  const outdated = (pnpm ? json('pnpm', ['outdated', '-r', '--format', 'json'], repo) : json('npm', ['outdated', '--json'], repo)) ?? {};
  const major = Object.entries(outdated).filter(([, o]) => o.current && o.latest && o.current.split('.')[0] !== o.latest.split('.')[0]);

  return {
    name,
    auditFailed: !audit,
    pm: pnpm ? 'pnpm' : 'npm',
    critical: counts.critical ?? 0,
    high: counts.high ?? 0,
    moderate: counts.moderate ?? 0,
    top,
    outdated: Object.keys(outdated).length,
    major: major.map(([n, o]) => `${n} ${o.current}→${o.latest}`).slice(0, 3),
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const repos = readdirSync(DEV, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(DEV, e.name, 'package.json')) && existsSync(join(DEV, e.name, 'node_modules')))
  .map((e) => e.name)
  .filter((n) => mine(join(DEV, n)));

// Jeden rozbitý package.json nesmí shodit report pro všechna ostatní repa.
const broken = [];
const safeCheck = (name) => {
  try {
    return check(name);
  } catch (e) {
    broken.push(name);
    console.error(`${name}: ${e.message}`);
    return null;
  }
};
const results = repos.map(safeCheck).filter(Boolean).sort((a, b) => b.critical - a.critical || b.high - a.high);
const lines = ['<b>📦 Týdenní kontrola balíčků</b>', ''];
for (const r of results) {
  // Bez výsledku auditu (offline, chyba) nic nevíme; "bez chyb" by bylo falešné uklidnění.
  const sec = r.auditFailed ? '⚠️ audit selhal'
    : r.critical || r.high ? `🔴 ${r.critical} kritických, ${r.high} vážných` : r.moderate ? `🟡 ${r.moderate} středních` : '✅ bez známých chyb';
  lines.push(`<b>${esc(r.name)}</b>: ${sec} · zastaralých ${r.outdated}`);
  if (r.top.length) lines.push(`  ${r.top.map((t) => `${esc(t.name)} (${t.severity})`).join(', ')}`);
  if (r.major.length) lines.push(`  nová hlavní verze: ${esc(r.major.join(', '))}`);
}
if (broken.length) lines.push(`⚠️ nešlo zkontrolovat: ${esc(broken.join(', '))}`);
lines.push('', '<i>Nic se neaktualizovalo. Bezpečné opravy: <code>npm audit fix</code> / <code>pnpm audit --fix</code> v repu, pak testy.</i>');
const text = lines.join('\n');

writeFileSync(join(ROOT, 'out', 'deps-latest.txt'), text.replace(/<[^>]+>/g, ''));
if (dry) console.log(text);
else if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: 'HTML' }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
  console.log(`${new Date().toISOString()} report balíčků odeslán (${results.length} rep)`);
}
