import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivateLessonDictation } from "../../src/components/teacher/PrivateLessonDictation";

function Fixture() {
  const [busy, setBusy] = useState(false);
  return <form method="post">
    <label htmlFor="lesson-observation">Synthetic observation</label>
    <PrivateLessonDictation lang="en" initialText="Manual prefix" maxLength={600} placeholder="" onBusy={setBusy} />
    <p id="observation-privacy">Synthetic fixture</p>
    <button type="submit" disabled={busy}>Save observation</button>
  </form>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
