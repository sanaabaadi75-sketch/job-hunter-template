// The two ways to run the AI model. Each "chat" function takes the
// conversation so far (and the JSON shape the answer must have) and
// returns the model's reply as JSON text.
//
// claude: uses Claude Code, which is included in your Claude Pro plan.
//         No API key; it runs on your Pro login and counts toward your
//         Pro usage limits.
// ollama: a free model running on your own computer.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { APPLICATION_SCHEMA } = require("./schema");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;
const THINKING_MODEL = /^(qwen3|deepseek-r1|gpt-oss|magistral)/.test(OLLAMA_MODEL);

// On Windows, npm installs Claude Code as a claude.cmd shim, which spawn can't
// run without a shell (and a shell would mangle the long prompt arguments).
// Find the real claude.exe instead: either on PATH (native installer) or
// next to the npm shim.
function resolveCommand(command) {
  if (process.platform !== "win32" || command !== "claude") return command;
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidates = [
      path.join(dir, "claude.exe"),
      path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) return found;
  }
  return command;
}

// Runs a program, sends `input` to it, and resolves with what it printed.
function runProgram(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Run from a temp folder so Claude Code doesn't load this project's files.
    const child = spawn(resolveCommand(command), args, { cwd: os.tmpdir() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} took longer than ${timeoutMs / 60000} minutes and was stopped.`));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed (exit ${code}): ${(stdout || stderr).trim().slice(0, 500)}`));
    });
    child.stdin.end(input);
  });
}

// Claude Code takes one prompt, so earlier turns are written out as a transcript.
function transcript(messages) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => (m.role === "assistant" ? `YOUR PREVIOUS DRAFT:\n${m.content}` : m.content))
    .join("\n\n");
}

async function claudeChat(messages, schema = APPLICATION_SCHEMA) {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--model", CLAUDE_MODEL,
    "--system-prompt", system,
    "--permission-mode", "dontAsk",
  ];
  const output = JSON.parse(await runProgram("claude", args, transcript(messages), CLAUDE_TIMEOUT_MS));
  if (output.is_error) {
    throw new Error(`Claude Code reported an error: ${output.result}`);
  }
  return output.structured_output ? JSON.stringify(output.structured_output) : String(output.result ?? "");
}

async function ollamaChat(messages, schema = APPLICATION_SCHEMA) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      // Reasoning models think out loud first; switching that off makes them faster.
      ...(THINKING_MODEL ? { think: false } : {}),
      format: schema,
      // The profile plus a job posting is long; the default memory window is too small.
      options: { temperature: 0.3, num_ctx: 16384 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama error (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.message?.content ?? "";
}

// Each check returns an error message if the backend is not ready, or null if it is.
async function checkClaude() {
  let problem = null;
  try {
    await runProgram("claude", ["--version"], "", 30000);
  } catch {
    problem = "Claude Code is not installed or not on your PATH. Install it (see README), run 'claude' once and sign in with your Pro account, then try again.";
  }
  return problem;
}

async function checkOllama() {
  let problem = null;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json();
    const names = (data.models ?? []).map((m) => m.name);
    const hasModel = names.some((n) => n === OLLAMA_MODEL || n === `${OLLAMA_MODEL}:latest`);
    if (!hasModel) {
      problem = `The model "${OLLAMA_MODEL}" is not downloaded yet. Run: ollama pull ${OLLAMA_MODEL}`;
    }
  } catch {
    problem = "Ollama is not running. Open the Ollama app (or run 'ollama serve') and try again.";
  }
  return problem;
}

const BACKENDS = {
  claude: { label: `Claude (${CLAUDE_MODEL}) through your Pro plan`, chat: claudeChat, check: checkClaude },
  ollama: { label: `free local model ${OLLAMA_MODEL} through Ollama`, chat: ollamaChat, check: checkOllama },
};

module.exports = { BACKENDS, transcript };
