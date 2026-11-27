const http = require("node:http");
const os = require("node:os");
const net = require("node:net");
const { readFileSync, chmodSync, lstatSync, unlinkSync } = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");
const limits = require("./limits.cjs");

function assertIsolation() {
  const memory = readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
  const swap = readFileSync("/sys/fs/cgroup/memory.swap.max", "utf8").trim();
  if (!/^\d+$/.test(memory) || Number(memory) > limits.MEMORY || swap !== "0") {
    throw new Error("Payment validator needs a cgroup memory limit of at most 256 MiB with swap disabled");
  }
  if (Object.values(os.networkInterfaces()).flat().some((entry) => !entry.internal)) {
    throw new Error("Payment validator needs an isolated network namespace");
  }
}

function serve(socket) {
  let busy = false;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/validate") {
      res.writeHead(404).end();
      return;
    }
    const type = req.headers["content-type"];
    const size = Number(req.headers["content-length"]);
    if (typeof type !== "string" || !Number.isSafeInteger(size) || size < 1 || size > limits.FILE) {
      res.writeHead(413).end();
      return;
    }
    if (busy) {
      res.writeHead(503).end();
      return;
    }

    busy = true;
    const child = spawn(process.execPath, [path.join(__dirname, "validate.cjs"), type], {
      env: { PATH: process.env.PATH, UV_THREADPOOL_SIZE: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let ended = false;
    let timedOut = false;
    const kill = () => { if (!ended) child.kill("SIGKILL"); };
    const deadline = setTimeout(() => { timedOut = true; kill(); }, limits.TIME);
    req.on("aborted", kill);
    res.on("close", kill);
    child.stdin.on("error", () => undefined);
    child.on("error", () => undefined);
    child.on("close", (code) => {
      ended = true;
      clearTimeout(deadline);
      busy = false;
      if (!res.headersSent && code !== 0) res.writeHead(timedOut ? 504 : 503).end();
      else if (code === 0) res.end();
      else res.destroy();
    });
    req.pipe(child.stdin);
    child.stdout.pipe(res, { end: false });
  });
  server.listen(socket, () => chmodSync(socket, 0o666));
  return server;
}

function start(socket) {
  const entry = lstatSync(socket, { throwIfNoEntry: false });
  if (!entry) return serve(socket);
  if (!entry.isSocket()) throw new Error("Unexpected file on the validator socket path");
  const probe = net.createConnection(socket);
  probe.once("connect", () => {
    probe.end();
    throw new Error("A payment validator already holds this socket");
  });
  probe.once("error", (error) => {
    if (error.code !== "ECONNREFUSED") throw error;
    unlinkSync(socket);
    serve(socket);
  });
}

// Production startup validates the actual kernel settings before binding.
if (require.main === module) {
  assertIsolation();
  start("/run/payment-validator/worker.sock");
}
module.exports = { serve };
