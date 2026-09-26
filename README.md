# devlog

A daily work log written from my git commits across every repo in `~/Developer`,
plus an "Other work" section from that day's Claude Code chats (read from
`~/.claude/projects`, which Claude Code keeps for 30 days; nothing is copied, and
tokens or keys pasted into a chat are redacted before anything is sent).
Every evening at 21:00 it collects the day's commits, has Claude write a short
English summary, commits it here and pushes. On Sundays it also writes a weekly
review with a LinkedIn draft.

```
entries/2026/2026-09-26.md   one file per day with commits (days without commits are skipped)
weekly/2026-W39.md           Sunday review + LinkedIn draft
```

## Usage

```bash
npm run today                 # write today's entry
npm run dry                   # print it, write nothing
node src/index.js 2026-09-25  # a specific day
npm run weekly                # force the weekly review
```

Summaries go through `claude -p` (Sonnet, no tools), so they run on the Claude
subscription, not on the Workers AI allowance. If Claude fails, the entry is
still written with the raw log.

## Schedule

`~/Library/LaunchAgents/com.erikkarasek.devlog.plist` runs `scripts/daily.sh`
at 21:00: the daily entry, then the code review, with `caffeinate` keeping the Mac
awake until both finish. If the Mac is asleep, launchd runs it on wake and the
entry catches up on the days it missed.

To have the Mac wake up for it (macOS allows one repeating wake a day, needs admin):

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 20:59:00
pmset -g sched          # check
sudo pmset repeat cancel  # undo
```

Works reliably on power; on battery with the lid closed macOS may put it back to
sleep early.

```bash
launchctl load ~/Library/LaunchAgents/com.erikkarasek.devlog.plist
launchctl start com.erikkarasek.devlog   # run now
tail out/daily.log
```

## Nightly code review

`src/review.js` runs right after the daily entry, in the same 21:00 job, so a
single scheduled wake is enough. For every repo
with my commits since the last run it starts `claude -p` inside that repo, where
it can read the code and the project's CLAUDE.md but only run `git show/diff/log`,
and asks for real problems: bugs, security holes, leftovers, risky untested logic.
No style advice.

The full report goes to `reviews/2026/2026-09-27.md`, Telegram gets the list of
findings per repo.

```bash
node src/review.js --dry --hours 24   # try it on the last day, write nothing
```

## Telegram (optional)

Sends each entry to your phone.

1. In Telegram, message **@BotFather**, send `/newbot`, pick a name. Copy the token.
2. Send your new bot any message, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
3. `cp .env.example .env` and fill in both values.
