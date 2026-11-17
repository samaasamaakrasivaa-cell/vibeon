/** Текст статьи: абзацы, «## » — подзаголовок, «- » — список, «1. » — нумерованный список. */
export function ArticleBody({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => { if (list) { const L = list; blocks.push(L.ordered ? <ol key={blocks.length}>{L.items.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul key={blocks.length}>{L.items.map((x, i) => <li key={i}>{x}</li>)}</ul>); list = null; } };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const ul = /^[-•]\s+(.*)/.exec(line), ol = /^\d+[.)]\s+(.*)/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flush();
    if (!line) continue;
    if (line.startsWith("## ")) blocks.push(<h3 key={blocks.length}>{line.slice(3)}</h3>);
    else blocks.push(<p key={blocks.length}>{line}</p>);
  }
  flush();
  return <div className="artbody">{blocks}</div>;
}
