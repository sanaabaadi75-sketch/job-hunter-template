#!/usr/bin/env node
// Command line entry point.
//   node src/index.js <job url>
//   node src/index.js --file jobs/some_job.txt
// Options: --use claude|ollama  --profile <path>  --out <folder>

const fs = require("fs");
const path = require("path");
const { runAgent } = require("./agent");
const { BACKENDS } = require("./backends");

function parseArgs(argv) {
  const args = { profile: "profile.json", out: "applications", use: process.env.RESUME_AGENT_BACKEND || "claude" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") args.file = argv[++i];
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--use") args.use = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else args.url = arg;
  }
  return args;
}

const USAGE = `Usage:
  node src/index.js <job posting URL>
  node src/index.js --file jobs/job.txt     (paste the job description into a text file)

Options:
  --use <claude|ollama>  claude (default) uses your Claude Pro plan through Claude Code;
                         ollama uses a free model on your own computer
  --profile <path>   your master profile (default: profile.json)
  --out <folder>     where to save results (default: applications)`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let exitCode = 0;
  const backend = BACKENDS[args.use];
  let backendProblem = null;
  if (args.help || (!args.url && !args.file)) {
    console.log(USAGE);
    exitCode = args.help ? 0 : 1;
  } else if (!backend) {
    console.error(`Unknown option --use ${args.use}. Choose claude or ollama.`);
    exitCode = 1;
  } else if ((backendProblem = await backend.check())) {
    console.error(backendProblem);
    exitCode = 1;
  } else {
    console.log(`Using ${backend.label}`);
    const profile = JSON.parse(fs.readFileSync(path.resolve(args.profile), "utf8"));
    const jobText = args.file ? fs.readFileSync(path.resolve(args.file), "utf8") : null;
    const { saved, application, problems } = await runAgent({
      profile,
      jobUrl: args.url,
      jobText,
      outDir: path.resolve(args.out),
      chat: backend.chat,
    });
    if (saved) {
      const fit = application.fit_assessment;
      console.log(`\nDone: ${application.job_title} at ${application.company}`);
      console.log(`Fit: ${fit.verdict.toUpperCase()}. ${fit.reasoning}`);
      console.log(`\nFiles:\n  ${Object.values(saved).join("\n  ")}`);
    } else {
      console.error(`\nThe model could not produce a draft that passed the checks. Last problems:\n  ${problems.join("\n  ")}\nTry running it again (see README for options).`);
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}

try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file is fine; it is only for optional settings.
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
