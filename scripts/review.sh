#!/bin/zsh
# Pouští launchd ve 3:00; když Mac spí, doběhne po probuzení a report čeká ráno.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "${0:A:h}/.." || exit 1

node src/review.js || osascript -e "display notification \"Code review selhalo – mrkni do out/review.log\" with title \"Devlog\""
