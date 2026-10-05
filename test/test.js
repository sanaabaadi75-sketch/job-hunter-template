// Offline tests: no Ollama needed. Run with: npm test
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { htmlToText, findGreenhouse, findLever } = require("../src/fetchJob");
const { reviewDraft, runAgent } = require("../src/agent");
const { transcript } = require("../src/backends");
const profile = require("../profile.json");
const sample = require("./sample_application.json");

assert.deepStrictEqual(
  findGreenhouse("https://www.instacart.careers/job?gh_jid=8249896", '<iframe src="https://boards.greenhouse.io/embed/job_app?for=instacart&amp;token=8249896">'),
  { board: "instacart", id: "8249896" });
assert.deepStrictEqual(findGreenhouse("https://job-boards.greenhouse.io/acme/jobs/123", ""), { board: "acme", id: "123" });
assert.ok(findLever("https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"));
assert.strictEqual(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;<ul><li>SQL</li></ul>"), "Hello & welcome\n* SQL");

assert.deepStrictEqual(reviewDraft(sample, profile), []);
const dashed = JSON.parse(JSON.stringify(sample));
dashed.cover_letter.paragraphs[0] += " I love data \u2014 truly.";
assert.strictEqual(reviewDraft(dashed, profile).length, 1);
const invented = JSON.parse(JSON.stringify(sample));
invented.resume.skills[0].value += ", Snowflake";
invented.resume.sections[0].entries[0].bullets[0] += ", cutting load time by 40%";
const found = reviewDraft(invented, profile).join(" ");
assert.ok(/Snowflake/.test(found) && /40%/.test(found), found);

// Fake model: first reply is broken, second has a dash, third is good.
const outDir = path.join(__dirname, "out");
fs.rmSync(outDir, { recursive: true, force: true });
const replies = ["not json at all", JSON.stringify(dashed), JSON.stringify(sample)];
const calls = [];
const fakeChat = async (messages) => { calls.push(JSON.parse(JSON.stringify(messages))); return replies.shift(); };

runAgent({ profile, jobText: "fake job", outDir, chat: fakeChat, log: () => {} }).then(({ saved }) => {
  assert.strictEqual(calls.length, 3, "agent should retry until the draft passes");
  assert.ok(/valid JSON/.test(calls[1].at(-1).content));
  assert.ok(/dash/.test(calls[2].at(-1).content));
  for (const f of Object.values(saved)) assert.ok(fs.statSync(f).size > 500, f);
  console.log("All tests passed. Sample output in", path.dirname(saved.resume));
});

// Claude Code gets one prompt, so retries must include the earlier draft and the fix list.
const flat = transcript([
  { role: "system", content: "rules" },
  { role: "user", content: "job text" },
  { role: "assistant", content: "{\"draft\":1}" },
  { role: "user", content: "Fix these problems" },
]);
assert.ok(!flat.includes("rules") && /job text[\s\S]*YOUR PREVIOUS DRAFT:\n\{"draft":1\}[\s\S]*Fix these/.test(flat));
