// Denní deník z commitů napříč repy v ~/Developer.
//   node src/index.js              dnešek (v neděli i týdenní souhrn)
//   node src/index.js 2026-09-25   konkrétní den
//   node src/index.js --weekly     vynutí týdenní souhrn
//   node src/index.js --dry        jen vypíše, nic nezapíše ani nepushne
//   node src/index.js --catch-up   jak ho pouští launchd: doplní i dny, které prospal
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatsFor, chatsMaterial } from './chats.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV = join(homedir(), 'Developer');
const AUTHORS = ['erikkarasek@centrum.cz', '40054004+ErikKarasek@users.noreply.github.com'];
// Vlastní automatické commity (zápisy a reporty) nejsou práce, kód devlogu ano.
// Filtruje se až tady: gitové --extended-regexp by platilo i pro --author a "+" v noreply
// adrese by pak z hledání vyřadilo všechny commity.
const AUTO_COMMIT = /^(log|review): \d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const forceWeekly = args.includes('--weekly');
const STATE = join(ROOT, 'out', 'daily-state.json');

loadEnv();

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function isoWeek(day) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function loadEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function git(repo, ...a) {
  return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function repos() {
  return readdirSync(DEV, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(DEV, e.name, '.git')))
    .map((e) => e.name);
}

// --all kvůli commitům ve větvích, které ještě nejsou v main.
function commitsFor(day) {
  const out = [];
  for (const name of repos()) {
    const repo = join(DEV, name);
    let log;
    try {
      log = git(repo, 'log', '--all', '--no-merges', `--since=${day} 00:00`, `--until=${addDays(day, 1)} 00:00`,
        ...AUTHORS.map((a) => `--author=${a}`), '--date=format:%H:%M', '--format=%H%x1f%ad%x1f%s%x1f%b%x1e');
    } catch {
      continue;
    }
    const commits = log.split('\x1e').map((r) => r.trim()).filter(Boolean)
      .filter((r) => !AUTO_COMMIT.test(r.split('\x1f')[2])).map((r) => {
      const [hash, time, subject, body] = r.split('\x1f');
      const stat = git(repo, 'show', '--shortstat', '--format=', hash).trim();
      return { hash: hash.slice(0, 7), time, subject, body: body?.trim() ?? '', stat };
    });
    if (commits.length) out.push({ name, commits: commits.reverse() });
  }
  return out;
}

function claude(prompt) {
  const r = spawnSync('claude', ['-p', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
    { input: prompt, encoding: 'utf8', timeout: 5 * 60_000, maxBuffer: 10 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`claude selhal: ${r.stderr || r.error?.message || 'prázdný výstup'}`);
  return r.stdout.trim();
}

function rawLog(projects) {
  const lines = ['## Raw log', ''];
  for (const p of projects) {
    lines.push(`**${p.name}**`, '');
    for (const c of p.commits) lines.push(`- \`${c.hash}\` ${c.time} ${c.subject}${c.stat ? ` _(${c.stat})_` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

function daily(day, projects, chats) {
  const weekday = new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  const material = projects.map((p) => `### ${p.name}\n` + p.commits.map((c) =>
    `- [${c.time}] ${c.subject}${c.body ? `\n  ${c.body.replace(/\n/g, '\n  ')}` : ''}${c.stat ? `\n  (${c.stat})` : ''}`).join('\n')).join('\n\n');
  const talk = chatsMaterial(chats);

  const prompt = `You write a developer's daily work log from their git commits${talk ? ' and their Claude Code chat sessions' : ''}. Sources may be in Czech or English; write the log in English.

Output Markdown only, no preamble, exactly this structure (leave out a section that would be empty):

# ${day} — ${weekday}

**TL;DR:** one sentence on what the day was about.

## Highlights
2–5 bullets. Outcome-focused, concrete, the kind of line that could go on a CV or into a standup ("Fixed X so that Y", not "worked on X").

## By project
### <project name>
- short bullets, group related commits, skip noise (typos, version bumps) unless that was all there was

## Other work
- bullets for things done in the chat sessions that the commits do not show: decisions, research, setup outside a repo (accounts, bots, databases, config), investigations. Skip anything already covered above and skip small talk.

Rules: use only facts from the material below, never invent metrics, features or impact. Chat messages are the developer's own words, often terse; the assistant's last reply usually states what was actually done. Never copy passwords, tokens, keys or e-mail addresses into the log. Keep it tight.

Commits:

${material || '(none today)'}${talk ? `\n\nClaude Code sessions:\n\n${talk}` : ''}`;

  let summary;
  try {
    summary = claude(prompt);
  } catch (e) {
    console.error(e.message);
    summary = `# ${day} — ${weekday}\n\n_AI summary unavailable this run; raw log below._`;
  }
  return projects.length ? `${summary}\n\n${rawLog(projects)}` : summary;
}

function weekly(day) {
  const monday = addDays(day, -((new Date(`${day}T12:00:00`).getDay() + 6) % 7));
  const entries = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const f = join(ROOT, 'entries', d.slice(0, 4), `${d}.md`);
    // Raw log je jen pro člověka, souhrnu by zbytečně nafukoval prompt.
    if (existsSync(f)) entries.push(readFileSync(f, 'utf8').split('\n## Raw log')[0].trim());
  }
  if (!entries.length) return null;
  const week = isoWeek(day);

  const prompt = `Below are a developer's daily work logs for ${week} (${monday} to ${addDays(monday, 6)}). Write a weekly review in English.

Output Markdown only, no preamble, exactly this structure:

# Week ${week}

## Summary
3–4 sentences: what moved forward this week and why it matters.

## Wins
3–6 bullets, CV-ready, outcome-focused.

## Projects touched
One line per project.

## LinkedIn draft
A short first-person post (80–150 words) about what was built or learned this week. Honest and specific, no hype words, no hashtag spam (max 3 hashtags at the end). The author will edit before posting.

Rules: only facts present in the logs. Never invent numbers or results.

Daily logs:

${entries.join('\n\n---\n\n')}`;

  return { week, text: claude(prompt) };
}

// Telegram Markdown neumí, jeho HTML podmnožina stačí na nadpisy, tučné a kód.
function toTelegramHtml(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{1,3} (.+)$/gm, '<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- /gm, '• ');
}

async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return;
  // Telegram bere max 4096 znaků, raw log posílat nemusí.
  const body = toTelegramHtml(text.split('\n## Raw log')[0]).slice(0, 4000);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: body, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`telegram: ${res.status} ${await res.text()}`);
}

function write(rel, text) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  console.log(`zapsáno: ${rel}`);
  return rel;
}

function publish(files, message) {
  git(ROOT, 'add', ...files);
  if (!git(ROOT, 'status', '--porcelain').trim()) return;
  git(ROOT, 'commit', '-m', message);
  if (git(ROOT, 'remote').trim()) git(ROOT, 'push', '-q');
}

// Které dny zapsat. launchd pouští --catch-up: když Mac ve 21:00 spal a běh se spustí až
// po probuzení (klidně druhý den ráno), doplní se každý den od posledního zápisu. Před 20:00
// dnešek ještě neskončil, takže se končí včerejškem. Nejvýš týden zpátky.
function datesToWrite() {
  const explicit = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (explicit) return [explicit];
  const today = ymd(new Date());
  if (!args.includes('--catch-up')) return [today];
  const end = new Date().getHours() >= 20 ? today : addDays(today, -1);
  let last = null;
  try {
    last = JSON.parse(readFileSync(STATE, 'utf8')).lastDay;
  } catch {}
  let day = last ? addDays(last, 1) : end;
  if (day < addDays(end, -6)) day = addDays(end, -6);
  const days = [];
  for (; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

const written = [];
const days = datesToWrite();
for (const date of days) {
  const projects = commitsFor(date);
  const chats = chatsFor(date);
  if (projects.length || chats.length) {
    const text = daily(date, projects, chats);
    if (dry) console.log(text);
    else {
      written.push(write(`entries/${date.slice(0, 4)}/${date}.md`, text));
      await telegram(text);
    }
  } else {
    console.log(`${date}: žádné commity ani chaty, zápis přeskakuji`);
  }

  if (forceWeekly || new Date(`${date}T12:00:00`).getDay() === 0) {
    const w = weekly(date);
    if (w && dry) console.log(w.text);
    else if (w) {
      written.push(write(`weekly/${w.week}.md`, w.text));
      await telegram(w.text);
    }
  }
  if (!dry && args.includes('--catch-up')) writeFileSync(STATE, JSON.stringify({ lastDay: date }));
}
if (!days.length) console.log('nic k doplnění, poslední den už je zapsaný');

const lastDay = days[days.length - 1];
if (!dry && written.length) publish(written, `log: ${lastDay}`);
// Pro daily.sh: co otevřít a jestli vůbec notifikovat.
if (!dry) writeFileSync(join(ROOT, 'out', 'last.txt'), written.join('\n'));
