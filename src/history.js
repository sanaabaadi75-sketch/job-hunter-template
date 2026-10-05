// Remembers every job the hunter has looked at, so it never applies twice.
const fs = require("fs");
const path = require("path");

function loadHistory(file) {
  const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return {
    has: (key) => Boolean(entries[key]),
    get: (key) => entries[key],
    set: (key, value) => {
      entries[key] = { ...value, updated: new Date().toISOString() };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(entries, null, 2));
    },
    all: () => entries,
  };
}

module.exports = { loadHistory };
