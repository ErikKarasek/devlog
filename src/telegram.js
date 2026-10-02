// Telegram bere nejvýš 4096 znaků. Uříznout HTML v půlce řádku může nechat neuzavřený tag
// (<b>…) a Telegram pak celou zprávu odmítne ("Unclosed start tag"). Všechny naše tagy
// začínají i končí na jednom řádku, takže stačí řezat na konci řádku.
export function fitLines(html, max = 4000) {
  if (html.length <= max) return html;
  const cut = html.lastIndexOf('\n', max - 2);
  return `${html.slice(0, Math.max(cut, 0))}\n…`;
}
