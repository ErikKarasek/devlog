#!/bin/zsh
# Pouští launchd každý večer. launchd má holý PATH, proto ho nastavujeme ručně.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "${0:A:h}/.." || exit 1

if node src/index.js; then
  last=$(head -1 out/last.txt 2>/dev/null)
  if [[ -n "$last" ]]; then
    osascript -e "display notification \"Dnešní zápis je hotový\" with title \"Devlog\" sound name \"Glass\""
    open "$last"
  fi
else
  osascript -e "display notification \"Běh selhal – mrkni do out/daily.log\" with title \"Devlog\""
fi
