#!/bin/zsh
# Pouští launchd ve 3:00: deník za včerejšek (--catch-up doplní i prospané dny) a hned po
# něm code review, obojí tak zachytí celý večer. Mac se na to probouzí přes
# `pmset repeat` ve 2:59 (viz README). Vzhůru ho drží caffeinate (LidRun, pokud zrovna běží,
# pomůže, ale není potřeba), po doběhnutí se zase uspí. launchd má holý PATH, nastavujeme ho.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "${0:A:h}/.." || exit 1

# -i: neuspat kvůli nečinnosti; -s: neuspat vůbec, i se zavřeným víkem (macOS to dodrží
# jen v nabíječce). Na baterii se běh ve spánku jen pozastaví a doběhne po probuzení.
caffeinate -i -s -w $$ &

# Hlídač automatizací (site-watch) se ozve v Telegramu, když tenhle signál do 10:00 nepřijde.
beat() {
  local key=$(grep '^BEAT_KEY=' .env | cut -d= -f2-)
  [[ -n "$key" ]] && curl -fsS -m 15 -X POST -H "x-beat-key: $key" "https://site-watch.erikkarasek2005.workers.dev/beat/$1" >/dev/null
}
ok=1

if node src/index.js --catch-up; then
  last=$(head -1 out/last.txt 2>/dev/null)
  [[ -n "$last" ]] && osascript -e "display notification \"Zápis je hotový\" with title \"Devlog\" sound name \"Glass\""
else
  ok=0
  osascript -e "display notification \"Běh selhal – mrkni do out/daily.log\" with title \"Devlog\""
fi

node src/review.js >> out/review.log 2>&1 \
  || { ok=0; osascript -e "display notification \"Code review selhalo – mrkni do out/review.log\" with title \"Devlog\""; }

# V noci na pondělí i týdenní report balíčků (jen report, nic neaktualizuje).
if [[ $(date +%u) == 1 ]]; then
  node src/deps.js >> out/deps.log 2>&1 \
    || osascript -e "display notification \"Kontrola balíčků selhala – mrkni do out/deps.log\" with title \"Devlog\""
fi

(( ok )) && beat devlog

# Uspat, jen když Mac nikdo nepoužívá (10 min bez klávesnice a myši), ať to neuspí
# někoho, kdo ve tři ráno ještě pracuje. pmset sleepnow nepotřebuje sudo.
idle=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
if (( idle >= 600 )); then
  echo "$(date '+%F %T') hotovo, nečinný ${idle}s, uspávám"
  pmset sleepnow
else
  echo "$(date '+%F %T') hotovo, Mac se používá (nečinný ${idle}s), neuspávám"
fi
