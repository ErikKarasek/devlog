// Telegram bere nejvýš 4096 znaků. Uříznout HTML v půlce řádku může nechat neuzavřený tag
// (<b>…) a Telegram pak celou zprávu odmítne ("Unclosed start tag"). Všechny naše tagy
// začínají i končí na jednom řádku, takže stačí řezat na konci řádku.
export function fitLines(html, max = 4000) {
  if (html.length <= max) return html;
  const cut = html.lastIndexOf('\n', max - 2);
  if (cut > 0) return `${html.slice(0, cut)}\n…`;
  // One line longer than the limit: cutting it anywhere could split a tag or an entity, so it
  // goes as plain text, which beats a message that is only "…".
  const plain = html.replace(/<[^>]*>/g, '').replace(/&(lt|gt|quot|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', amp: '&' })[e]);
  const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Escaping makes it longer again (& is five characters): cut until the escaped text fits.
  let keep = max - 1;
  let out = escape(plain.slice(0, keep));
  while (out.length > max - 1) {
    keep -= out.length - (max - 1);
    out = escape(plain.slice(0, keep));
  }
  return `${out}…`;
}
