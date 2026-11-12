import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Метка сборки — отпечаток исходного кода: одинаковая в серверном и браузерном коде (конфиг читается несколькими процессами)
// и меняется, только когда меняется код. По ней открытая вкладка понимает, что платформу обновили.
function buildStamp() {
  if (process.env.BUILD_STAMP) return process.env.BUILD_STAMP;
  const h = createHash("sha1");
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else { h.update(p); h.update(fs.readFileSync(p)); }
    }
  };
  try { walk(path.join(process.cwd(), "src")); } catch { return "dev"; }
  return h.digest("hex").slice(0, 12);
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD: buildStamp() },
};

export default nextConfig;
