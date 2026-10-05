// Finds open jobs on public company job boards (Greenhouse, Lever, Ashby) and
// local jobs on Job Bank (see jobbank.js), and keeps the ones that match your
// job types and locations.

const { htmlToText } = require("./fetchJob");
const { jobbankJobs } = require("./jobbank");
const { njoynJobs, successfactorsJobs, slcJobs, remotiveJobs, himalayasJobs } = require("./moreSources");
const { linkedinAlertJobs } = require("./linkedinAlerts");

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (job-hunter)" } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

const jobKey = (j) => `${j.platform}:${j.company}:${j.id}`;

// Every source returns jobs in this same shape.
const job = (fields) => ({
  platform: fields.platform,
  company: fields.company,
  id: String(fields.id),
  title: fields.title.trim(),
  location: fields.location || "",
  url: fields.url,
  applyUrl: fields.applyUrl,
  description: fields.description || "",
});

async function greenhouseJobs(board) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  return (data.jobs ?? []).map((j) => job({
    platform: "greenhouse",
    company: j.company_name || board,
    id: j.id,
    title: j.title,
    location: [j.location?.name, ...(j.offices ?? []).map((o) => o.name)].filter(Boolean).join("; "),
    url: j.absolute_url,
    // The embedded form works for every company, even ones that hide Greenhouse behind their own site.
    applyUrl: `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${j.id}`,
    description: htmlToText(j.content ?? ""),
  }));
}

async function leverJobs(company) {
  const data = await getJson(`https://api.lever.co/v0/postings/${company}?mode=json`);
  return (Array.isArray(data) ? data : []).map((p) => job({
    platform: "lever",
    company,
    id: p.id,
    title: p.text,
    location: [...(p.categories?.allLocations ?? [p.categories?.location]), p.workplaceType, p.country]
      .filter(Boolean).join("; "),
    url: p.hostedUrl,
    applyUrl: p.applyUrl,
    description: [p.descriptionPlain, ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), p.additionalPlain]
      .filter(Boolean).join("\n\n"),
  }));
}

async function ashbyJobs(org) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`);
  return (data.jobs ?? []).filter((j) => j.isListed !== false).map((j) => job({
    platform: "ashby",
    company: org,
    id: j.id,
    title: j.title,
    location: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location), j.address?.postalAddress?.addressCountry, j.isRemote ? "Remote" : ""]
      .filter(Boolean).join("; "),
    url: j.jobUrl,
    applyUrl: j.applyUrl,
    description: j.descriptionPlain || htmlToText(j.descriptionHtml ?? ""),
  }));
}

const SOURCES = {
  greenhouse: greenhouseJobs, lever: leverJobs, ashby: ashbyJobs, jobbank: jobbankJobs,
  njoyn: njoynJobs, successfactors: successfactorsJobs, slc: slcJobs, remotive: remotiveJobs, himalayas: himalayasJobs,
  linkedin_alerts: linkedinAlertJobs,
};

// Downloads every company board in the config. A broken board is reported, not fatal.
async function fetchAllJobs(companies, log = console.log) {
  const tasks = Object.entries(companies).flatMap(([platform, names]) =>
    names.map(async (spec) => {
      // Most sources are just a name; employer career sites are { name, ... }.
      const name = typeof spec === "string" ? spec : spec.name;
      let jobs = [];
      try {
        jobs = await SOURCES[platform](spec);
        log(`  ${platform}/${name}: ${jobs.length} open jobs`);
      } catch (err) {
        const hint = /404/.test(err.message) ? "board not found; check the name in search.json" : `could not reach it (${err.message})`;
        log(`  ${platform}/${name}: skipped, ${hint}`);
      }
      return jobs;
    }));
  return (await Promise.all(tasks)).flat();
}

// True if `phrase` appears in `text` as whole words ("intern" does not match "internal").
function hasPhrase(text, phrase) {
  const escaped = phrase.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text.toLowerCase());
}

// Returns the job type a title matches, or null if it matches none or is too senior.
function matchJobType(title, config) {
  const tooSenior = config.exclude_title_words.some((w) => hasPhrase(title, w));
  const type = Object.entries(config.job_types).find(([, words]) => words.some((w) => hasPhrase(title, w)));
  return !tooSenior && type ? type[0] : null;
}

function matchesLocation(location, config) {
  const countryCodeCanada = /(^|;\s*)CA(\s*;|$)/.test(location);
  return countryCodeCanada || config.location_must_match.some((w) => hasPhrase(location, w));
}

function filterJobs(jobs, config, history) {
  return jobs
    .map((j) => ({ ...j, jobType: matchJobType(j.title, config) }))
    .filter((j) => j.jobType && matchesLocation(j.location, config))
    .filter((j) => !history.has(jobKey(j)))
    // The same job can come back from two searches (two categories or keywords).
    .filter((j, i, all) => all.findIndex((o) => jobKey(o) === jobKey(j)) === i);
}

module.exports = { fetchAllJobs, filterJobs, matchJobType, matchesLocation, jobKey, greenhouseJobs, leverJobs, ashbyJobs };
