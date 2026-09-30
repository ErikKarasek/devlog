// Text od modelu. Nejdřív Claude Sonnet přes Antigravity (předplatné Google AI Pro), ať to
// nežere limit předplatného Claude; když agy chybí nebo selže (limit, síť), claude CLI jako dřív.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const AGY = join(homedir(), '.local', 'bin', 'agy');

/**
 * @param {string} prompt
 * @param {{ cwd?: string, timeoutMs?: number, claudeArgs: string[], agyArgs?: string[] }} o
 *   claudeArgs: přesně to, co se dřív předávalo `claude` (záloha); agyArgs: nástroje pro agy.
 * @returns {{ ok: boolean, text: string, err: string, via: 'agy' | 'claude' }}
 */
export function ask(prompt, { cwd, timeoutMs = 5 * 60_000, claudeArgs, agyArgs = [] }) {
  if (existsSync(AGY) && process.env.AI_VIA !== 'claude') {
    const r = spawnSync(AGY, ['-p', prompt, '--model', 'claude-sonnet-4-6', '--output-format', 'json',
      '--print-timeout', `${Math.round(timeoutMs / 1000)}s`, ...agyArgs],
    { cwd: cwd ?? mkdtempSync(join(tmpdir(), 'ai-')), encoding: 'utf8', timeout: timeoutMs + 30_000, maxBuffer: 20 * 1024 * 1024 });
    try {
      const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
      if (out.status === 'SUCCESS' && out.response?.trim()) return { ok: true, text: out.response.trim(), err: '', via: 'agy' };
    } catch { /* agy nevrátil JSON: zkusí se claude */ }
  }
  const r = spawnSync('claude', claudeArgs, { cwd, input: prompt, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
  const ok = r.status === 0 && !!r.stdout.trim();
  return { ok, text: r.stdout.trim(), err: r.stderr || r.error?.message || 'prázdný výstup', via: 'claude' };
}
