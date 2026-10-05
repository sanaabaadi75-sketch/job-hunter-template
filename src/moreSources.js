// More places to find jobs, beyond the company boards and Job Bank:
//
// Kingston employers with their own career sites. Applying there needs your
// own account, so the hunter never applies: it tailors your documents and lists
// the job under "Needs you" with the link.
//   njoyn           Queen's University and the City of Kingston (RSS feeds)
//   successfactors  Kingston Health Sciences Centre
//   slc             St. Lawrence College
//
// Remote job sites. The hunter applies when the posting links to a Greenhouse,
// Lever or Ashby form it can fill in; otherwise the job goes under "Needs you".
//   remotive        remotive.com (categories, e.g. "data", "software-dev")
//   himalayas       himalayas.app (keyword searches limited to jobs open to Canada)

const { htmlToText } = require("./fetchJob");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

const decode = (s) => htmlToText(s || "").replace(/\s+/g, " ").trim();
const cdata = (s) => (s || "").replace(/^<!\[CDATA\[|\]\]>$/g, "");
const tag = (xml, name) => cdata(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");

const job = (fields) => ({ description: "", ...fields, id: String(fields.id), title: fields.title.trim() });

// spec: { name, feed } where feed is the njoyn RSS URL.
async function njoynJobs(spec) {
  const xml = await get(spec.feed);
  return xml.split(/<item[ >]/).slice(1).map((item) => {
    const link = decode(tag(item, "link")).replace(/&amp;/g, "&");
    const id = link.match(/JOBID=([^&]+)/i)?.[1] ?? link;
    const city = item.match(/CY="([^"]*)"/)?.[1] || "Kingston";
    return job({
      platform: "njoyn",
      company: spec.name,
      id,
      title: decode(tag(item, "title")).replace(/^J\d{4}-\d{4}\s*-\s*/, ""),
      location: `${city}, ON`,
      url: link,
      applyUrl: link,
    });
  });
}

// spec: { name, company, host } for a SuccessFactors career site.
async function successfactorsJobs(spec) {
  const host = spec.host || "career5.successfactors.eu";
  const xml = await get(`https://${host}/career?company=${spec.company}&career_ns=job_listing_summary&resultType=XML`);
  return xml.split("<Job>").slice(1).map((item) => {
    const id = decode(tag(item, "ReqId"));
    const url = `https://${host}/career?company=${spec.company}&career_ns=job_listing&career_job_req_id=${id}`;
    return job({
      platform: "successfactors",
      company: spec.name,
      id,
      title: decode(tag(item, "JobTitle")),
      location: "Kingston, ON",
      url,
      applyUrl: url,
      // Drop embedded images (some descriptions carry large base64 logos).
      description: htmlToText(tag(item, "Job-Description").replace(/<img[^>]*>/gi, "")).slice(0, 15000),
    });
  });
}

// spec: { name, page } where page lists the college's current postings.
async function slcJobs(spec) {
  const html = await get(spec.page);
  const base = new URL(spec.page).origin;
  const seen = new Set();
  return [...html.matchAll(/href="(\/jobs\/[^"]+)"[^>]*title="([^"]+)"/g)]
    .filter(([, href]) => !seen.has(href) && seen.add(href))
    .map(([, href, title]) => job({
      platform: "slc",
      company: spec.name,
      id: href.split("/").pop(),
      title: decode(title),
      location: "Kingston, ON",
      url: base + href,
      applyUrl: base + href,
    }));
}

// Where a remote job must be open to someone living in Canada.
const OPEN_TO_CANADA = /canada|worldwide|anywhere|north america|americas|global/i;

// spec: a Remotive category, e.g. "data" or "software-dev".
async function remotiveJobs(category) {
  const data = await get(`https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}`, "json");
  return (data.jobs ?? [])
    .filter((j) => !j.candidate_required_location || OPEN_TO_CANADA.test(j.candidate_required_location))
    .map((j) => job({
      platform: "remotive",
      company: j.company_name,
      id: j.id,
      title: j.title,
      location: `Remote (Canada); ${j.candidate_required_location || "Worldwide"}`,
      url: j.url,
      applyUrl: j.url,
      description: htmlToText(j.description || ""),
    }));
}

// spec: a search phrase, e.g. "junior developer". Only entry level jobs open to Canada.
async function himalayasJobs(query) {
  const data = await get(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(query)}&country=Canada`, "json");
  return (data.jobs ?? [])
    .filter((j) => !j.locationRestrictions?.length || j.locationRestrictions.some((l) => /canada/i.test(l)))
    .filter((j) => !j.seniority?.length || j.seniority.some((s) => /entry|intern|junior/i.test(s)))
    .map((j) => job({
      platform: "himalayas",
      company: j.companyName,
      id: j.guid || j.applicationLink,
      title: j.title,
      location: `Remote (Canada); ${(j.locationRestrictions ?? []).join(", ") || "Worldwide"}`,
      url: j.applicationLink,
      applyUrl: j.applicationLink,
      description: htmlToText(j.description || ""),
    }));
}

// Jobs from these sources are never applied to by the hunter (your own account is needed).
const ACCOUNT_SITES = new Set(["njoyn", "successfactors", "slc"]);
const REMOTE_SITES = new Set(["remotive", "himalayas"]);

// Looks for a Greenhouse, Lever or Ashby form linked from a remote posting,
// and returns the form's address, or null.
function formLinkIn(text) {
  const gh = text.match(/https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([\w-]+)\/jobs\/(\d+)/i);
  if (gh) return `https://job-boards.greenhouse.io/embed/job_app?for=${gh[1]}&token=${gh[2]}`;
  const lever = text.match(/https?:\/\/jobs\.lever\.co\/([\w.-]+)\/([0-9a-f-]{36})/i);
  if (lever) return `https://jobs.lever.co/${lever[1]}/${lever[2]}/apply`;
  const ashby = text.match(/https?:\/\/jobs\.ashbyhq\.com\/([\w.-]+)\/([0-9a-f-]{36})/i);
  if (ashby) return `https://jobs.ashbyhq.com/${ashby[1]}/${ashby[2]}/application`;
  return null;
}

// Search results from njoyn and SLC have no description, so download the posting.
async function pageText(url) {
  return htmlToText(await get(url)).slice(0, 15000);
}

module.exports = {
  njoynJobs, successfactorsJobs, slcJobs, remotiveJobs, himalayasJobs,
  ACCOUNT_SITES, REMOTE_SITES, formLinkIn, pageText,
};
