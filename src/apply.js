// Opens a job application form in a real browser, reads every field,
// gets answers from your profile, fills the form, submits it, and checks
// that the submission really went through.
//
// It never guesses. If a required question can't be answered from your
// profile, or the site shows a CAPTCHA or asks for an email code, the job
// is marked "needs_you" and left for you to finish.

const fs = require("fs");
const path = require("path");

const SUCCESS_TEXT = /thank you for (applying|your application|your interest)|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully submitted/i;
const BLOCKED_TEXT = /security code|verification code|enter the code|captcha|are you a robot|verify (that )?you are (a )?human/i;
const SUCCESS_URL = /confirmation|thank|success|submitted|\/thanks/i;

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          values: { type: "array", items: { type: "string" } },
        },
        required: ["key", "values"],
      },
    },
    unanswerable: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, reason: { type: "string" } },
        required: ["key", "reason"],
      },
    },
  },
  required: ["answers", "unanswerable"],
};

// Runs inside the web page. Finds every form field, tags it with a key,
// and describes it: label, kind, required, and options.
/* eslint-disable no-undef */
function scanPage() {
  const clean = (t) => (t || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && (r.width > 0 || r.height > 0);
  };
  const labelOf = (el) => {
    let text = el.getAttribute("aria-label") || "";
    const labelledBy = el.getAttribute("aria-labelledby");
    if (!text && labelledBy) {
      text = labelledBy.split(" ").map((id) => document.getElementById(id)?.innerText || "").join(" ");
    }
    if (!text && el.id) {
      text = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || "";
    }
    if (!text) text = el.closest("label")?.innerText || "";
    if (!text) {
      const box = el.closest("fieldset, .field, .application-question, [class*='field'], [class*='question']");
      text = box?.querySelector("legend, label, .application-label, [class*='label']")?.innerText || "";
    }
    return clean(text || el.placeholder || el.name || el.id);
  };
  const groupLabelOf = (el) => {
    const box = el.closest("fieldset, [role='group'], [role='radiogroup'], .application-question, [class*='question'], [class*='field']");
    const legend = box?.querySelector("legend, .application-label, [class*='label'], label");
    return clean(legend?.innerText || el.name);
  };
  const markedRequired = (el, label) =>
    el.required || el.getAttribute("aria-required") === "true" ||
    /\*/.test(document.querySelector(`label[for="${CSS.escape(el.id || "_")}"]`)?.innerText || "") ||
    /\*/.test(el.closest("fieldset, .field, [class*='question']")?.querySelector("legend, label")?.innerText || "") ||
    // Ashby marks required questions with a "_required_" class on the question title instead of an asterisk.
    !!el.closest("fieldset, .field, [class*='question']")?.querySelector("legend[class*='required'], label[class*='required']") ||
    /\(required\)/i.test(label);

  const fields = [];
  const groups = {};
  const controls = Array.from(document.querySelectorAll("input, select, textarea"))
    .filter((el) => !["hidden", "submit", "button", "reset", "image", "search"].includes(el.type))
    .filter((el) => el.type === "file" || isVisible(el));

  // Checkboxes belong together if they share a name, or (as on Ashby, where each
  // box is named after its option) if they sit in the same fieldset.
  const fieldsetIds = new Map();
  const checkboxGroupOf = (el) => {
    if (el.name && document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`).length > 1) return el.name;
    const fieldset = el.closest("fieldset");
    if (fieldset && fieldset.querySelectorAll("input[type=checkbox]").length > 1) {
      if (!fieldsetIds.has(fieldset)) fieldsetIds.set(fieldset, `fieldset${fieldsetIds.size}`);
      return fieldsetIds.get(fieldset);
    }
    return null;
  };

  controls.forEach((el, i) => {
    const key = `f${i}`;
    const checkboxGroup = el.type === "checkbox" ? checkboxGroupOf(el) : null;
    if (el.type === "radio" || checkboxGroup) {
      const groupKey = `g_${checkboxGroup || el.name}`;
      if (!groups[groupKey]) {
        groups[groupKey] = { key: groupKey, kind: el.type === "radio" ? "radio" : "checkbox_group", label: groupLabelOf(el), required: false, options: [] };
        fields.push(groups[groupKey]);
      }
      const group = groups[groupKey];
      el.setAttribute("data-agent-key", groupKey);
      el.setAttribute("data-agent-opt", String(group.options.length));
      group.options.push(labelOf(el));
      group.required = group.required || markedRequired(el, group.label);
    } else {
      el.setAttribute("data-agent-key", key);
      const label = labelOf(el);
      let kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.type;
      if (el.getAttribute("role") === "combobox") kind = "combobox";
      if (!["select", "textarea", "combobox", "checkbox", "file"].includes(kind)) kind = "text";
      fields.push({
        key,
        kind,
        label,
        required: markedRequired(el, label),
        options: el.tagName === "SELECT" ? Array.from(el.options).map((o) => clean(o.text)).filter((t) => t && !/^select/i.test(t)) : [],
      });
    }
  });
  return fields;
}
/* eslint-enable no-undef */

const keyLocator = (page, key) => page.locator(`[data-agent-key="${key}"]`);

// The toggle (arrow) button that sits next to some combobox inputs, like on Ashby.
const comboboxToggle = (loc) => loc.locator("xpath=..").locator("button").first();

const visibleOptions = async (page) =>
  (await page.getByRole("option").allInnerTexts())
    .map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 250);

// Comboboxes (custom dropdowns) only show options when opened, so open each one to read them.
// Some (Ashby) stay empty when the input is clicked and only list options from their toggle button.
async function readComboboxOptions(page, fields) {
  for (const field of fields.filter((f) => f.kind === "combobox")) {
    try {
      const loc = keyLocator(page, field.key).first();
      await loc.click({ timeout: 3000 });
      await page.waitForTimeout(400);
      field.options = await visibleOptions(page);
      if (!field.options.length && await comboboxToggle(loc).count()) {
        await comboboxToggle(loc).click({ timeout: 3000 });
        await page.waitForTimeout(400);
        field.options = await visibleOptions(page);
      }
      await page.keyboard.press("Escape");
    } catch {
      field.options = [];
    }
  }
  return fields;
}

// Ticks a radio button or checkbox. Many sites hide the real input behind a styled
// one, and checking the hidden input doesn't always register, so click its label.
async function tick(page, loc) {
  const id = await loc.getAttribute("id");
  const label = id ? page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first() : null;
  if (label && await label.count()) await label.click({ timeout: 3000 }).catch(() => {});
  if (!(await loc.isChecked().catch(() => false))) await loc.check({ force: true });
}

function answerPrompt(profile, jobInfo, fields) {
  const facts = { ...profile };
  delete facts._readme;
  delete facts.unverified;
  return [
    {
      role: "system",
      content: `You fill in job application forms for ${profile.name}, using ONLY the facts below. You answer with JSON.

Rules:
* Use application_answers first, word for word where it fits, then the rest of the profile.
* If a question needs a fact that is null, missing, or not in the facts, do NOT guess: if the field is required, list it in unanswerable with a short reason; if it is optional, leave it out.
* Never answer yes to an eligibility, legal, or authorization question unless application_answers says so.
* For fields with options, every value must be copied exactly from that field's options. For checkbox groups you may give several values.
* For a single checkbox (kind "checkbox"), answer "yes" to tick it or leave it out.
* Voluntary demographic or self-identification questions: choose the option meaning decline or prefer not to say. If there is none and the field is required, list it in unanswerable.
* Short written questions (like "Why do you want to work here?"): write two to four honest sentences from the profile and the job. No dashes as punctuation, no invented facts.
* Skip file upload fields; they are handled separately.

Facts:
${JSON.stringify(facts, null, 2)}`,
    },
    {
      role: "user",
      content: `Job: ${jobInfo.title} at ${jobInfo.company}

Form fields:
${JSON.stringify(fields.filter((f) => f.kind !== "file"), null, 2)}`,
    },
  ];
}

const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Checks the model's answers against the form. Returns answers keyed by field and a list of problems.
function checkAnswers(fields, reply) {
  const byKey = Object.fromEntries((reply.answers ?? []).map((a) => [a.key, a.values]));
  const problems = (reply.unanswerable ?? [])
    .filter((u) => fields.find((f) => f.key === u.key)?.required)
    .map((u) => `"${fields.find((f) => f.key === u.key).label}": ${u.reason}`);
  for (const field of fields) {
    const values = (byKey[field.key] ?? []).filter((v) => v && v.trim());
    const hasOptions = ["select", "radio", "checkbox_group"].includes(field.kind) ||
      (field.kind === "combobox" && field.options.length > 0);
    const badOption = hasOptions && values.find((v) => !field.options.some((o) => sameText(o, v)));
    if (badOption) {
      problems.push(`"${field.label}": answer "${badOption}" is not one of the choices`);
      delete byKey[field.key];
    } else if (field.required && field.kind !== "file" && !values.length && !problems.some((p) => p.startsWith(`"${field.label}"`))) {
      problems.push(`"${field.label}": required, but no answer could be found in your profile`);
    }
  }
  return { byKey, problems };
}

function pickFile(field, files) {
  const label = field.label.toLowerCase();
  let file = null;
  if (/cover/.test(label)) file = files.coverLetter;
  else if (/resume|cv/.test(label)) file = files.resume;
  return file;
}

async function fillField(page, field, values) {
  const loc = keyLocator(page, field.key);
  if (field.kind === "text" || field.kind === "textarea") {
    await loc.fill(values[0]);
    // Location boxes often want you to pick a suggestion from a list.
    if (/location|city/i.test(field.label)) {
      const suggestion = page.getByRole("option").filter({ hasText: values[0].split(",")[0] }).first();
      await suggestion.click({ timeout: 2500 }).catch(() => {});
    }
  } else if (field.kind === "select") {
    const option = field.options.find((o) => sameText(o, values[0]));
    await loc.selectOption({ label: option });
  } else if (field.kind === "combobox") {
    for (const value of values) {
      await loc.click();
      await loc.pressSequentially(value, { delay: 15 });
      const option = page.getByRole("option", { name: value, exact: true }).first();
      let picked = await option.click({ timeout: 3000 }).then(() => true).catch(() => false);
      if (!picked && await comboboxToggle(loc).count()) {
        // Typing didn't bring it up; open the full list from the toggle button and pick from there.
        await loc.fill("");
        await comboboxToggle(loc).click({ timeout: 3000 }).catch(() => {});
        picked = await option.click({ timeout: 3000 }).then(() => true).catch(() => false);
      }
      if (!picked) await page.keyboard.press("Enter");
    }
  } else if (field.kind === "radio" || field.kind === "checkbox_group") {
    for (const value of values) {
      const index = field.options.findIndex((o) => sameText(o, value));
      await tick(page, page.locator(`[data-agent-key="${field.key}"][data-agent-opt="${index}"]`));
    }
  } else if (field.kind === "checkbox" && /^(yes|true)$/i.test(values[0])) {
    await tick(page, loc);
  }
}

// Watches the page after clicking submit and decides what happened.
async function waitForOutcome(page, timeoutMs = 25000) {
  const start = Date.now();
  let outcome = null;
  while (!outcome && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1000);
    const text = await page.locator("body").innerText().catch(() => "");
    const challenge = await page.locator("iframe[src*='hcaptcha'][src*='challenge'], iframe[title*='challenge']").first().isVisible().catch(() => false);
    if (SUCCESS_URL.test(page.url()) || SUCCESS_TEXT.test(text)) {
      outcome = { status: "submitted", reason: "The site confirmed the application was received." };
    } else if (challenge || BLOCKED_TEXT.test(text)) {
      outcome = { status: "needs_you", reason: "The site asked for a CAPTCHA or an emailed security code. Open the link and finish it yourself." };
    }
  }
  if (!outcome) {
    const errors = await page.locator("[class*='error']:visible, [role='alert']:visible").allInnerTexts().catch(() => []);
    outcome = {
      status: "needs_you",
      reason: errors.length
        ? `The form showed errors after submitting: ${[...new Set(errors.map((e) => e.trim()).filter(Boolean))].slice(0, 5).join("; ")}`
        : "No confirmation appeared after submitting, so it may not have gone through. Please check the link.",
    };
  }
  return outcome;
}

async function launchBrowser(show) {
  const { chromium } = require("playwright");
  const options = { headless: !show };
  let browser;
  if (process.env.BROWSER_PATH) {
    browser = await chromium.launch({ ...options, executablePath: process.env.BROWSER_PATH });
  } else {
    // Prefer the Chrome you already have; fall back to Playwright's own browser.
    browser = await chromium.launch({ ...options, channel: "chrome" }).catch(() => chromium.launch(options));
  }
  return browser;
}

// Applies to one job. Returns { status, reason, screenshots }.
async function applyToJob({ browser, job, files, profile, chat, dryRun, folder, log = console.log }) {
  const page = await browser.newPage({ locale: "en-CA", viewport: { width: 1280, height: 1600 } });
  const shot = (name) => path.join(folder, name);
  let result;
  try {
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("input, textarea", { timeout: 20000 });
    await page.waitForTimeout(1500);
    const fields = await readComboboxOptions(page, await page.evaluate(scanPage));
    log(`    Form has ${fields.length} fields (${fields.filter((f) => f.required).length} required)`);
    const fileFields = fields.filter((f) => f.kind === "file");
    const missingFile = fileFields.find((f) => f.required && !pickFile(f, files));
    const reply = JSON.parse(await chat(answerPrompt(profile, job, fields), ANSWER_SCHEMA));
    const { byKey, problems } = checkAnswers(fields, reply);
    if (missingFile) problems.push(`"${missingFile.label}": required upload the agent doesn't have`);
    fs.writeFileSync(path.join(folder, "form_answers.json"), JSON.stringify({ fields, answers: byKey, problems }, null, 2));

    if (problems.length) {
      result = { status: "needs_you", reason: `Questions it could not answer from your profile: ${problems.join("; ")}` };
    } else {
      // Upload files first: some sites read the resume and overwrite fields.
      for (const field of fileFields) {
        const file = pickFile(field, files);
        if (file) await keyLocator(page, field.key).setInputFiles(file);
      }
      await page.waitForTimeout(2500);
      for (const field of fields.filter((f) => f.kind !== "file" && byKey[f.key]?.length)) {
        await fillField(page, field, byKey[field.key]);
      }
      await page.screenshot({ path: shot("form_filled.png"), fullPage: true });
      const submit = page.locator("button[type=submit], input[type=submit], button:has-text('Submit')").last();
      if (dryRun) {
        result = { status: "dry_run", reason: "Form filled but not submitted (dry run). See form_filled.png." };
      } else {
        await submit.click();
        result = await waitForOutcome(page);
        await page.screenshot({ path: shot("after_submit.png"), fullPage: true });
        fs.writeFileSync(shot("after_submit.txt"), await page.locator("body").innerText().catch(() => ""));
      }
    }
  } catch (err) {
    await page.screenshot({ path: shot("error.png"), fullPage: true }).catch(() => {});
    result = { status: "needs_you", reason: `Something went wrong on the form: ${err.message.split("\n")[0]}` };
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

module.exports = { applyToJob, launchBrowser, scanPage, checkAnswers, ANSWER_SCHEMA };
