// Sends the email applications that are ready but not sent yet
// (every applications/*/email_draft.json without "sent_at").
//
//   npm run send-emails            send them
//   npm run send-emails -- --list  only show what would be sent
//
// Skips an email when:
//   * its job title matches exclude_title_words in search.json
//   * that address was already emailed (one application per employer address)
//   * the posting asks for screening question answers and the email has none

const fs = require("fs");
const path = require("path");
const { mailConfigured, checkMail, sendApplication, alreadyEmailed, recordSent } = require("./mailer");
const { loadHistory } = require("./history");

const ROOT = path.join(__dirname, "..");

// Older drafts can end with the sign off twice; keep only the last one.
const cleanBody = (body) => body.replace(/(\n+Sincerely,?\s*\n+[^\n]+\s*)+(\n+Sincerely,)/i, "\n\nSincerely,");

function hasPhrase(text, phrase) {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text.toLowerCase());
}

async function main() {
  const listOnly = process.argv.includes("--list");
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "search.json"), "utf8"));
  const history = loadHistory(path.join(ROOT, "data", "history.json"));
  const byFolder = Object.entries(history.all()).filter(([, v]) => v.folder);

  const appsDir = path.join(ROOT, "applications");
  const drafts = fs.readdirSync(appsDir)
    .map((dir) => path.join(appsDir, dir, "email_draft.json"))
    .filter((f) => fs.existsSync(f))
    .map((file) => ({ file, draft: JSON.parse(fs.readFileSync(file, "utf8")) }))
    .filter(({ draft }) => !draft.sent_at);

  if (!listOnly && !mailConfigured()) {
    console.error("Gmail sending is not set up. Add GMAIL_USER and GMAIL_APP_PASSWORD to .env (see README).");
    process.exitCode = 1;
    return;
  }
  if (!listOnly) {
    const problem = await checkMail();
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
      return;
    }
  }

  const planned = new Set();
  let sent = 0;
  for (const { file, draft } of drafts) {
    const folder = path.dirname(file);
    const [key, entry] = byFolder.find(([, v]) => path.resolve(v.folder) === path.resolve(folder)) ?? [];
    const title = entry?.title ?? draft.subject.replace(/^Application for /, "").replace(/,.*$/, "");
    const to = draft.to.toLowerCase();
    let skip = null;
    if (config.exclude_title_words.some((w) => hasPhrase(title, w))) skip = "job type you excluded";
    else if (alreadyEmailed(to) || planned.has(to)) skip = `already emailed ${to}`;
    else if (/screening questions/i.test(draft.how_to_apply) && !/Answers to your screening/i.test(draft.body)) skip = "screening questions not answered";

    if (skip) {
      console.log(`- Skipped ${title} (${skip})`);
      continue;
    }
    planned.add(to);
    if (listOnly) {
      console.log(`* Would send: ${title} -> ${to}`);
      continue;
    }
    const final = { ...draft, body: cleanBody(draft.body) };
    await sendApplication(final);
    const job = { title, company: entry?.company ?? "", url: draft.job_url };
    recordSent(to, job);
    fs.writeFileSync(file, JSON.stringify({ ...final, sent_at: new Date().toISOString() }, null, 2));
    if (key) history.set(key, { ...entry, status: "submitted", reason: `Emailed to ${to} with your resume and cover letter attached.` });
    console.log(`* Sent: ${title} -> ${to}`);
    sent++;
  }
  console.log(listOnly ? "\n(List only, nothing sent.)" : `\nDone: ${sent} sent. They are in your Gmail Sent folder.`);
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
