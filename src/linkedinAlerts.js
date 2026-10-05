// Uses your LinkedIn job alert emails as leads, without touching LinkedIn.
//
// Each run reads the last few days of alert emails from your Gmail (read only,
// with the same app password used for sending). For every job in them it checks
// whether the company posts the same job on its own Greenhouse, Lever or Ashby
// board. If it does, that posting joins the normal hunt and is applied to there.
// If not, the lead is skipped (and costs no Claude requests).
//
// search.json: "linkedin_alerts": [{ "name": "LinkedIn alerts", "days": 3 }]

const fs = require("fs");
const path = require("path");

const SENDERS = ["jobalerts-noreply@linkedin.com", "jobs-noreply@linkedin.com", "jobs-listings@linkedin.com"];
const CACHE = path.join(__dirname, "..", "data", "linkedin_boards.json");
const CACHE_DAYS = 14; // re-check companies with no board after this long

// Pulls { title, company, location, linkedinId } out of one alert email's text.
function parseAlert(text) {
  return text.split(/\n-{20,}\n/).map((block) => {
    const id = block.match(/linkedin\.com\/comm\/jobs\/view\/(\d+)/)?.[1];
    if (!id) return null;
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const start = lines.findIndex((l) => !/^(Your job alert|Manage your job alerts|Jobs similar|New jobs)/i.test(l) && !/^https?:/.test(l));
    const [title, company, location] = lines.slice(start);
    return title && company && !/^View job/.test(company) ? { title, company, location: location ?? "", linkedinId: id } : null;
  }).filter(Boolean);
}

// Reads alert emails from the last `days` days. Returns leads, newest first, no repeats.
async function readAlerts(days) {
  const { ImapFlow } = require("imapflow");
  const { simpleParser } = require("mailparser");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
    logger: false,
  });
  await client.connect();
  const leads = [];
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const since = new Date(Date.now() - days * 86400000);
    for (const from of SENDERS) {
      const uids = await client.search({ from, since }, { uid: true });
      if (!uids.length) continue;
      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        const mail = await simpleParser(msg.source);
        leads.push(...parseAlert(mail.text || ""));
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  const seen = new Set();
  return leads.reverse().filter((l) => !seen.has(l.linkedinId) && seen.add(l.linkedinId));
}

// Board names to try for a company: "Jane App" -> janeapp, jane-app, jane.
function boardNames(company) {
  const clean = company.toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(inc|incorporated|ltd|limited|llc|corp|corporation|co|technologies|technology|computing|canada)\b\.?/g, "")
    .replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return [...new Set([clean.join(""), clean.join("-"), clean[0]].filter((n) => n && n.length > 1))];
}

const normalize = (t) => t.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// True when two titles name the same job ("Junior Software Engineer (Remote)" vs "Junior Software Engineer").
const sameTitle = (a, b) => {
  const x = normalize(a);
  const y = normalize(b);
  return x === y || (x.length > 8 && y.length > 8 && (x.includes(y) || y.includes(x)));
};

function loadCache() {
  return fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
}

// Finds the company's board, using and updating the cache. Returns { platform, name } or null.
async function findBoard(company, cache, fetchers) {
  const key = company.toLowerCase();
  const hit = cache[key];
  if (hit && (hit.platform || Date.now() - Date.parse(hit.checked) < CACHE_DAYS * 86400000)) {
    return hit.platform ? hit : null;
  }
  for (const name of boardNames(company)) {
    for (const [platform, fetchJobs] of Object.entries(fetchers)) {
      const jobs = await fetchJobs(name).catch(() => null);
      if (jobs) {
        cache[key] = { platform, name, checked: new Date().toISOString() };
        return cache[key];
      }
    }
  }
  cache[key] = { platform: null, checked: new Date().toISOString() };
  return null;
}

// The search source: spec is { name, days }.
async function linkedinAlertJobs(spec) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Gmail is not set up (GMAIL_USER and GMAIL_APP_PASSWORD), so alert emails can't be read");
  }
  const { greenhouseJobs, leverJobs, ashbyJobs } = require("./search");
  const fetchers = { greenhouse: greenhouseJobs, lever: leverJobs, ashby: ashbyJobs };
  const leads = await readAlerts(spec.days ?? 3);
  const cache = loadCache();
  const boards = {};
  const found = [];
  for (const lead of leads) {
    const board = await findBoard(lead.company, cache, fetchers);
    if (!board) continue;
    const id = `${board.platform}/${board.name}`;
    boards[id] ??= await fetchers[board.platform](board.name).catch(() => []);
    const match = boards[id].find((j) => sameTitle(j.title, lead.title));
    if (match) found.push({ ...match, fromLinkedIn: lead.linkedinId });
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  console.log(`  LinkedIn alerts: ${leads.length} jobs in your alert emails, ${found.length} found on the employer's own board`);
  return found;
}

module.exports = { linkedinAlertJobs, parseAlert, boardNames, sameTitle };
