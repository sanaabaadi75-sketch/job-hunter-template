// Job Bank (jobbank.gc.ca), the Government of Canada job site. Used for local
// jobs, like retail, office, kitchen and support work in and around Kingston.
//
// Only postings the employer put on Job Bank itself are kept. Postings copied
// from other sites (Indeed, Jobillico, ...) are skipped: Indeed bans automated
// applying, and the others need you to apply on their site.
//
// Job Bank's own "Direct Apply" needs you signed in to a Job Bank account, so
// the hunter never applies here. It reads the "How to apply" box instead:
// email postings get a ready email (email_draft.json) that Claude puts in your
// Gmail as a draft; everything else (Direct Apply, in person, mail) goes in the
// report with the exact instructions.

const { htmlToText } = require("./fetchJob");
const { letterParagraphs } = require("./render");

const BASE = "https://www.jobbank.gc.ca";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const MAX_PAGES = 20;

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const clean = (s) => htmlToText(s || "").replace(/\s+/g, " ").trim();

// Reads one page of search results into jobs.
function parseResults(html) {
  return html.split(/<article id="article-/).slice(1).map((chunk) => {
    const pick = (re) => clean(chunk.match(re)?.[1]);
    return {
      id: chunk.match(/^(\d+)/)?.[1],
      title: pick(/<span class="noctitle">([\s\S]*?)<\/span>/),
      company: pick(/<li class="business">([\s\S]*?)<\/li>/),
      location: pick(/<li class="location">([\s\S]*?)<\/li>/).replace(/^Location\s*/, ""),
      salary: pick(/<li class="salary">([\s\S]*?)<\/li>/).replace(/^Salary\s*/, ""),
      onJobBank: /class="postedonJB"/.test(chunk),
    };
  }).filter((j) => j.id && j.title);
}

// `where` is Job Bank's id for a city (Kingston, ON is 22403; results include
// nearby towns), or "remote" for remote jobs anywhere in Canada. Newest first.
async function jobbankJobs(where) {
  const remote = where === "remote";
  const filter = remote ? "fskl=15141" : `mid=${where}`; // 15141 is Job Bank's "Remote" workplace filter
  const jobs = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await getText(`${BASE}/jobsearch/jobsearch?${filter}&sort=D&page=${page}`);
    const found = parseResults(html);
    if (!found.length) break;
    jobs.push(...found);
  }
  const seen = new Set();
  return jobs
    .filter((j) => j.onJobBank && !seen.has(j.id) && seen.add(j.id))
    .map((j) => ({
      platform: "jobbank",
      company: j.company || "Employer on Job Bank",
      id: j.id,
      title: j.title.charAt(0).toUpperCase() + j.title.slice(1),
      location: remote ? `Remote (Canada); ${j.location}` : j.location,
      url: `${BASE}/jobsearch/jobposting/${j.id}`,
      applyUrl: `${BASE}/jobsearch/jobposting/${j.id}`,
      description: "",
      salary: j.salary,
    }));
}

// Search results have no description, so download the posting itself.
async function jobbankDescription(job) {
  const html = await getText(job.url);
  const body = html.match(/<h2[^>]*>\s*Job details[\s\S]*?(?=<h2[^>]*>\s*(Job Bank|Advertised|Report)|<footer)/i)?.[0] ?? html;
  return [job.salary ? `Salary: ${job.salary}` : "", htmlToText(body)].filter(Boolean).join("\n").slice(0, 15000);
}

// Opens the posting, presses "Show how to apply" and reads the box.
// Returns { text, emails, directApply }.
async function readHowToApply(browser, job) {
  const page = await browser.newPage();
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await page.locator("#applynowbutton").count())) {
      return { text: "This posting is only on another site. Open the Job Bank link to see where to apply.", emails: [], directApply: false };
    }
    // The details load after the click, slowly on older postings. Wait until a
    // real apply method shows up, clicking again if the first click didn't take.
    const METHODS = /By email|Direct Apply|Online|In person|By mail|By phone|By fax/i;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator("#applynowbutton").click().catch(() => {});
      const loaded = await page.waitForFunction(
        (re) => new RegExp(re, "i").test(document.querySelector("#applynow")?.innerText || ""),
        METHODS.source,
        { timeout: 15000 },
      ).then(() => true).catch(() => false);
      if (loaded) break;
    }
    await page.waitForTimeout(500);
    // Open the "Additional ways to apply" section so its text is readable.
    await page.locator("#applynow summary").evaluateAll((els) => els.forEach((s) => s.click())).catch(() => {});
    const text = (await page.locator("#applynow").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const mailtos = await page.locator("#applynow a[href^='mailto:']").evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(7).split("?")[0]));
    const emails = [...new Set([...mailtos, ...(text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])].map((e) => e.toLowerCase()))];
    return { text, emails, directApply: /Direct Apply/i.test(text) };
  } finally {
    await page.close();
  }
}

// Many postings list "Answers to the following screening questions" that the
// email must answer. Returns the questions, or [] if there are none.
function screeningQuestions(howToText) {
  const block = howToText.match(/screening questions:?\s*(.*?)(What might|Advertised until|Learn more|$)/i)?.[1] ?? "";
  return block.split(/(?<=\?)\s+/).map((q) => q.trim()).filter((q) => q.endsWith("?"));
}

const SCREENING_SCHEMA = {
  type: "object",
  properties: {
    answers: { type: "array", items: { type: "object", properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } },
    unanswerable: { type: "array", items: { type: "string" } },
  },
  required: ["answers", "unanswerable"],
};

// Answers screening questions from the profile only. Returns { block, missing }:
// the text to add to the email, and any questions it could not answer truthfully.
async function answerScreening(questions, job, profile, chat) {
  const facts = { ...profile };
  delete facts.unverified;
  delete facts._readme;
  const reply = JSON.parse(await chat([
    { role: "system", content: `You answer job application screening questions for ${profile.name} using ONLY these facts. Answer each in one or two plain sentences, starting with Yes or No when the question is yes/no. Answer about the field of THIS job and leave out unrelated details. If a fact needed is not in the facts, put the question in unanswerable instead of guessing. No dashes as punctuation.\n\nFacts:\n${JSON.stringify(facts, null, 2)}` },
    { role: "user", content: `Job: ${job.title} at ${job.company}\n\nQuestions:\n${questions.map((q) => `* ${q}`).join("\n")}` },
  ], SCREENING_SCHEMA));
  const block = `Answers to your screening questions:\n\n${reply.answers.map((a) => `${a.question}\n${a.answer}`).join("\n\n")}`;
  return { block, missing: reply.unanswerable };
}

// Writes the email for an email posting.
function emailDraft(job, application, howTo, files, profile) {
  const letter = application.cover_letter;
  const { name, contact } = profile;
  const paragraphs = letterParagraphs(letter.paragraphs, name);
  const ref = howTo.text.match(/(?:reference number|job number)\s*:?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i)?.[1];
  return {
    to: howTo.emails[0],
    subject: `Application for ${job.title}${ref ? ` (${ref})` : ""}, ${name}`,
    body: [letter.greeting, "", ...paragraphs.flatMap((p) => [p, ""]), "Sincerely,", name, contact.phone, contact.email].join("\n"),
    attachments: [files.resume, files.coverLetter],
    job_url: job.url,
    how_to_apply: howTo.text,
  };
}

module.exports = { jobbankJobs, jobbankDescription, readHowToApply, emailDraft, parseResults, screeningQuestions, answerScreening };
