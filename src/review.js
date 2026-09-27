// Noční code review: projde commity od minulého běhu v každém repu v ~/Developer
// a nechá Claude hledat skutečné chyby. Kód jen čte, nic neopravuje.
//   node src/review.js              commity od minulého běhu (poprvé posledních 24 h)
//   node src/review.js --hours 48   vlastní okno, stav se neposune
//   node src/review.js --dry        vypíše report, nic nezapíše ani nepošle
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV = join(homedir(), 'Developer');
const AUTHORS = ['erikkarasek@centrum.cz', '40054004+ErikKarasek@users.noreply.github.com'];
// Vlastní automatické commity (zápisy a reporty) nejsou práce, kód devlogu ano.
// Filtruje se až tady: gitové --extended-regexp by platilo i pro --author a "+" v noreply
// adrese by pak z hledání vyřadilo všechny commity.
const AUTO_COMMIT = /^(log|review): \d{4}-\d{2}-\d{2}$/;
const STATE = join(ROOT, 'out', 'review-state.json');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const hours = args.includes('--hours') ? Number(args[args.indexOf('--hours') + 1]) : null;

loadEnv();

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

function since() {
  if (hours) return new Date(Date.now() - hours * 3600_000);
  try {
    return new Date(JSON.parse(readFileSync(STATE, 'utf8')).lastRun);
  } catch {
    return new Date(Date.now() - 24 * 3600_000);
  }
}

function changedRepos(from) {
  const out = [];
  for (const e of readdirSync(DEV, { withFileTypes: true })) {
    const repo = join(DEV, e.name);
    if (!e.isDirectory() || !existsSync(join(repo, '.git'))) continue;
    let log = '';
    try {
      log = git(repo, 'log', '--all', '--no-merges', `--since=${from.toISOString()}`,
        ...AUTHORS.map((a) => `--author=${a}`), '--format=%h %s').trim();
    } catch {}
    // Formát je "hash subject", automatický commit se pozná podle subjectu.
    const commits = log ? log.split('\n').filter((l) => !AUTO_COMMIT.test(l.slice(l.indexOf(' ') + 1))).reverse() : [];
    if (commits.length) out.push({ name: e.name, repo, commits });
  }
  return out;
}

// Claude běží přímo v repu, aby viděl okolní kód i CLAUDE.md projektu. Smí jen číst:
// Read/Grep/Glob a z Bashe jen git diff/show/log; dontAsk zamítne všechno ostatní.
function review({ name, repo, commits }) {
  const prompt = `You are doing a nightly code review of today's commits in the "${name}" repository (your working directory). The author is a junior developer working alone, often with AI assistance, so nobody else has looked at this code.

Commits to review (oldest first):
${commits.map((c) => `- ${c}`).join('\n')}

Use \`git show <hash>\` to read each diff and read surrounding code where needed to judge whether something is really wrong.

Report only problems worth acting on, most important first:
- bugs: wrong logic, unhandled errors or edge cases, broken behaviour, race conditions
- security: committed secrets or keys, missing auth or access checks, data exposed publicly, injection
- leftovers: debug logs, commented-out code, TODOs that hide unfinished work, test data in production code
- risky logic that changed without any test, when the repo has tests

Do NOT report style, naming, formatting, or "consider refactoring" advice. If a commit is fine, say nothing about it. Never invent problems to have something to say.

Output Markdown only, no preamble, in English:

## ${name}

If nothing worth acting on: a single line "✅ No issues found in N commits."
Otherwise, for each finding:
### <🔴 high | 🟠 medium | 🟡 low> — short title
\`path/to/file:line\` · commit \`hash\`
What is wrong and what it breaks, in 1–3 sentences. Then a concrete fix in one sentence.`;

  const r = spawnSync('claude', ['-p', '--model', 'sonnet', '--tools', 'Read,Grep,Glob,Bash',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
    '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence'],
  { cwd: repo, input: prompt, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim()) return `## ${name}\n\n⚠️ Review failed: ${(r.stderr || r.error?.message || 'empty output').slice(0, 300)}`;
  const text = r.stdout.trim();
  return text.slice(Math.max(0, text.indexOf('## ')));
}

const failedSection = (s) => /^## .+\n\n⚠️ Review failed/.test(s);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Do Telegramu jen přehled: kolik čeho v kterém repu a názvy nálezů. Detail je v souboru.
function digest(date, sections) {
  const lines = [`<b>🔍 Code review ${date}</b>`, ''];
  for (const s of sections) {
    const name = s.match(/^## (.+)$/m)?.[1] ?? '?';
    const findings = [...s.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    // Jen vlastní hláška z review(); nález může tu frázi citovat (stalo se u devlogu).
    if (failedSection(s)) lines.push(`⚠️ <b>${esc(name)}</b>: review selhalo`);
    else if (!findings.length) lines.push(`✅ <b>${esc(name)}</b>: v pořádku`);
    else {
      lines.push(`<b>${esc(name)}</b>`);
      for (const f of findings) lines.push(`  ${esc(f)}`);
    }
  }
  return lines.join('\n').slice(0, 4000);
}

async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`telegram: ${res.status} ${await res.text()}`);
}

const startedAt = new Date();
const from = since();
const repos = changedRepos(from);
console.log(`${startedAt.toISOString()} review od ${from.toISOString()}: ${repos.map((r) => `${r.name} (${r.commits.length})`).join(', ') || 'nic'}`);

// Když review některého repa selže, stav se neposune (commity přijdou na řadu příště)
// a skript skončí nenulově, takže daily.sh nepošle signál do site-watch.
let failed = false;
if (repos.length) {
  const sections = repos.map(review);
  failed = sections.some(failedSection);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${startedAt.getFullYear()}-${p(startedAt.getMonth() + 1)}-${p(startedAt.getDate())}`;
  const report = `# Code review ${date}\n\nCommits since ${from.toISOString().slice(0, 16).replace('T', ' ')} UTC.\n\n${sections.join('\n\n')}\n`;
  if (dry) console.log(report);
  else {
    const rel = `reviews/${date.slice(0, 4)}/${date}.md`;
    mkdirSync(join(ROOT, dirname(rel)), { recursive: true });
    writeFileSync(join(ROOT, rel), report);
    await telegram(digest(date, sections));
    git(ROOT, 'add', rel);
    git(ROOT, 'commit', '-m', `review: ${date}`);
    if (git(ROOT, 'remote').trim()) git(ROOT, 'push', '-q');
    console.log(`zapsáno: ${rel}`);
  }
}

// Ruční --hours okno neposouvá stav, aby noční běh nic nepřeskočil.
if (!dry && !hours && !failed) writeFileSync(STATE, JSON.stringify({ lastRun: startedAt.toISOString() }));
if (failed) process.exitCode = 1;
