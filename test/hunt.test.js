// End to end test of the job hunt with fake job boards and a fake model.
// Run with: npm run test:hunt
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fetchAllJobs, filterJobs, jobKey } = require("../src/search");
const { processJob, writeReport } = require("../src/pipeline");
const { launchBrowser } = require("../src/apply");
const { loadHistory } = require("../src/history");
const sample = require("./sample_application.json");

if (!process.env.BROWSER_PATH && fs.existsSync("/opt/pw-browsers/chromium")) process.env.BROWSER_PATH = "/opt/pw-browsers/chromium";
// Pin the fit rule so the skip check doesn't depend on your own search.json settings.
const config = { ...require("../search.json"), apply_when_fit: ["strong match", "possible"] };
const profile = JSON.parse(JSON.stringify(require("../profile.json")));
profile.application_answers.legally_authorized_to_work_in_canada = "Yes";

// Fake job boards in the real API formats.
const boards = {
  "boards-api.greenhouse.io/v1/boards/acme/jobs": { jobs: [
    { id: 1, title: "Data Analyst Intern", company_name: "Acme", location: { name: "Toronto, ON" }, absolute_url: "https://acme.example/1", content: "&lt;p&gt;SQL and Excel&lt;/p&gt;" },
    { id: 2, title: "Senior Data Analyst", company_name: "Acme", location: { name: "Toronto, ON" }, absolute_url: "https://acme.example/2", content: "" },
    { id: 3, title: "Junior Web Developer", company_name: "Acme", location: { name: "London, UK" }, absolute_url: "https://acme.example/3", content: "" },
  ] },
  "api.lever.co/v0/postings/beta": [
    { id: "abc", text: "Software Developer Co-op", categories: { location: "Remote", allLocations: ["Remote"] }, country: "CA", hostedUrl: "https://jobs.lever.co/beta/abc", applyUrl: "https://jobs.lever.co/beta/abc/apply", descriptionPlain: "React" },
  ],
  "api.ashbyhq.com/posting-api/job-board/gamma": { jobs: [
    { id: "z9", title: "Business Intelligence Analyst", location: "Kingston, Ontario", isRemote: false, jobUrl: "https://jobs.ashbyhq.com/gamma/z9", applyUrl: "https://jobs.ashbyhq.com/gamma/z9/application", descriptionPlain: "Dashboards", isListed: true },
  ] },
};
global.fetch = async (url) => {
  const hit = Object.keys(boards).find((k) => url.includes(k));
  return { ok: Boolean(hit), status: hit ? 200 : 404, json: async () => boards[hit] };
};

// Fake model: returns the sample tailored application, or form answers.
let verdict = "possible";
const fakeChat = async (messages, schema) => {
  let reply = JSON.stringify({ ...sample, fit_assessment: { ...sample.fit_assessment, verdict } });
  if (schema?.properties?.unanswerable) {
    const fields = JSON.parse(messages[1].content.split("Form fields:\n")[1]);
    const a = profile.application_answers;
    const rules = [[/first/i, a.first_name], [/last/i, a.last_name], [/email/i, a.email], [/phone/i, a.phone], [/country/i, "Canada"],
      [/authorized/i, "Yes"], [/student/i, "Yes"], [/why/i, "I enjoy data work."], [/gender/i, "Decline to self-identify"], [/privacy/i, "yes"]];
    const answers = fields.map((f) => ({ key: f.key, values: [rules.find(([re]) => re.test(f.label))?.[1]].filter(Boolean) })).filter((x) => x.values.length);
    reply = JSON.stringify({ answers, unanswerable: [] });
  }
  return reply;
};

(async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "hunt-"));
  const history = loadHistory(path.join(outDir, "history.json"));
  const all = await fetchAllJobs({ greenhouse: ["acme", "missing"], lever: ["beta"], ashby: ["gamma"] }, () => {});
  assert.strictEqual(all.length, 5);
  const matches = filterJobs(all, config, history);
  assert.deepStrictEqual(matches.map((j) => j.title).sort(), ["Business Intelligence Analyst", "Data Analyst Intern", "Software Developer Co-op"]);
  assert.strictEqual(matches.find((j) => j.platform === "greenhouse").applyUrl, "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1");

  // Apply to the first match, pointed at the practice form.
  const job = { ...matches.find((j) => j.title === "Data Analyst Intern"), applyUrl: `file://${path.join(__dirname, "fixtures", "mock_form.html")}` };
  const browser = await launchBrowser(false);
  verdict = "long shot";
  const skipped = await processJob({ job, profile, config, backend: { chat: fakeChat }, browser, args: { dryRun: false }, outDir, log: () => {} });
  assert.strictEqual(skipped.status, "skipped_fit", "a long shot must not be applied to");
  verdict = "possible";
  const result = await processJob({ job, profile, config, backend: { chat: fakeChat }, browser, args: { dryRun: false }, outDir, log: () => {} });
  await browser.close();
  assert.strictEqual(result.status, "submitted", result.reason);
  history.set(jobKey(job), { status: result.status });
  assert.strictEqual(filterJobs(all, config, history).length, 2, "an applied job must not come back");

  const report = fs.readFileSync(writeReport([result], matches.slice(1), { dryRun: false }, outDir), "utf8");
  assert.match(report, /## Submitted \(1\)/);
  assert.match(report, /More matches for next time \(2\)/);
  console.log("All hunt tests passed.");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
