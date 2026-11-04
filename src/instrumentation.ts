// Запускается один раз при старте сервера. Серверная часть — только в среде Node.js.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
