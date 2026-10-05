# Contributing

Thanks for helping improve the job hunter! Bug fixes, new job sources, better form filling and more tests are all welcome.

## How this project was built

I built this project with **Claude** as my coding partner, using Claude Code. You're welcome to use AI tools when you contribute too. Just read and understand every line before you open a pull request, and make sure the tests pass.

## Using it vs. contributing

* **To use it for your own job hunt:** click **Use this template** and make your copy **Private**. That copy isn't linked to this repo, so you can't open pull requests from it.
* **To contribute:** **fork** this repo instead, so your changes can come back here as a pull request.

## Steps

1. **Fork** this repo on GitHub, then clone your fork:
   ```
   git clone https://github.com/YOUR_USERNAME/job-hunter-template.git
   cd job-hunter-template
   npm install
   ```
2. **Create a branch** named after your change:
   ```
   git checkout -b fix-ashby-buttons
   ```
3. **Make your change.** Match the style of the code around it: plain JavaScript (CommonJS), small functions, and short comments that explain *why*.
4. **Run the tests.** They run offline with a fake model and a practice form, so you don't need internet or Claude:
   ```
   npm run test:all
   ```
   If you add a feature, add a test for it in `test/`.
5. **Push and open a pull request** to `sanaabaadi75-sketch/job-hunter-template`. Explain what you changed, why, and how you tested it.

## Keep your personal data out

Never commit any of these:

* your real `profile.json`. Keep the "Alex Example" profile in your fork.
* `.env`. It holds your Gmail app password and is already in `.gitignore`.
* anything in `data/` or `applications/`, which hold your job history and documents.

Run `git diff --staged` before every commit to check what you're about to commit.

## Good first issues

* **Ashby forms:** the hunter can't click Ashby's Yes/No buttons yet, so those jobs land in "Needs you" (`src/apply.js`).
* **More job sources:** Workable, SmartRecruiters or more local employers. See `src/search.js` and `src/moreSources.js` for how sources are added.
* **Better form filling:** handle more kinds of questions and dropdowns (`src/apply.js`).
* **Mac and Linux setup:** the README mostly covers Windows right now.
* **More tests** for the search and apply code.

## Questions and bugs

Open an **issue** describing what happened, what you expected, and the steps to reproduce it. Remove any personal details from logs before you paste them.
