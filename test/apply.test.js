// Tests the form filler on a practice form (no internet, no Claude needed).
// Run with: npm run test:apply
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { applyToJob, launchBrowser } = require("../src/apply");

if (!process.env.BROWSER_PATH && fs.existsSync("/opt/pw-browsers/chromium")) process.env.BROWSER_PATH = "/opt/pw-browsers/chromium";

const baseProfile = require("../profile.json");
const formUrl = `file://${path.join(__dirname, "fixtures", "mock_form.html")}`;
const job = { title: "Data Analyst Intern", company: "Mockly", applyUrl: formUrl };

// A stand-in for Claude that answers by reading the labels, using only application_answers.
function fakeChat(messages) {
  const a = JSON.parse(messages[0].content.split("Facts:\n")[1]).application_answers;
  const fields = JSON.parse(messages[1].content.split("Form fields:\n")[1]);
  const answers = [];
  const unanswerable = [];
  const rules = [
    [/first name/i, a.first_name], [/last name/i, a.last_name], [/email/i, a.email], [/phone/i, a.phone],
    [/country/i, a.country], [/linkedin/i, a.linkedin_url],
    [/authorized/i, a.legally_authorized_to_work_in_canada], [/student/i, a.currently_a_student ? "Yes" : null],
    [/why/i, "I like working with data and want to grow as an analyst."], [/gender/i, "Decline to self-identify"],
    [/privacy/i, "yes"],
  ];
  for (const f of fields) {
    const value = rules.find(([re]) => re.test(f.label))?.[1];
    if (value) answers.push({ key: f.key, values: [value] });
    else if (f.required) unanswerable.push({ key: f.key, reason: "not in profile" });
  }
  return Promise.resolve(JSON.stringify({ answers, unanswerable }));
}

async function run(name, profile, url, dryRun) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "apply-"));
  const files = { resume: path.join(folder, "Resume.docx"), coverLetter: path.join(folder, "Cover.docx") };
  fs.writeFileSync(files.resume, "resume");
  fs.writeFileSync(files.coverLetter, "cover");
  const browser = await launchBrowser(false);
  const result = await applyToJob({ browser, job: { ...job, applyUrl: url }, files, profile, chat: fakeChat, dryRun, folder, log: () => {} });
  await browser.close();
  console.log(`${name}: ${result.status}. ${result.reason}`);
  return { result, folder };
}

(async () => {
  // 1. Work authorization is unknown, so it must NOT apply.
  const missing = JSON.parse(JSON.stringify(baseProfile));
  missing.application_answers.legally_authorized_to_work_in_canada = null;
  const unknown = await run("Missing answer", missing, formUrl, false);
  assert.strictEqual(unknown.result.status, "needs_you");
  assert.match(unknown.result.reason, /authorized/i);

  // 2. With the answer filled in, it fills everything and submits.
  const ready = JSON.parse(JSON.stringify(baseProfile));
  ready.application_answers.legally_authorized_to_work_in_canada = "Yes";
  const ok = await run("Full answers", ready, formUrl, false);
  assert.strictEqual(ok.result.status, "submitted");
  assert.ok(fs.existsSync(path.join(ok.folder, "form_filled.png")));
  const sent = JSON.parse(fs.readFileSync(path.join(ok.folder, "after_submit.txt"), "utf8").split("\n").find((l) => l.startsWith("{")));
  assert.deepStrictEqual(sent, {
    first: "Alex", last: "Example", email: "alex.example@example.com", phone: "(555) 555-0100", country: "Canada",
    resume: "Resume.docx", cover: "Cover.docx", auth: "Yes", student: "y",
    why: "I like working with data and want to grow as an analyst.", gender: "Decline to self-identify", consent: true,
  });

  // 3. Dry run fills but does not submit.
  const dry = await run("Dry run", ready, formUrl, true);
  assert.strictEqual(dry.result.status, "dry_run");

  // 4. An emailed security code after submit is handed back to you.
  const code = await run("Security code", ready, `${formUrl}#code`, false);
  assert.strictEqual(code.result.status, "needs_you");
  assert.match(code.result.reason, /security code/i);
  console.log("All apply tests passed.");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
