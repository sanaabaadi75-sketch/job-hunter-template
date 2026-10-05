// Turns a job posting URL into plain text the agent can read.
// Many career sites hide the real posting inside a Greenhouse or Lever
// widget, so we look for those first and use their public APIs.

const HEADERS = { "User-Agent": "Mozilla/5.0 (resume-agent)" };

function decodeEntities(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function htmlToText(html) {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n* ")
      .replace(/<[^>]+>/g, " ")
  );
  // Decode twice because Greenhouse double encodes its HTML.
  return decodeEntities(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

async function getText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  }
  return res.text();
}

// Finds a Greenhouse board and job id in a URL or page HTML.
function findGreenhouse(url, html) {
  const patterns = [
    /greenhouse\.io\/embed\/job_app\?for=([\w-]+)&(?:amp;)?token=(\d+)/,
    /(?:boards|job-boards)\.greenhouse\.io\/([\w-]+)\/jobs\/(\d+)/,
  ];
  const haystack = `${url}\n${html}`;
  const match = patterns.map((p) => haystack.match(p)).find(Boolean);
  return match ? { board: match[1], id: match[2] } : null;
}

function findLever(url) {
  const match = url.match(/jobs\.lever\.co\/([\w-]+)\/([\w-]{36})/);
  return match ? { company: match[1], id: match[2] } : null;
}

async function fetchGreenhouse({ board, id }) {
  const data = JSON.parse(
    await getText(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`)
  );
  return [
    `Title: ${data.title}`,
    `Company: ${board}`,
    `Location: ${data.location?.name ?? "not listed"}`,
    "",
    htmlToText(data.content ?? ""),
  ].join("\n");
}

async function fetchLever({ company, id }) {
  const data = JSON.parse(
    await getText(`https://api.lever.co/v0/postings/${company}/${id}`)
  );
  const lists = (data.lists ?? [])
    .map((l) => `${l.text}\n${htmlToText(l.content)}`)
    .join("\n\n");
  return [
    `Title: ${data.text}`,
    `Company: ${company}`,
    `Location: ${data.categories?.location ?? "not listed"}`,
    "",
    data.descriptionPlain ?? "",
    lists,
    data.additionalPlain ?? "",
  ].join("\n");
}

async function fetchJobPosting(url) {
  const lever = findLever(url);
  const directGreenhouse = findGreenhouse(url, "");
  let text;
  if (lever) {
    text = await fetchLever(lever);
  } else if (directGreenhouse) {
    text = await fetchGreenhouse(directGreenhouse);
  } else {
    const html = await getText(url);
    const embedded = findGreenhouse(url, html);
    text = embedded ? await fetchGreenhouse(embedded) : htmlToText(html);
  }
  // Very long pages are mostly menus and footers; keep the useful part.
  return text.slice(0, 20000);
}

module.exports = { fetchJobPosting, htmlToText, findGreenhouse, findLever };
