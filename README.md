# Job Agent

## Start here (classmates)

1. Click **Use this template > Create a new repository** at the top of this page. **Make your copy Private.** Each hunt saves which jobs you applied to back into `data/`, and your `profile.json` holds your contact details.
2. Clone your copy, then replace everything in `profile.json` with your own true details. It ships with a made-up person, "Alex Example". The agent only ever uses facts from this file, so nothing about you gets invented.
3. Edit `search.json` to set the job types, places and companies you care about.
4. Follow [Setup](#setup-one-time) below, then do a dry run of the [job hunter](#job-hunter) before letting it submit anything.
5. Optional: to run it on GitHub every 2 hours, add the secrets listed at the top of `.github/workflows/hunt.yml`. Then add a repository **variable** named `HUNT_ENABLED` set to `true`. Until you add that variable, only the manual **Run workflow** button works.

Want to improve the tool for everyone? Open an issue or a pull request on this template repo. Keep your own data out of pull requests.

Two tools in one project:

* **Job hunter** (`npm run hunt`): searches company job boards for roles that fit you. It tailors a resume and cover letter for each one and applies automatically when it can do so truthfully. [Jump to the job hunter](#job-hunter).
* **Resume tailor** (`npm start`): tailors a resume and cover letter for one job you choose.

## Resume tailor

An AI agent that tailors your resume and cover letter to a specific job posting. Give it a job link, or the job description pasted into a text file. It writes a one page resume and a cover letter as Word files, plus an honest fit check.

There are two ways to run the AI, and neither needs an API key:

* **Claude through your Pro plan (default).** Claude Code is included in Claude Pro. The agent runs it in the background using your Pro login, so there's no API key and no extra cost. Each application counts toward your normal Pro usage limits, the same as chatting. This gives the best writing.
* **A free local model through Ollama (backup).** It runs entirely on your laptop, so it works with no internet and no limits, but the writing is weaker.

## How it works

1. **Read the job.** The code downloads the posting. Many company career pages load the real job from Greenhouse or Lever behind the scenes, and the code knows how to grab those directly.
2. **Write a draft.** The AI model gets the posting and your `profile.json`, the master list of true facts about you. It writes the resume, cover letter and fit check.
3. **Check the draft.** The code reviews the draft and catches these problems:
   * skills that are not in your profile (made up)
   * numbers that are not in your profile, like an invented "40% faster"
   * dashes used as punctuation
   * too many bullets for one page
   * a cover letter that is too short
4. **Fix and repeat.** If the check finds problems, it sends the exact list back to the model and asks for a corrected draft. It repeats up to four times. This check and retry loop is what makes it an agent instead of a single prompt. The loop matters most with the local model, which makes more mistakes.
5. **Save.** You get a folder in `applications/` with these files:
   * the resume
   * the cover letter
   * `fit_check.md`
   * `application.json`, the raw content

## Setup (one time)

1. Install **Node.js** 20.12 or newer from https://nodejs.org.
2. In this folder, run:
   ```
   npm install
   ```
3. Open `profile.json` and check that everything is accurate:
   * **Add your current part time job.**
   * Add your GitHub or LinkedIn links under `contact.links`.
   * Add new projects as you finish them.

   The agent can only use what is in this file, so the better the profile, the better every application.
4. Set up at least one of the two AI options below.

### Option A: Claude with your Pro plan (recommended)

1. Install Claude Code. In Windows PowerShell, run:
   ```
   irm https://claude.ai/install.ps1 | iex
   ```
   On Mac or Linux, run `curl -fsSL https://claude.ai/install.sh | bash` instead.
2. Open a **new** terminal and run `claude`. It opens your browser. Sign in with your Pro account, then type `/exit` to close it. You only do this once.
3. Make sure you do **not** have an `ANTHROPIC_API_KEY` set in your terminal. If one is set, Claude Code uses that paid key instead of your Pro plan.

### Option B: Free local model

1. Install **Ollama** from https://ollama.com and open it.
2. Download the model, which is about 5 GB and only downloads once:
   ```
   ollama pull qwen3:8b
   ```

## Use it

With a job link:

```
npm start -- "https://www.instacart.careers/job?gh_jid=8249896"
```

If a site blocks the download (LinkedIn and Indeed often do), copy the job description into a text file in `jobs/` and run:

```
npm start -- --file jobs/my_job.txt
```

To use the free local model instead of Claude, add `--use ollama`:

```
npm start -- --use ollama --file jobs/my_job.txt
```

With Claude, a draft takes under a minute. With the local model, it takes one to two minutes. Always read the files before you send them.

## Choosing a model

**Claude:** the default is `sonnet`, which writes well and uses less of your Pro limits. For your most important applications, set `CLAUDE_MODEL=opus` in `.env` for the strongest writing. To create `.env`, copy `.env.example`.

**Ollama:** the default is `qwen3:8b`. Download another one with `ollama pull <name>`, then set `OLLAMA_MODEL` in `.env`.

| Model | Download size | When to use it |
| --- | --- | --- |
| `qwen3:4b` | about 2.5 GB | If 8b is too slow on your computer |
| `qwen3:8b` | about 5 GB | Default; good balance |
| `qwen3:14b` | about 9 GB | Better writing, but needs a strong computer |

## Job hunter

### What it does each run

1. **Searches** the company job boards listed in `search.json` (Greenhouse, Lever and Ashby, which many tech companies use). It keeps jobs that match your job types (data analyst, internships and co-ops, junior developer, part time or remote) in Canadian or remote-friendly locations. It drops senior, lead and manager roles, and skips anything it has already handled.
2. **Tailors** a resume and cover letter for each new match, using the resume tailor above.
3. **Checks the fit.** It only applies when the fit is "strong match" or "possible". Long shots are skipped and listed in the report.
4. **Applies.** It opens the real application form in a browser and reads every question. Claude answers each question using only `profile.json`. Then it uploads your documents, fills the form, presses Submit, and waits for the site to confirm the application went through.
5. **Writes a report** in `applications/` listing everything it submitted, skipped, or left for you.

### What it will never do

* **Guess.** If a required question needs a fact that isn't in your profile, like work authorization, salary or start date, it doesn't apply. The job goes in the "Needs you" list with the exact question.
* **Get past a CAPTCHA or an emailed security code.** Those jobs go to "Needs you" too.
* **Use LinkedIn or Indeed.** They ban automated applying and can lock your account.
* **Apply twice to the same job.** Everything it handles is remembered in `data/history.json`.
* **Process more than 5 jobs per run.** You can change this with `max_jobs_per_run` in `search.json`, but more jobs uses more of your Pro limits. Each job uses about two Claude requests.

### Setup

1. Finish the resume tailor setup above (Node.js, `npm install`, Claude Code signed in).
2. The hunter drives Google Chrome if you have it installed. If you don't, run `npx playwright install chromium` once.
3. **Fill in `application_answers` in `profile.json`.** This matters most. Anything left as `null` makes every job that asks that question go to "Needs you". The important ones:
   * `legally_authorized_to_work_in_canada`
   * `requires_visa_sponsorship_now_or_future`
   * `open_to_hybrid_or_in_office`
   * `earliest_start_date`
   * `salary_expectation`
   * `linkedin_url` and `github_url`

   Write the answers exactly as you would type them into a form, for example `"Yes"`.

### Run it

Start with a dry run. It does everything except press Submit, and saves a screenshot of each filled form (`form_filled.png` in each job's folder) so you can check them:

```
npm run hunt -- --dry-run --show
```

`--show` opens the browser window so you can watch. When you're happy with the result, run it for real:

```
npm run hunt
```

To just see which jobs match, without using Claude or applying:

```
npm run hunt -- --search-only
```

Each job gets its own folder in `applications/` with these files:

* the tailored resume and cover letter
* `fit_check.md`
* `form_answers.json` (every question and the answer it gave)
* screenshots before and after submitting
* `after_submit.txt` (the confirmation page text, as proof)

### Run it every day automatically (Windows)

1. Open **Task Scheduler** and click **Create Basic Task**. Name it "Job hunter" and choose **Daily** at a time your laptop is usually on.
2. For the action, choose **Start a program** with these settings:
   * **Program:** `cmd`
   * **Arguments:** `/c npm run hunt >> applications\hunt_log.txt 2>&1`
   * **Start in:** the full path of this folder (for example `C:\Users\you\job-agent`)
3. Check the newest `hunt_report_*.md` in `applications/` each day, and finish the "Needs you" jobs by hand.

### Where it looks

`search.json` lists every source under `companies`:

| Source | What it is | Applies automatically? |
| --- | --- | --- |
| `greenhouse`, `lever`, `ashby` | Tech company job boards | Yes, through their online form |
| `jobbank` | Job Bank: `22403` is Kingston and nearby towns, `remote` is remote jobs across Canada | Yes when the posting takes email applications; otherwise listed for you |
| `njoyn`, `successfactors`, `slc` | Queen's, City of Kingston, Kingston Health Sciences Centre, St. Lawrence College | No: these need your own account, so the job is listed with your documents ready |
| `remotive`, `himalayas` | Remote job sites | Only when the posting links to a Greenhouse, Lever or Ashby form; otherwise listed for you |

### Send email applications (Job Bank)

Many local Job Bank postings ask you to apply by email. The hunter writes the email for you (`email_draft.json` in the job's folder). To have it send them from your Gmail with the resume and cover letter attached:

1. Turn on 2-Step Verification for your Google account, if it isn't already on.
2. Go to https://myaccount.google.com/apppasswords, type a name like "Job hunter" and press Create. Google shows a 16-letter password.
3. Paste it after `GMAIL_APP_PASSWORD=` in the `.env` file in this folder, and save the file.

After that, every hunt emails new email postings automatically. To send the ones that are already waiting, run `npm run send-emails` (add `-- --list` to only see what it would send). Each employer address is only ever emailed once. Sent emails appear in your Gmail Sent folder. To stop it, delete the app password at the same link.

### Add more companies

Find the company's job board link and copy the name from it into `search.json` under the matching platform:

| If the careers link looks like | Add to | Name to add |
| --- | --- | --- |
| `boards.greenhouse.io/acme` or `job-boards.greenhouse.io/acme` | `greenhouse` | `acme` |
| `jobs.lever.co/acme` | `lever` | `acme` |
| `jobs.ashbyhq.com/acme` | `ashby` | `acme` |

If a company's own careers page has `gh_jid=` in its links, it uses Greenhouse. Run `npm run hunt -- --search-only` afterwards: a wrong name shows up as "board not found".

### Good to know

* **Ashby forms** use Yes/No buttons that the hunter can't click yet. Many Ashby jobs will land in "Needs you", but the documents are still ready in their folder.
* **Mass applying lowers quality.** The fit check and the cap of 5 per run keep the hunter focused on jobs you could actually get. Raise them slowly.
* **You are responsible for what is sent in your name.** Read your first few reports carefully, and check `form_answers.json` for any job you care about.

## Files

| File | What it does |
| --- | --- |
| `profile.json` | Your master profile. The only source of facts. |
| `src/index.js` | Command line entry point. |
| `src/agent.js` | The agent loop, the model's instructions, and the draft checks. |
| `src/backends.js` | The two ways of running the AI: Claude Code (Pro plan) and Ollama. |
| `src/schema.js` | The exact shape every draft must follow. |
| `src/fetchJob.js` | Downloads job postings and turns them into plain text. |
| `src/render.js` | Builds the Word documents and the fit check. |
| `search.json` | Job hunter settings: job types, locations, companies, fit rules, jobs per run. |
| `src/hunt.js` | Job hunter entry point. |
| `src/search.js` | Searches Greenhouse, Lever and Ashby job boards and filters matches. |
| `src/apply.js` | Fills and submits application forms in a browser, and detects CAPTCHAs and confirmations. |
| `src/pipeline.js` | Tailor, then apply, then report, for each job. |
| `src/history.js` | Remembers handled jobs so nothing is applied to twice. |
| `test/` | Offline tests with a fake model and a practice application form (`npm run test:all`). |

## Customizing

* **Change the writing rules:** edit `systemPrompt` in `src/agent.js`.
* **Add a check:** add a rule in `reviewDraft` in `src/agent.js`. Anything it returns is sent back to the model to fix.
* **Change the look:** edit fonts, colors and margins at the top of `src/render.js`.
