#!/bin/zsh
# Pouští launchd ve 3:00: deník za včerejšek (--catch-up doplní i prospané dny) a hned po
# něm code review, obojí tak zachytí celý večer. Mac se na to probouzí přes
# `pmset repeat` ve 2:59 (viz README). Vzhůru ho drží caffeinate a LidRun (pravidlo na
# proces claude), po doběhnutí se zase uspí. launchd má holý PATH, proto ho nastavujeme.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "${0:A:h}/.." || exit 1

caffeinate -i -w $$ &

if node src/index.js --catch-up; then
  last=$(head -1 out/last.txt 2>/dev/null)
  [[ -n "$last" ]] && osascript -e "display notification \"Zápis je hotový\" with title \"Devlog\" sound name \"Glass\""
else
  osascript -e "display notification \"Běh selhal – mrkni do out/daily.log\" with title \"Devlog\""
fi

node src/review.js >> out/review.log 2>&1 \
  || osascript -e "display notification \"Code review selhalo – mrkni do out/review.log\" with title \"Devlog\""

# Uspat, jen když Mac nikdo nepoužívá (10 min bez klávesnice a myši), ať to neuspí
# někoho, kdo ve tři ráno ještě pracuje. pmset sleepnow nepotřebuje sudo.
idle=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
if (( idle >= 600 )); then
  echo "$(date '+%F %T') hotovo, nečinný ${idle}s, uspávám"
  pmset sleepnow
else
  echo "$(date '+%F %T') hotovo, Mac se používá (nečinný ${idle}s), neuspávám"
fi
