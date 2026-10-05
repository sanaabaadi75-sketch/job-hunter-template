// Builds the Word (.docx) files from the agent's structured output.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat,
  BorderStyle, TabStopType,
} = require("docx");

const FONT = "Calibri";
const ACCENT = "1F3864"; // dark navy for the name and headings
const TEXT = "262626"; // near black body text, softer than pure black
const MUTED = "595959"; // grey for contact details, organizations and dates
const RIGHT_TAB = 10080;
const PAGE_SIZE = { width: 12240, height: 15840 }; // US Letter, used in Canada

const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: 20, color: TEXT, ...opts });

// "https://www.linkedin.com/in/alex-example/" reads better as "linkedin.com/in/alex-example".
const shortLink = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// The model sometimes ends the letter with its own "Sincerely, Name"; the letter adds one itself.
function letterParagraphs(paragraphs, name) {
  const signOff = new RegExp(`^((sincerely|best regards|kind regards|regards),?\\s*)?(${name})?$`, "i");
  return (paragraphs ?? [])
    .map((p) => p.replace(/\n*(Sincerely|Best regards|Kind regards|Regards),?\s*(\n.*)?$/i, "").trim())
    .filter((p) => p && !signOff.test(p));
}

function header(profile) {
  const c = profile.contact;
  const contactLine = [c.location, c.phone, c.email, ...(c.links ?? []).map(shortLink)]
    .filter(Boolean)
    .join("   •   ");
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [run(profile.name.toUpperCase(), { bold: true, size: 44, color: ACCENT, characterSpacing: 40 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
      children: [run(contactLine, { size: 19, color: MUTED })],
    }),
  ];
}

const heading = (text) => new Paragraph({
  spacing: { before: 170, after: 70 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 2 } },
  children: [run(text.toUpperCase(), { bold: true, size: 21, color: ACCENT, characterSpacing: 30 })],
});

const entryLine = (entry) => new Paragraph({
  tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
  spacing: { before: 90, after: 20 },
  children: [
    run(entry.title, { bold: true, size: 21 }),
    run(entry.subtitle ? `   ·   ${entry.subtitle}` : "", { italics: true, color: MUTED }),
    run(entry.date ? `\t${entry.date}` : "", { color: MUTED, size: 19 }),
  ],
});

const bullet = (text) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  spacing: { after: 20, line: 247 },
  children: [run(text)],
});

const entryBlock = (entry) => [entryLine(entry), ...(entry.bullets ?? []).map(bullet)];

function sectionBlock(section) {
  const body = section.entries?.length
    ? section.entries.flatMap(entryBlock)
    : (section.lines ?? []).map((line) => new Paragraph({ spacing: { after: 20 }, children: [run(line)] }));
  return [heading(section.heading), ...body];
}

function buildResume(profile, resume) {
  const skills = (resume.skills ?? []).map((s) => new Paragraph({
    spacing: { after: 30, line: 247 },
    children: [run(`${s.label}: `, { bold: true }), run(s.value)],
  }));
  const children = [
    ...header(profile),
    heading("Summary"),
    new Paragraph({ spacing: { after: 40, line: 252 }, children: [run(resume.summary)] }),
    heading("Skills"),
    ...skills,
    ...(resume.sections ?? []).flatMap(sectionBlock),
  ];
  return new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 220 } }, run: { color: ACCENT } },
        }],
      }],
    },
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: { top: 600, bottom: 600, left: 1008, right: 1008 } } },
      children,
    }],
  });
}

function buildCoverLetter(profile, letter, dateText) {
  const para = (text, opts = {}) => new Paragraph({
    spacing: { after: opts.after ?? 200, line: 288 },
    children: [run(text, { size: 22, bold: opts.bold, color: opts.bold ? ACCENT : TEXT })],
  });
  const recipient = (letter.recipient_lines ?? []).map((line, i, all) =>
    para(line, { after: i === all.length - 1 ? 200 : 0 }));
  const children = [
    ...header(profile),
    para(dateText),
    ...recipient,
    para(letter.subject, { bold: true }),
    para(letter.greeting || "Dear Hiring Team,"),
    ...letterParagraphs(letter.paragraphs, profile.name).map((p) => para(p)),
    para("Sincerely,", { after: 120 }),
    para(profile.name, { after: 0, bold: true }),
  ];
  return new Document({
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: { top: 1080, bottom: 1080, left: 1260, right: 1260 } } },
      children,
    }],
  });
}

function fitReport(application, jobSource) {
  const fit = application.fit_assessment;
  const list = (items) => (items ?? []).map((i) => `* ${i}`).join("\n");
  return [
    `# Fit check: ${application.job_title} at ${application.company}`,
    "",
    `Source: ${jobSource}`,
    `Verdict: ${fit.verdict.toUpperCase()}`,
    "",
    fit.reasoning,
    "",
    "## Requirements you clearly meet",
    list(fit.matched),
    "",
    "## Gaps",
    list(fit.gaps),
    "",
    "## What would raise your chances",
    list(fit.suggestions),
    "",
  ].join("\n");
}

const slug = (text) => text.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");

async function saveApplication(profile, application, outRoot, jobSource) {
  const folder = path.join(outRoot, slug(`${application.company}_${application.job_title}`));
  fs.mkdirSync(folder, { recursive: true });
  const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const base = slug(profile.name);
  const files = {
    resume: path.join(folder, `${base}_Resume.docx`),
    coverLetter: path.join(folder, `${base}_Cover_Letter.docx`),
    fit: path.join(folder, "fit_check.md"),
    raw: path.join(folder, "application.json"),
  };
  fs.writeFileSync(files.resume, await Packer.toBuffer(buildResume(profile, application.resume)));
  fs.writeFileSync(files.coverLetter, await Packer.toBuffer(buildCoverLetter(profile, application.cover_letter, today)));
  fs.writeFileSync(files.fit, fitReport(application, jobSource));
  fs.writeFileSync(files.raw, JSON.stringify(application, null, 2));
  return files;
}

module.exports = { saveApplication, buildResume, buildCoverLetter, letterParagraphs };
