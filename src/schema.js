// The exact shape every draft must have. Both backends force the model to follow it.

const entrySchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    date: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
  },
  required: ["title", "subtitle", "date", "bullets"],
};

// Ollama forces the model's answer to match this shape exactly.
const APPLICATION_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string" },
    job_title: { type: "string" },
    resume: {
      type: "object",
      properties: {
        summary: { type: "string" },
        skills: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
            required: ["label", "value"],
          },
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              entries: { type: "array", items: entrySchema },
            },
            required: ["heading", "entries"],
          },
        },
      },
      required: ["summary", "skills", "sections"],
    },
    cover_letter: {
      type: "object",
      properties: {
        recipient_lines: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        greeting: { type: "string" },
        paragraphs: { type: "array", items: { type: "string" } },
      },
      required: ["recipient_lines", "subject", "greeting", "paragraphs"],
    },
    fit_assessment: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["strong match", "possible", "long shot"] },
        reasoning: { type: "string" },
        matched: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
        suggestions: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "reasoning", "matched", "gaps", "suggestions"],
    },
  },
  required: ["company", "job_title", "resume", "cover_letter", "fit_assessment"],
};

module.exports = { APPLICATION_SCHEMA };
