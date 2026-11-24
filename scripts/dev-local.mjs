import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { readExecutionProfile } from "./execution-profile.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const host = "127.0.0.1";
const appPort = 5173;
const documentPort = 8091;
const children = new Set();
const shutdown = new AbortController();

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    process.exitCode = code;
    shutdown.abort();
    stopChildren();
  });
}

function stopChildren() {
  for (const child of children) child.kill();
}

function start(executable, args) {
  shutdown.signal.throwIfAborted();
  const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
  children.add(child);
  child.once("close", () => children.delete(child));
  return once(child, "exit");
}

function findPython() {
  const windows = process.platform === "win32";
  const venvPath = windows ? "../.venv/Scripts/python.exe" : "../.venv/bin/python";
  const venv = fileURLToPath(new URL(venvPath, import.meta.url));
  const systemPython = windows ? [["py", "-3.12"], ["python"]] : [["python3.12"], ["python3"]];
  const candidates = process.env.FITIFY_PYTHON
    ? [[process.env.FITIFY_PYTHON]]
    : [[venv], ...systemPython];
  const check = [
    "import sys",
    "assert sys.version_info >= (3, 12)",
    "import pdfplumber, pypdf, pymupdf",
    "print(sys.executable)",
  ].join("\n");

  for (const [executable, ...args] of candidates) {
    const probe = spawnSync(executable, [...args, "-c", check], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      timeout: 10000,
    });
    if (probe.status === 0) return probe.stdout.replace(/\r?\n$/, "");
  }
  throw new Error("Python 3.12+ with the document dependencies is required. Follow the local setup in README.md or set FITIFY_PYTHON to a configured interpreter.");
}

async function requireFreePort(port) {
  const socket = createServer();
  socket.listen({ host, port, exclusive: true });
  try {
    await once(socket, "listening");
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use. Stop its local server before starting Fitify.`);
    }
    throw error;
  }
  await new Promise((resolve) => socket.close(resolve));
}

async function waitForHttp(url, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(2000)]);
    const response = await fetch(url, { signal }).catch(() => undefined);
    if (response) {
      await response.body?.cancel();
      if (response.ok) return;
    }
    await setTimeout(250, undefined, { signal: shutdown.signal });
  }
  throw new Error(`Server did not become ready at ${url}.`);
}

function failOnExit(name, exited) {
  return exited.then(([code, signal]) => {
    throw new Error(`${name} stopped (${signal ?? `exit ${code}`}).`);
  });
}

try {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Start the local stack with npm run dev:local.");
  const python = findPython();
  await Promise.all([requireFreePort(documentPort), requireFreePort(appPort)]);
  const [migrationCode] = await start(process.execPath, [npm, "run", "db:local"]);
  if (migrationCode !== 0) throw new Error("Local database migration failed.");

  const documentExit = failOnExit("Document engine", start(python, ["scripts/dev-document-service.py"]));
  const appUrl = `http://${host}:${appPort}/`;
  await Promise.race([documentExit, waitForHttp(`http://${host}:${documentPort}/health`, 15000)]);

  const hostOption = readExecutionProfile() === "managed-linux" ? "--host" : "--hostname";
  const appExit = failOnExit("Web app", start(process.execPath, [
    "scripts/run-framework.mjs", "dev", hostOption, host, "--port", String(appPort),
  ]));
  const exited = Promise.race([documentExit, appExit]);
  await Promise.race([exited, waitForHttp(appUrl, 120000)]);
  console.log(`Fitify is ready at ${appUrl}`);
  await exited;
} catch (error) {
  if (!shutdown.signal.aborted) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  shutdown.abort();
  stopChildren();
}
