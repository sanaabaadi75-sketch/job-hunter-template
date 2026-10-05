// The agent: an AI model (Claude through your Pro plan, or a free local
// model through Ollama) reads the job and writes a tailored resume and
// cover letter from your profile, and then the code checks the draft. If the check finds
// problems (invented skills or numbers, dashes, too long), the draft goes
// back to the model with the list of problems until it passes.

const { fetchJobPosting } = require("./fetchJob");
const { saveApplication } = require("./render");

const MAX_ATTEMPTS = 4;
const DASHES = /[‒–—―]|\s-\s/;

function systemPrompt(profile) {
  const usable = { ...profile };
  delete usable.unverified;
  delete usable._readme;
  delete usable.application_answers;
  return `You are a careful career assistant. You tailor a resume and cover letter for ${profile.name} to ONE job posting, and you answer only with JSON in the required shape.

What to produce:
* company and job_title: taken from the posting.
* resume.summary: two to four sentences aimed at this job.
* resume.skills: two to four lines, each with a label (like "Data and Analytics") and a comma separated value. Most relevant first. Only skills listed in the profile.
* resume.sections: in order of relevance to this job, usually "Projects", "Education and Certification", "Experience". Each entry has title, subtitle (organization or role), date, and bullets. Leave out entries that do not help.
* cover_letter: recipient_lines (for example "Hiring Team" and the company name), subject ("Re: " plus the job title), greeting, and three to five paragraphs specific to this company and role. The paragraphs are the body only: no greeting and no sign off ("Sincerely" and the name are added automatically).
* fit_assessment: an honest verdict, plain language reasoning, requirements clearly met, gaps, and suggestions. Watch for blockers like years of experience, degree, location, or a full time role while the candidate is a full time student.

How to tailor (make the strongest honest case for THIS job, even when the fit is a stretch):
* Read the posting's main duties and requirements, then pick the profile facts that best show the candidate can do that work, including transferable ones. For example, data cleaning and validation supports fraud review, QA, annotation or analyst roles; explaining technical issues to customers supports support, coordination or client facing roles.
* Use the posting's own words and terms to describe matching profile facts, so the resume reads as written for this job. Only reword a fact into the posting's language when the fact truly is that thing.
* The summary names the target role and opens with the candidate's closest real experience to it, stated confidently.
* Order skills, sections, entries and bullets by how directly they match this posting. Rewrite each bullet to lead with the part most relevant to this job.
* Confident, direct tone in the resume and cover letter. No hedging ("I believe I could", "although I have limited", "I hope to"), no apologies.
* In the cover letter, when the role asks for things the profile does not show, do not mention them; instead argue from real evidence that the candidate learns fast and delivers on their own (for example, projects built and run independently, a paid client system, scholarships or grades in the profile).

Strict rules:
* Use ONLY facts from the candidate profile. Never invent employers, dates, numbers, percentages, tools, or results. You may reword facts but not add to them.
* If the posting asks for something the profile does not show, put it in fit_assessment.gaps, not on the resume.
* The cover letter is for the employer: lead with strengths and never point out gaps, missing experience, or weaknesses there. Honest gaps belong only in fit_assessment.
* Within each section, list entries newest first (ongoing work first).
* Never use dashes as punctuation (no em dashes, en dashes, or " - "). Date ranges use "to", for example "2024 to 2025".
* Plain, clear language. No buzzwords like "passionate", "synergy" or "leverage".
* One page: at most 20 bullets in total, each under 25 words.

Candidate profile:
${JSON.stringify(usable, null, 2)}`;
}

const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9#+.]+/g, " ").trim();

// Checks a draft against the rules and the profile. Returns a list of problems.
function reviewDraft(app, profile) {
  const profileText = normalize(JSON.stringify({ ...profile, unverified: [] }));
  const allText = JSON.stringify(app);
  const resume = app.resume ?? {};
  const bullets = (resume.sections ?? []).flatMap((s) => s.entries ?? []).flatMap((e) => e.bullets ?? []);
  const inventedSkills = (resume.skills ?? [])
    .flatMap((s) => s.value.split(/,|\band\b/))
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter((s) => s && !profileText.includes(normalize(s)));
  const resumeNumbers = `${resume.summary ?? ""} ${bullets.join(" ")}`.match(/\d[\d.,%]*/g) ?? [];
  const inventedNumbers = resumeNumbers
    .map((n) => n.replace(/[.,]$/, ""))
    .filter((n) => !profileText.includes(n.toLowerCase()));
  const problems = [];
  if (DASHES.test(allText)) {
    problems.push("Some text uses a dash as punctuation (an em dash, en dash, or ' - '). Rewrite those sentences without dashes.");
  }
  if (inventedSkills.length) {
    problems.push(`These skills are not in the profile, so remove them from resume.skills: ${[...new Set(inventedSkills)].join(", ")}.`);
  }
  if (inventedNumbers.length) {
    problems.push(`These numbers do not appear in the profile, so remove them: ${[...new Set(inventedNumbers)].join(", ")}.`);
  }
  if (bullets.length > 22) {
    problems.push(`The resume has ${bullets.length} bullets, which will not fit on one page. Cut it to 20 or fewer.`);
  }
  if (!bullets.length) {
    problems.push("The resume has no bullets. Add relevant projects and experience from the profile.");
  }
  if ((app.cover_letter?.paragraphs?.length ?? 0) < 3) {
    problems.push("The cover letter needs at least three paragraphs.");
  }
  return problems;
}

function parseJson(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(text.replace(/<think>[\s\S]*?<\/think>/g, "").trim());
  } catch {
    parsed = null;
  }
  return parsed;
}

async function runAgent({ profile, jobUrl, jobText, outDir, chat, log = console.log }) {
  const jobSource = jobUrl || "pasted job description";
  log(jobUrl ? `Reading job posting: ${jobUrl}` : "Using the job description from your file");
  const posting = jobText ?? await fetchJobPosting(jobUrl);
  const messages = [
    { role: "system", content: systemPrompt(profile) },
    { role: "user", content: `Here is the job posting. Write the tailored application as JSON.\n\n${posting}` },
  ];
  let attempt = 0;
  let saved = null;
  let application = null;
  let problems = [];

  while (!saved && attempt < MAX_ATTEMPTS) {
    attempt += 1;
    log(`Writing draft ${attempt} (this can take a minute or two)...`);
    const reply = await chat(messages);
    const draft = parseJson(reply);
    problems = draft ? reviewDraft(draft, profile) : ["Your answer was not valid JSON. Answer with JSON only."];
    messages.push({ role: "assistant", content: reply });
    if (problems.length) {
      log(`  Check found ${problems.length} problem(s), asking the model to fix them:`);
      problems.forEach((p) => log(`  * ${p}`));
      messages.push({ role: "user", content: `Fix these problems and answer with the full corrected JSON:\n${problems.join("\n")}` });
    } else {
      log("  Check passed.");
      saved = await saveApplication(profile, draft, outDir, jobSource);
      application = draft;
    }
  }
  return { saved, application, problems };
}

module.exports = { runAgent, reviewDraft, systemPrompt };
