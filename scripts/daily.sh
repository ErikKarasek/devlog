#!/bin/zsh
# Pouští launchd ve 21:00. Mac se na to probouzí přes `pmset repeat` ve 20:59 (viz README),
# caffeinate ho drží vzhůru, dokud deník i code review nedoběhnou. launchd má holý PATH.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "${0:A:h}/.." || exit 1

run() {
  if node src/index.js --catch-up; then
    last=$(head -1 out/last.txt 2>/dev/null)
    if [[ -n "$last" ]]; then
      osascript -e "display notification \"Dnešní zápis je hotový\" with title \"Devlog\" sound name \"Glass\""
      open "$last"
    fi
  else
    osascript -e "display notification \"Běh selhal – mrkni do out/daily.log\" with title \"Devlog\""
  fi
  # Review hned po zápisu, ať stačí jedno probuzení denně (macOS umí jen jedno opakované).
  node src/review.js >> out/review.log 2>&1 \
    || osascript -e "display notification \"Code review selhalo – mrkni do out/review.log\" with title \"Devlog\""
}

# -i: žádné uspání kvůli nečinnosti, dokud run() běží. Na baterii se zavřeným víkem to
# macOS nemusí dodržet, v síti ano.
caffeinate -i -w $$ &
run
