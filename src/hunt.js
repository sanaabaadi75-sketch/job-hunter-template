#!/usr/bin/env node
// The job hunter: searches company job boards, tailors your resume and
// cover letter for each new match, and applies automatically.
//
//   npm run hunt                 search, tailor and apply
//   npm run hunt -- --dry-run    do everything except press Submit
//   npm run hunt -- --search-only   just list matching jobs
// Other options: --max <n>  --show  --use claude|ollama

const fs = require("fs");
const path = require("path");
const { fetchAllJobs, filterJobs, jobKey } = require("./search");
const { loadHistory } = require("./history");
const { launchBrowser } = require("./apply");
const { processJob, writeReport } = require("./pipeline");
const { BACKENDS } = require("./backends");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { use: process.env.RESUME_AGENT_BACKEND || "claude", dryRun: false, show: false, searchOnly: false, max: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--show") args.show = true;
    else if (arg === "--search-only") args.searchOnly = true;
    else if (arg === "--max") args.max = Number(argv[++i]);
    else if (arg === "--use") args.use = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = console.log;
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, "profile.json"), "utf8"));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "search.json"), "utf8"));
  const history = loadHistory(path.join(ROOT, "data", "history.json"));
  const backend = BACKENDS[args.use];
  const outDir = path.join(ROOT, "applications");
  const backendProblem = backend && !args.searchOnly ? await backend.check() : null;
  let exitCode = 0;

  if (!backend) {
    console.error(`Unknown option --use ${args.use}. Choose claude or ollama.`);
    exitCode = 1;
  } else if (backendProblem) {
    console.error(backendProblem);
    exitCode = 1;
  } else {
    log("Searching job boards...");
    const matches = filterJobs(await fetchAllJobs(config.companies, log), config, history);
    const limit = args.max ?? config.max_jobs_per_run;
    log(`\nFound ${matches.length} new matching jobs.`);
    if (args.searchOnly) {
      matches.forEach((j) => log(`* [${j.jobType}] ${j.title} at ${j.company} (${j.location})\n  ${j.url}`));
    } else {
      const todo = matches.slice(0, limit);
      const browser = todo.length ? await launchBrowser(args.show).catch((err) => {
        log(`Could not start the browser: ${err.message.split("\n")[0]}`);
        return null;
      }) : null;
      const results = [];
      for (const job of todo) {
        const result = await processJob({ job, profile, config, backend, browser, args, outDir, log })
          .catch((err) => ({ job, status: "failed", reason: err.message, folder: null }));
        results.push(result);
        if (result.status !== "dry_run") {
          history.set(jobKey(job), { title: job.title, company: job.company, url: job.url, status: result.status, reason: result.reason, folder: result.folder });
        }
      }
      await browser?.close();
      const counts = ["submitted", "email_ready", "skipped_duplicate", "needs_you", "dry_run", "skipped_fit", "failed"]
        .map((s) => `${results.filter((r) => r.status === s).length} ${s.replace("_", " ")}`).join(", ");
      log(`\nDone: ${counts}.`);
      log(`Report: ${writeReport(results, matches.slice(limit), args, outDir)}`);
    }
  }
  process.exitCode = exitCode;
}

try {
  process.loadEnvFile?.(path.join(ROOT, ".env"));
} catch {
  // No .env file is fine.
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
