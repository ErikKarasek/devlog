// Chaty z Claude Code za jeden den, jako podklad pro "Other work" v deníku.
// Claude Code je ukládá sám do ~/.claude/projects/<projekt>/<session>.jsonl a po 30 dnech maže;
// tady se jen čtou, nic se nekopíruje ani neukládá.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const PROJECTS = join(homedir(), '.claude', 'projects');
const MAX_PROMPTS = 40;
const MAX_TOTAL = 14_000;

// Do promptu ani do zápisu (ten jde na GitHub) nesmí projít token nebo klíč, který někdo
// do chatu vložil. Hrubé, ale bezpečné: dlouhé tajemství-podobné řetězce ven.
function redact(s) {
  return s
    .replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '[telegram-token]')
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{20,}\b/g, '[key]')
    .replace(/\bgh[opsu]_[A-Za-z0-9]{20,}\b/g, '[github-token]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[jwt]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}\b/g, '[secret]');
}

const localDay = (iso) => new Date(iso).toLocaleDateString('sv-SE');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  // Pole s tool_result je výstup nástroje, ne to, co člověk napsal.
  if (content.some((p) => p.type === 'tool_result')) return '';
  return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
}

export function chatsFor(day) {
  if (!existsSync(PROJECTS)) return [];
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const sessions = [];

  for (const dir of readdirSync(PROJECTS)) {
    const path = join(PROJECTS, dir);
    if (!statSync(path).isDirectory()) continue;
    for (const file of readdirSync(path)) {
      if (!file.endsWith('.jsonl')) continue;
      const full = join(path, file);
      if (statSync(full).mtimeMs < dayStart) continue; // naposled psaný před tím dnem

      let title = null, cwd = null, lastReply = '';
      const prompts = [];
      for (const line of readFileSync(full, 'utf8').split('\n')) {
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === 'custom-title') title = e.customTitle ?? e.title ?? title;
        if (!e.timestamp || e.isSidechain || localDay(e.timestamp) !== day) continue;
        cwd ??= e.cwd;
        if (e.type === 'user' && !e.isMeta) {
          const t = textOf(e.message?.content).trim();
          // <...> na začátku jsou systémové vložky (připomínky, výstupy příkazů), ne člověk.
          // Maskovat před zkrácením: token useknutý na hraně by byl kratší než minimum
          // v redact() a prošel by do logu na GitHubu.
          if (t && !t.startsWith('<')) prompts.push(redact(t.replace(/\s+/g, ' ')).slice(0, 300));
        }
        if (e.type === 'assistant') {
          const t = textOf(e.message?.content).trim();
          if (t) lastReply = t;
        }
      }
      if (prompts.length) {
        sessions.push({
          project: cwd ? basename(cwd) : dir,
          title,
          prompts: prompts.slice(0, MAX_PROMPTS),
          outcome: redact(lastReply).slice(0, 1500),
        });
      }
    }
  }
  return sessions;
}

export function chatsMaterial(sessions) {
  let out = '';
  for (const s of sessions) {
    const block = `### Session in ${s.project}${s.title ? ` — "${s.title}"` : ''}\nUser asked:\n${s.prompts.map((p) => `- ${p}`).join('\n')}\nLast assistant reply (usually the outcome):\n${s.outcome}\n\n`;
    if (out.length + block.length > MAX_TOTAL) break;
    out += block;
  }
  return out.trim();
}
