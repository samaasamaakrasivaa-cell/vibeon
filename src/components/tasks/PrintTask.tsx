// Задание для печати (PDF): без интерактива; с ключами — ответы под заданием.
import { buildCrossword, parse, shuffle } from "@/lib/tasks/parse";
import type { TaskData } from "./TaskView";

const line = (n = 12) => "_".repeat(n);

export function PrintTask({ task, n, keys }: { task: TaskData; n: number; keys: boolean }) {
  const p = parse(task.type, task.content);
  const o = task.options ?? {};
  const answers: string[] = [];
  let body: React.ReactNode = null;
  switch (p.kind) {
    case "gaps": {
      const bank = task.type === "drag" || o.mode === "drag" ? shuffle(p.bank, task.id) : null;
      body = (
        <>
          {bank && <div className="pbox">{bank.join("   ·   ")}</div>}
          <ol>{p.lines.map((l, i) => <li key={i}>{l.map((s, k) => {
            if (s.t === "text") return <span key={k}>{s.v}</span>;
            answers.push(`${i + 1}. ${s.answers.join(" / ")}`);
            if (task.type === "dropdown") return <span key={k}> ({s.options!.join(" / ")}) </span>;
            if (task.type === "errors") return <u key={k}>{s.options!.find((x) => !s.answers.includes(x)) ?? s.options![0]}</u>;
            return <span key={k}>{line(Math.max(8, s.answers[0].length + 4))}{s.hint ? ` (${s.hint})` : ""}</span>;
          })}</li>)}</ol>
        </>
      );
      break;
    }
    case "test":
      body = <ol>{p.qs.map((q, i) => { answers.push(`${i + 1}. ${q.correct.map((c) => String.fromCharCode(97 + c)).join(", ")}`); return <li key={i}>{q.q}<div className="popts">{q.options.map((op, k) => <span key={k}>{String.fromCharCode(97 + k)}) {op}</span>)}</div></li>; })}</ol>;
      break;
    case "tf":
      body = <ol>{p.items.map((it, i) => { answers.push(`${i + 1}. ${it.a}`); return <li key={i}>{it.s} &nbsp; T / F{p.ns ? " / NS" : ""}</li>; })}</ol>;
      break;
    case "pairs": {
      const right = shuffle(p.pairs.map((_, i) => i), task.id);
      right.forEach((ri, k) => (answers[ri] = `${ri + 1} — ${String.fromCharCode(97 + k)}`));
      body = <div className="pcols"><ol>{p.pairs.map((x, i) => <li key={i}>{x[0]}</li>)}</ol><ol type="a">{right.map((ri) => <li key={ri}>{p.pairs[ri][1]}</li>)}</ol></div>;
      break;
    }
    case "columns": {
      const words = shuffle(p.cols.flatMap((c) => c.words), task.id);
      p.cols.forEach((c) => answers.push(`${c.name}: ${c.words.join(", ")}`));
      body = <><div className="pbox">{words.join("   ·   ")}</div><div className="pcols">{p.cols.map((c) => <div key={c.name}><b>{c.name}</b><br />{line(20)}<br />{line(20)}</div>)}</div></>;
      break;
    }
    case "sentences":
      body = <ol>{p.items.map((toks, i) => { answers.push(`${i + 1}. ${toks.join(" ")}`); return <li key={i}>{shuffle(toks, task.id + i).join(" / ")}<br />{line(40)}</li>; })}</ol>;
      break;
    case "words":
      if (task.type === "crossword" && p.items.length) {
        const cw = buildCrossword(p.items);
        const nums = new Map(cw.words.map((w) => [`${w.row},${w.col}`, w.n]));
        cw.words.forEach((w) => answers.push(`${w.n}${w.across ? "→" : "↓"} ${w.word}`));
        body = (
          <>
            <table className="pcw"><tbody>{cw.grid.map((r, i) => <tr key={i}>{r.map((ch, j) => <td key={j} className={ch ? "c" : ""}>{nums.get(`${i},${j}`) ?? ""}{keys && ch ? <b>{ch}</b> : null}</td>)}</tr>)}</tbody></table>
            <div className="pcols"><div><b>Across</b>{cw.words.filter((w) => w.across).map((w) => <div key={w.n}>{w.n}. {w.clue}</div>)}</div><div><b>Down</b>{cw.words.filter((w) => !w.across).map((w) => <div key={w.n}>{w.n}. {w.clue}</div>)}</div></div>
          </>
        );
      } else {
        body = <ol>{p.items.map((it, i) => { answers.push(`${i + 1}. ${it.word}`); return <li key={i}>{task.type === "letters" ? shuffle(it.word.split(""), task.id + i).join(" ") : ""} {it.hint && `(${it.hint})`} {line(16)}</li>; })}</ol>;
      }
      break;
    case "lines":
      if (task.type === "textorder") {
        const ord = shuffle(p.items.map((_, i) => i), task.id);
        ord.forEach((v, k) => (answers[v] = `${String.fromCharCode(97 + k)}`));
        body = <ol type="a">{ord.map((v) => <li key={v}>{p.items[v]} &nbsp; ___</li>)}</ol>;
      } else if (task.type === "dictation") {
        p.items.forEach((s, i) => answers.push(`${i + 1}. ${s}`));
        body = <ol>{p.items.map((_, i) => <li key={i}>{line(50)}</li>)}</ol>;
      } else body = <ol>{p.items.map((q, i) => <li key={i}>{q}{task.type === "open" && <><br />{line(50)}</>}</li>)}</ol>;
      break;
    case "pairsArrow":
      body = <ol>{p.items.map((it, i) => { answers.push(`${i + 1}. ${it.answers.join(" / ")}`); return <li key={i}>{it.q} {it.key && <b>{it.key}</b>}<br />{line(50)}</li>; })}</ol>;
      break;
    case "wordset":
      body = <table className="pwords"><tbody>{p.items.map((w, i) => <tr key={i}><td><b>{w.word}</b></td><td>{w.tr}</td><td><i>{w.ex}</i></td></tr>)}</tbody></table>;
      break;
    default:
      if (task.type === "image") body = <div className="pimgs">{(o.images ?? []).map((im, i) => <figure key={i}><img src={im.src} alt="" />{im.caption && <figcaption>{im.caption}</figcaption>}</figure>)}</div>;
      else if (task.type === "video" || task.type === "audio") body = <p>{o.src}{o.script && <><br /><small>{o.script}</small></>}</p>;
      else if (task.type === "link") body = <p>{o.label} {o.url}</p>;
      else if (task.type === "essay" || task.type === "record") body = <><p>{task.content}</p>{task.type === "essay" && Array.from({ length: 8 }, (_, i) => <div key={i}>{line(60)}</div>)}</>;
      else if (task.type === "divider") return <hr />;
      else body = <div style={{ whiteSpace: "pre-wrap" }}>{task.content.replace(/\*\*|__/g, "")}</div>;
  }
  return (
    <section className="ptask">
      <h3>{n}. {task.title}</h3>
      {body}
      {keys && answers.filter(Boolean).length > 0 && <div className="pkey"><b>Key:</b> {answers.filter(Boolean).join("; ")}</div>}
    </section>
  );
}
