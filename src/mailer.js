// Sends email applications from your Gmail, with the resume and cover letter
// attached. Needs a Gmail app password in .env (see README):
//   GMAIL_USER=you@gmail.com
//   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
// Sent emails show up in your Gmail "Sent" folder like any other email.

const fs = require("fs");
const path = require("path");

const mailConfigured = () => Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

let transport = null;
function getTransport() {
  if (!transport) {
    const nodemailer = require("nodemailer");
    transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
    });
  }
  return transport;
}

// Checks the login without sending anything. Returns an error message, or null if it works.
async function checkMail() {
  try {
    await getTransport().verify();
    return null;
  } catch (err) {
    return /535|Username and Password not accepted/i.test(err.message)
      ? "Gmail did not accept the app password. Check GMAIL_USER and GMAIL_APP_PASSWORD in .env."
      : `Could not connect to Gmail: ${err.message}`;
  }
}

// `draft` is the content of an email_draft.json file (see jobbank.js).
async function sendApplication(draft) {
  const info = await getTransport().sendMail({
    from: process.env.GMAIL_USER,
    to: draft.to,
    subject: draft.subject,
    text: draft.body,
    attachments: draft.attachments.map((file) => ({ filename: path.basename(file), content: fs.readFileSync(file) })),
  });
  return info.messageId;
}

// Remembers every address already emailed, so one employer never gets two
// near identical applications (many post the same job more than once).
const SENT_LOG = path.join(__dirname, "..", "data", "sent_emails.json");
const readSent = () => (fs.existsSync(SENT_LOG) ? JSON.parse(fs.readFileSync(SENT_LOG, "utf8")) : {});
const alreadyEmailed = (to) => readSent()[to.toLowerCase()];
function recordSent(to, job) {
  const sent = readSent();
  sent[to.toLowerCase()] = { title: job.title, company: job.company, url: job.url, sent: new Date().toISOString() };
  fs.mkdirSync(path.dirname(SENT_LOG), { recursive: true });
  fs.writeFileSync(SENT_LOG, JSON.stringify(sent, null, 2));
}

module.exports = { mailConfigured, checkMail, sendApplication, alreadyEmailed, recordSent };
