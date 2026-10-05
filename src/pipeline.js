// The steps of one job hunt: tailor documents for a job, apply, and report.
const fs = require("fs");
const path = require("path");
const { runAgent } = require("./agent");
const { applyToJob } = require("./apply");
const { jobbankDescription, readHowToApply, emailDraft, screeningQuestions, answerScreening } = require("./jobbank");
const { mailConfigured, sendApplication, alreadyEmailed, recordSent } = require("./mailer");
const { ACCOUNT_SITES, REMOTE_SITES, formLinkIn, pageText } = require("./moreSources");

// Job Bank jobs are never applied to directly (see jobbank.js). Email postings
// get an email_draft.json for Claude to put in Gmail; the rest need you.
// Emails the application if Gmail is set up (and this is not a dry run);
// otherwise leaves email_draft.json for you to send.
async function sendOrKeep({ job, draft, folder, dryRun, log }) {
  const earlier = alreadyEmailed(draft.to);
  if (earlier) {
    return { status: "skipped_duplicate", reason: `Already emailed ${draft.to} for "${earlier.title}" on ${earlier.sent.slice(0, 10)}, so this one was not sent.` };
  }
  if (!mailConfigured() || dryRun) {
    return { status: "email_ready", reason: `Apply by email to ${draft.to}. The email with your resume and cover letter is saved in email_draft.json${dryRun ? " (dry run, not sent)" : "; set up Gmail sending (see README) to send it automatically"}.` };
  }
  log(`    Emailing ${draft.to}...`);
  await sendApplication(draft);
  recordSent(draft.to, job);
  fs.writeFileSync(path.join(folder, "email_draft.json"), JSON.stringify({ ...draft, sent_at: new Date().toISOString() }, null, 2));
  return { status: "submitted", reason: `Emailed to ${draft.to} with your resume and cover letter attached (see your Gmail Sent folder).` };
}

async function handleJobBank({ job, application, saved, profile, browser, chat, dryRun, log }) {
  log("    Reading how to apply...");
  const howTo = await readHowToApply(browser, job);
  const folder = path.dirname(saved.resume);
  if (howTo.emails.length) {
    const draft = emailDraft(job, application, howTo, { resume: saved.resume, coverLetter: saved.coverLetter }, profile);
    const questions = screeningQuestions(howTo.text);
    if (questions.length) {
      log(`    Answering ${questions.length} screening questions...`);
      const { block, missing } = await answerScreening(questions, job, profile, chat);
      draft.body = draft.body.replace(/\nSincerely,/, `\n${block}\n\nSincerely,`);
      if (missing.length) {
        fs.writeFileSync(path.join(folder, "email_draft.json"), JSON.stringify(draft, null, 2));
        return { status: "needs_you", reason: `The email to ${draft.to} is ready, but these screening questions need facts not in your profile: ${missing.join(" ")} Add the answers to profile.json, then run npm run send-emails.` };
      }
    }
    fs.writeFileSync(path.join(folder, "email_draft.json"), JSON.stringify(draft, null, 2));
    return sendOrKeep({ job, draft, folder, dryRun, log });
  }
  const how = howTo.directApply
    ? "Apply with Job Bank Direct Apply (sign in to Job Bank, open the link, press Direct Apply and upload the documents in the folder)."
    : "Apply as the posting says.";
  return { status: "needs_you", reason: `${how} How to apply: ${howTo.text || "see the posting"}` };
}

const describeJob = (job) => [
  `Title: ${job.title}`,
  `Company: ${job.company}`,
  `Location: ${job.location}`,
  `Link: ${job.url}`,
  "",
  job.description,
].join("\n").slice(0, 20000);

// Tailors documents for one job, then applies if the fit is good enough.
async function processJob({ job, profile, config, backend, browser, args, outDir, log }) {
  log(`\n> ${job.title} at ${job.company} (${job.location})`);
  if (job.platform === "jobbank" && !job.description) job.description = await jobbankDescription(job);
  if (ACCOUNT_SITES.has(job.platform) && !job.description) job.description = await pageText(job.url).catch(() => "");
  const { saved, application, problems } = await runAgent({
    profile,
    jobText: describeJob(job),
    outDir,
    chat: backend.chat,
    log: (m) => log(`    ${m.trim()}`),
  });
  let result;
  if (!saved) {
    result = { status: "failed", reason: `Could not write documents: ${problems.join("; ")}` };
  } else if (!config.apply_when_fit.includes(application.fit_assessment.verdict)) {
    result = { status: "skipped_fit", reason: `Fit was "${application.fit_assessment.verdict}": ${application.fit_assessment.reasoning}` };
  } else if (ACCOUNT_SITES.has(job.platform)) {
    result = { status: "needs_you", reason: `Apply on the ${job.company} careers site (it needs your own account there). Your tailored resume and cover letter are ready in the folder.` };
  } else if (REMOTE_SITES.has(job.platform) && !formLinkIn(job.description)) {
    result = { status: "needs_you", reason: "This remote job site hides the employer's application form, so apply from the link. Your tailored resume and cover letter are ready in the folder." };
  } else if (!browser) {
    result = { status: "needs_you", reason: "Documents are ready, but the browser could not start, so it was not submitted." };
  } else if (job.platform === "jobbank") {
    log(`    Fit: ${application.fit_assessment.verdict}.`);
    result = await handleJobBank({ job, application, saved, profile, browser, chat: backend.chat, dryRun: args.dryRun, log });
  } else {
    log(`    Fit: ${application.fit_assessment.verdict}. Applying...`);
    result = await applyToJob({
      browser,
      // A remote site's posting that links to a Greenhouse, Lever or Ashby form is applied to there.
      job: REMOTE_SITES.has(job.platform) ? { ...job, applyUrl: formLinkIn(job.description) } : job,
      files: { resume: saved.resume, coverLetter: saved.coverLetter },
      profile,
      chat: backend.chat,
      dryRun: args.dryRun,
      folder: path.dirname(saved.resume),
      log,
    });
  }
  log(`    Result: ${result.status.toUpperCase()}. ${result.reason}`);
  return { job, folder: saved ? path.dirname(saved.resume) : null, fit: application?.fit_assessment?.verdict ?? "", ...result };
}

function writeReport(results, waiting, args, outDir) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = path.join(outDir, `hunt_report_${stamp}.md`);
  const line = (r) => `* **${r.job.title}** at ${r.job.company} (${r.job.location})  \n  ${r.reason}  \n  Job: ${r.job.url}${r.folder ? `  \n  Files: ${r.folder}` : ""}`;
  const section = (title, status) => {
    const rows = results.filter((r) => r.status === status);
    return rows.length ? [`## ${title} (${rows.length})`, "", ...rows.map(line), ""] : [];
  };
  const text = [
    `# Job hunt report, ${new Date().toLocaleString("en-CA")}`,
    args.dryRun ? "\nDry run: forms were filled but nothing was submitted.\n" : "",
    ...section("Submitted", "submitted"),
    ...section("Email ready but not sent (Gmail sending not set up, or dry run)", "email_ready"),
    ...section("Not emailed: that employer was already emailed for another posting", "skipped_duplicate"),
    ...section("Needs you: finish these by hand", "needs_you"),
    ...section("Filled but not submitted (dry run)", "dry_run"),
    ...section("Skipped: not a good enough fit", "skipped_fit"),
    ...section("Failed", "failed"),
    waiting.length ? `## More matches for next time (${waiting.length})\n\n${waiting.map((j) => `* ${j.title} at ${j.company} (${j.location}): ${j.url}`).join("\n")}\n` : "",
  ].join("\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

module.exports = { processJob, writeReport, describeJob };
