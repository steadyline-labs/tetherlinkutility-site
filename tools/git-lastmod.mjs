// sitemap.xml <lastmod> from git history, so nobody has to bump it by hand.
//
// A page's lastmod is the date of the newest commit that changed its source file (or a data file
// holding its visible text, DATA_DEPS) in a way a reader can see:
//   - only commits that modify the file count (--diff-filter=M); the commit that added it keeps the
//     date written in its front matter (`sitemap.lastmod`, else `modified`, else `published`);
//   - commits whose changed lines are all `lastmod:` or `text:` (llms.txt text) do not count, since
//     neither is shown on the page.
// The front matter date stays as a floor: the sitemap shows the later of it and the git date.
// Used by eleventy.config.js (sitemap) and tests/sitemap.test.mjs (check), so both agree.
// Needs full git history: in CI, actions/checkout runs with fetch-depth: 0.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { languages } = JSON.parse(fs.readFileSync(path.join(root, "src/_data/site.json"), "utf8"));

// Page source -> data files that hold its visible text; the newest change of any of them counts.
export const DATA_DEPS = Object.fromEntries(
  languages.map((l) => [l === "en" ? "src/index.njk" : `src/${l}/index.njk`, [`src/_data/home/${l}.json`]]),
);

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });

// true for a shallow clone, false for full history, null outside a git checkout.
export function shallowRepo() {
  try {
    return git("rev-parse", "--is-shallow-repository").trim() === "true";
  } catch {
    return null;
  }
}

// Repo-relative file -> YYYY-MM-DD of its newest visible change, from one `git log` over src/ and
// public/. Empty outside a git checkout (the front matter dates are used then).
function changeDates() {
  let log;
  try {
    log = git("log", "--diff-filter=M", "--no-renames", "--format=@@commit %cs", "-p", "--unified=0", "--", "src", "public");
  } catch {
    return new Map();
  }
  const dates = new Map();
  for (const commit of log.split(/^@@commit /m).slice(1)) {
    const date = commit.slice(0, 10);
    for (const fileDiff of commit.split(/^diff --git /m).slice(1)) {
      const file = (fileDiff.match(/^\+\+\+ b\/(.+)$/m) || [])[1];
      if (!file || dates.has(file)) continue; // newest commit first: the first visible change wins
      const changed = fileDiff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
      if (changed.some((l) => !/^[+-]\s+(lastmod|text):/.test(l))) dates.set(file, date);
    }
  }
  return dates;
}

// Reads git once; call once per build (or test run).
export function gitLastmods() {
  const dates = changeDates();
  // Newest visible change of a page source and its DATA_DEPS, or null.
  const gitLastmod = (rel) => [rel, ...(DATA_DEPS[rel] || [])].map((f) => dates.get(f)).filter(Boolean).sort().pop() || null;
  // The later of the front matter date and the git date.
  const lastmodFor = (rel, floor) => [floor, gitLastmod(rel)].filter(Boolean).map(String).sort().pop();
  return { gitLastmod, lastmodFor };
}
