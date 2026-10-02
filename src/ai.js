// Text od modelu. Nejdřív Claude Sonnet přes Antigravity (předplatné Google AI Pro), ať to
// nežere limit předplatného Claude; když agy chybí nebo selže (limit, síť), claude CLI jako dřív.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const AGY = join(homedir(), '.local', 'bin', 'agy');

/**
 * An empty working folder for a plain prompt, its own per call: agy writes into its cwd, so two
 * calls that share one folder see each other's files. Deleted again right after the call, so
 * these don't pile up in /tmp either.
 */
function scratch() {
  return mkdtempSync(join(tmpdir(), 'ai-agy-'));
}

/**
 * @param {string} prompt
 * @param {{ cwd?: string, timeoutMs?: number, claudeArgs: string[], agyArgs?: string[] }} o
 *   claudeArgs: přesně to, co se dřív předávalo `claude` (záloha); agyArgs: nástroje pro agy.
 * @returns {{ ok: boolean, text: string, err: string, via: 'agy' | 'claude' }}
 */
export function ask(prompt, { cwd, timeoutMs = 5 * 60_000, claudeArgs, agyArgs = [] }) {
  if (existsSync(AGY) && process.env.AI_VIA !== 'claude') {
    let dir;
    try {
      dir = cwd ?? scratch();
      const r = spawnSync(AGY, ['-p', prompt, '--model', 'claude-sonnet-4-6', '--output-format', 'json',
        '--print-timeout', `${Math.round(timeoutMs / 1000)}s`, ...agyArgs],
      { cwd: dir, encoding: 'utf8', timeout: timeoutMs + 30_000, maxBuffer: 20 * 1024 * 1024 });
      const raw = r.stdout ?? '';
      const out = JSON.parse(raw.slice(raw.indexOf('{')));
      if (out.status === 'SUCCESS' && out.response?.trim()) return { ok: true, text: out.response.trim(), err: '', via: 'agy' };
    } catch { /* agy nevrátil JSON: zkusí se claude */ } finally {
      if (dir && !cwd) rmSync(dir, { recursive: true, force: true });
    }
  }
  const r = spawnSync('claude', claudeArgs, { cwd, input: prompt, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
  const out = (r.stdout ?? '').trim();
  const ok = r.status === 0 && !!out;
  return { ok, text: out, err: r.stderr || r.error?.message || 'prázdný výstup', via: 'claude' };
}
