#!/usr/bin/env node
/**
 * Validates the machine half of /memory against the vault, the code and the
 * generated pages.
 *
 * Design rule: memory that lies is worse than no memory. So this checks links
 * in BOTH directions — every project.json module must have a folder and docs,
 * and every module folder must be listed. `pnpm check` runs it, so a pass
 * cannot end green with stale memory.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { renderAll } from "./render-memory.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const memoryDir = path.join(root, "memory");
const vaultDir = path.join(memoryDir, "vault");
const projectPath = path.join(memoryDir, "machine/project.json");

const PHASES = ["P0", "P1", "P2", "P3", "P4", "P4.5", "P5", "P6", "P7", "P8", "P9", "P10", "none"];
const FEATURE_STATUSES = ["shipped-in-repo", "open", "planned", "non-goal"];
const CONFIDENCE = ["high", "medium", "low"];

const errors = [];
const warnings = [];
const checks = [];

function rel(target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function memoryPath(p) {
  return path.join(memoryDir, p);
}

function check(label, ok, detail) {
  checks.push({ label, ok });
  if (!ok) errors.push(detail ?? label);
}

async function readText(file) {
  return readFile(file, "utf8");
}

async function readJson(relative) {
  return JSON.parse(await readText(memoryPath(relative)));
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function passNumber(pass) {
  return Number((String(pass.id ?? "").match(/[0-9]+$/) || [0])[0]);
}

async function listMarkdown(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listMarkdown(full)));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found;
}

async function checkFeatures() {
  const features = await readJson("machine/features.json");
  check("features schemaVersion is 1", features.schemaVersion === 1, "features.json schemaVersion must be 1");
  check("features updatedAt is a date", isDate(features.updatedAt), "features.json updatedAt must be YYYY-MM-DD");
  check("features has domains", Array.isArray(features.domains) && features.domains.length > 0, "features.json has no domains");

  const livePath = memoryPath("machine/live.json");
  const live = existsSync(livePath) ? JSON.parse(await readText(livePath)) : undefined;
  const liveChecks = new Map((live?.checks ?? []).map((entry) => [entry.id, entry]));

  const ids = new Set();
  const domainIds = new Set();
  let count = 0;

  for (const domain of features.domains ?? []) {
    check(`feature domain ${domain.id} has a name`, Boolean(domain.id && domain.name), "a feature domain is missing id or name");
    check(`feature domain ${domain.id} is unique`, !domainIds.has(domain.id), `duplicate feature domain ${domain.id}`);
    domainIds.add(domain.id);
    check(`feature domain ${domain.id} has features`, Array.isArray(domain.features), `${domain.id} features must be an array`);

    for (const feature of domain.features ?? []) {
      count += 1;
      const label = `feature ${feature.id ?? "<unnamed>"}`;
      check(`${label} has a name`, Boolean(feature.name), `${label} is missing name`);
      check(`${label} id is unique`, Boolean(feature.id) && !ids.has(feature.id), `${label} id is missing or duplicated`);
      ids.add(feature.id);
      check(`${label} phase is known`, PHASES.includes(feature.phase), `${label} has unknown phase ${feature.phase}`);
      check(`${label} status is known`, FEATURE_STATUSES.includes(feature.status), `${label} has unknown status ${feature.status}`);
      check(`${label} has a source`, typeof feature.source === "string" && existsSync(path.join(root, feature.source)), `${label} source is missing: ${feature.source}`);
      check(`${label} liveVerified is boolean`, typeof feature.liveVerified === "boolean", `${label} must set liveVerified true or false`);

      if (feature.liveEvidence !== undefined) {
        check(
          `${label} liveEvidence is an array`,
          Array.isArray(feature.liveEvidence),
          `${label} liveEvidence must be an array of check ids`,
        );
        check(
          `${label} liveEvidence requires liveVerified`,
          feature.liveVerified === true,
          `${label} names live evidence but liveVerified is not true`,
        );
        for (const checkId of feature.liveEvidence ?? []) {
          const liveCheck = liveChecks.get(checkId);
          check(
            `${label} liveEvidence ${checkId} passed`,
            liveCheck?.status === "pass",
            `${label} names live check ${checkId}, which is missing or not passing in machine/live.json`,
          );
          check(
            `${label} liveEvidence ${checkId} names this feature`,
            Array.isArray(liveCheck?.features) && liveCheck.features.includes(feature.id),
            `${label} names live check ${checkId}, but that check does not list ${feature.id} in features`,
          );
        }
      }

      if (feature.status === "shipped-in-repo") {
        check(`${label} has evidence`, Array.isArray(feature.evidence) && feature.evidence.length > 0, `${label} is shipped but has no evidence path`);
        for (const evidence of feature.evidence ?? []) {
          check(`${label} evidence exists`, existsSync(path.join(root, evidence)), `${label} evidence does not exist: ${evidence}`);
        }
      }
      if (feature.status === "open") {
        check(`${label} explains what is open`, typeof feature.openReason === "string" && feature.openReason.trim().length > 0, `${label} is open but has no openReason`);
      }
      if (feature.status === "non-goal") {
        check(`${label} uses phase none`, feature.phase === "none", `${label} is a non-goal but its phase is ${feature.phase}`);
      }
    }
  }

  console.log(`memory: ${count} feature rows checked`);
}

async function checkLive() {
  const live = await readJson("machine/live.json");
  const project = await readJson("machine/project.json");
  const features = await readJson("machine/features.json");
  const liveFeatureIds = new Set(
    features.domains
      .flatMap((domain) => domain.features)
      .filter((feature) => feature.liveVerified === true)
      .map((feature) => feature.id),
  );
  check(
    "project.live points at the current report",
    project.live?.report === "machine/live.json" && project.live?.id === live.id,
    `project.live is ${project.live?.id ?? "<none>"}; live.json is ${live.id}`,
  );
  check("live schemaVersion is 1", live.schemaVersion === 1, "live.json schemaVersion must be 1");
  check("live date is a date", isDate(live.date), "live.json date must be YYYY-MM-DD");
  check("live id names the date", live.id === `live-${live.date}`, `live.json id ${live.id} does not match live-${live.date}`);
  check("live docker is recorded", typeof live.docker === "object", "live.json has no docker block");
  check(
    "live postgres is reachable",
    live.services?.postgres?.reachable === true,
    "live.json does not record a reachable Postgres",
  );
  check(
    "live postgres is migrated",
    live.services?.postgres?.migrations?.pending === 0 && live.services.postgres.migrations.upToDate === true,
    "live.json records pending migrations",
  );
  check("live redis is reachable", live.services?.redis?.reachable === true, "live.json does not record a reachable Redis");
  check("live has checks", Array.isArray(live.checks) && live.checks.length > 0, "live.json has no checks");

  const ids = new Set();
  for (const entry of live.checks ?? []) {
    check(`live check ${entry.id ?? "<unnamed>"} id`, Boolean(entry.id) && !ids.has(entry.id), `live check id is missing or duplicated: ${entry.id}`);
    ids.add(entry.id);
    check(`live check ${entry.id} passed`, entry.status === "pass", `live check ${entry.id} is ${entry.status}`);
    check(`live check ${entry.id} has detail`, typeof entry.detail === "string" && entry.detail.length > 0, `live check ${entry.id} has no detail`);
    check(`live check ${entry.id} has features`, Array.isArray(entry.features), `live check ${entry.id} features must be an array`);
    for (const featureId of entry.features ?? []) {
      check(
        `live check ${entry.id} feature ${featureId} is live-verified`,
        liveFeatureIds.has(featureId),
        `live check ${entry.id} names ${featureId}, which is not liveVerified in features.json`,
      );
    }
  }

  console.log(`memory: ${live.checks?.length ?? 0} live checks checked`);
}

async function checkResearch() {
  const research = await readJson("machine/research.json");
  check("research schemaVersion is 1", research.schemaVersion === 1, "research.json schemaVersion must be 1");
  check("research updatedAt is a date", isDate(research.updatedAt), "research.json updatedAt must be YYYY-MM-DD");
  check("research has claims", Array.isArray(research.claims) && research.claims.length > 0, "research.json has no claims");

  const ids = new Set();
  const today = new Date().toISOString().slice(0, 10);
  for (const claim of research.claims ?? []) {
    const label = `claim ${claim.id ?? "<unnamed>"}`;
    check(`${label} id is unique`, Boolean(claim.id) && !ids.has(claim.id), `${label} id is missing or duplicated`);
    ids.add(claim.id);
    check(`${label} has a topic`, Boolean(claim.topic), `${label} is missing topic`);
    check(`${label} has claim text`, typeof claim.claim === "string" && claim.claim.length > 20, `${label} claim text is too short`);
    check(`${label} has a URL source`, isUrl(claim.source), `${label} source is not an http(s) URL`);
    check(`${label} retrievedAt is a date`, isDate(claim.retrievedAt), `${label} retrievedAt must be YYYY-MM-DD`);
    check(`${label} confidence is known`, CONFIDENCE.includes(claim.confidence), `${label} has unknown confidence ${claim.confidence}`);
    check(`${label} expiresAt is a date`, isDate(claim.expiresAt), `${label} expiresAt must be YYYY-MM-DD`);
    check(`${label} expiry follows retrieval`, isDate(claim.expiresAt) && claim.expiresAt >= claim.retrievedAt, `${label} expires before it was retrieved`);
    check(`${label} is not expired`, isDate(claim.expiresAt) && claim.expiresAt >= today, `${label} expired on ${claim.expiresAt}; refresh the source`);
    for (const usedIn of claim.usedIn ?? []) {
      check(`${label} usedIn exists`, existsSync(path.join(root, usedIn)), `${label} usedIn does not exist: ${usedIn}`);
    }
  }

  console.log(`memory: ${research.claims?.length ?? 0} research claims checked`);
}

async function checkPasses() {
  const passes = await readJson("machine/passes.json");
  check("passes schemaVersion is 1", passes.schemaVersion === 1, "passes.json schemaVersion must be 1");
  check("passes has entries", Array.isArray(passes.passes) && passes.passes.length > 0, "passes.json has no passes");

  const ids = new Set();
  for (const pass of passes.passes ?? []) {
    const label = `pass ${pass.id ?? "<unnamed>"}`;
    check(`${label} id is unique`, Boolean(pass.id) && !ids.has(pass.id), `${label} id is missing or duplicated`);
    ids.add(pass.id);
    check(`${label} date is a date`, isDate(pass.date), `${label} date must be YYYY-MM-DD`);
    check(`${label} phase is known`, PHASES.includes(pass.phase), `${label} has unknown phase ${pass.phase}`);
    check(`${label} has a summary`, typeof pass.summary === "string" && pass.summary.length > 0, `${label} is missing a summary`);
    const journal = memoryPath(pass.journal ?? "");
    check(`${label} journal exists`, Boolean(pass.journal) && existsSync(journal), `${label} journal is missing: ${pass.journal}`);
    if (existsSync(journal)) {
      const text = await readText(journal);
      for (const heading of ["## What changed", "## What we tried and rejected", "## Verification", "## Next"]) {
        check(`${label} journal has "${heading}"`, text.includes(heading), `${pass.journal} is missing the "${heading}" section`);
      }
    }
  }

  const latest = [...(passes.passes ?? [])].sort((a, b) => passNumber(a) - passNumber(b)).at(-1);
  const project = JSON.parse(await readText(projectPath));
  check(
    "project.phase matches the latest pass phase",
    !latest || project.phase === latest.phase,
    `project.phase is ${project.phase} but the latest pass is ${latest?.phase}`,
  );
  check(
    "project.lastPass points at the latest pass",
    !latest || project.lastPass === latest.journal,
    `project.lastPass is ${project.lastPass} but the latest pass journal is ${latest?.journal}`,
  );

  const statusPath = path.join(vaultDir, "01-Mission/Status.md");
  if (existsSync(statusPath)) {
    const status = await readText(statusPath);
    const now = status.split("## Now")[1] ?? "";
    const nowPass = now.match(/pass[- ](\d+)/i);
    check(
      "Status.md Now names the latest pass",
      Boolean(latest && nowPass && Number(nowPass[1]) === passNumber(latest)),
      `Status.md Now says ${nowPass?.[0] ?? "<no pass>"} but the latest pass is ${latest?.id ?? "<none>"}`,
    );
  }

  console.log(`memory: ${passes.passes?.length ?? 0} passes checked`);
}

async function checkDecisions() {
  const decisions = await readJson("machine/decisions.json");
  check("decisions schemaVersion is 1", decisions.schemaVersion === 1, "decisions.json schemaVersion must be 1");
  check("decisions has entries", Array.isArray(decisions.decisions) && decisions.decisions.length > 0, "decisions.json has no decisions");

  const ids = new Set();
  const listed = new Set();
  for (const decision of decisions.decisions ?? []) {
    const label = `decision ${decision.id ?? "<unnamed>"}`;
    check(`${label} id is unique`, Boolean(decision.id) && !ids.has(decision.id), `${label} id is missing or duplicated`);
    ids.add(decision.id);
    check(`${label} has a title`, Boolean(decision.title), `${label} is missing a title`);
    check(`${label} has a status`, ["proposed", "accepted", "superseded", "rejected"].includes(decision.status), `${label} has unknown status ${decision.status}`);
    check(`${label} has a date`, isDate(decision.date), `${label} date must be YYYY-MM-DD`);
    check(`${label} records alternatives`, decision.alternatives === true, `${label} must record alternatives`);
    const file = memoryPath(decision.path ?? "");
    check(`${label} file exists`, Boolean(decision.path) && existsSync(file), `${label} path is missing: ${decision.path}`);
    listed.add(path.basename(decision.path ?? ""));
  }

  const adrDir = path.join(memoryDir, "vault/03-Architecture/ADR");
  const adrFiles = existsSync(adrDir) ? (await readdir(adrDir)).filter((file) => file.endsWith(".md")) : [];
  for (const file of adrFiles) {
    check(`ADR ${file} is indexed`, listed.has(file), `ADR ${file} is not in machine/decisions.json`);
  }

  console.log(`memory: ${decisions.decisions?.length ?? 0} decisions checked`);
}

async function checkGenerated() {
  const pages = await renderAll();
  for (const [relative, content] of pages) {
    const file = memoryPath(relative);
    check(`generated page ${relative} exists`, existsSync(file), `${relative} is missing; run pnpm memory:render`);
    if (existsSync(file)) {
      const actual = await readText(file);
      check(`generated page ${relative} is current`, actual === content, `${relative} is stale; run pnpm memory:render`);
    }
  }

  console.log(`memory: ${pages.size} generated pages checked`);
}

async function checkCurriculum() {
  const learningDir = path.join(vaultDir, "05-Learning");
  const curriculumPath = path.join(learningDir, "Curriculum.md");
  if (!existsSync(curriculumPath)) return;

  const files = (await readdir(learningDir))
    .filter((file) => /^\d{2}-.+\.md$/.test(file))
    .map((file) => file.replace(/\.md$/, ""));
  const text = await readText(curriculumPath);
  const linked = [...text.matchAll(/\[\[(\d{2}-[a-z][a-z0-9-]*)\]\]/g)].map((match) => match[1].trim());

  for (const file of files) {
    check(
      `Curriculum links written lesson ${file}`,
      linked.includes(file),
      `05-Learning/${file}.md exists but Curriculum.md does not link it`,
    );
  }
  for (const link of linked) {
    check(
      `Curriculum lesson ${link} exists`,
      files.includes(link),
      `Curriculum.md links ${link} but 05-Learning/${link}.md does not exist`,
    );
  }

  console.log(`memory: ${files.length} lesson file(s), ${linked.length} linked lesson(s) checked`);
}

const LESSON_HEADINGS = [
  "## The problem",
  "## Our version",
  "## Exercise",
  "## What we rejected",
  "## Check yourself",
];

/**
 * Lessons are code, not prose. Each one names real package scripts and real
 * files; a count is only allowed when a machine source can recompute it. This
 * keeps a teaching page from rotting after the code it describes moves.
 */
async function checkLessons() {
  const lessonsPath = memoryPath("machine/lessons.json");
  if (!existsSync(lessonsPath)) return;

  const machine = JSON.parse(await readText(lessonsPath));
  const project = await readJson("machine/project.json");
  const commands = await readJson("machine/commands.json");
  const live = await readJson("machine/live.json");
  const packageJson = JSON.parse(await readText(path.join(root, "package.json")));
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const learningDir = path.join(vaultDir, "05-Learning");
  const entries = machine.lessons ?? [];
  const ids = new Set();
  const orders = new Set();
  const sources = {
    limit: commands.limit,
    contextMenuLimit: commands.contextMenuLimit,
    userContextMenus: commands.userContextMenus,
    messageContextMenus: commands.messageContextMenus,
    migrations: live.services?.postgres?.migrations?.applied,
    modules: project.metrics?.modules,
    roots: commands.roots,
    subcommands: commands.subcommands,
    actions: commands.actions,
    contextMenus: commands.contextMenus,
    liveChecks: live.checks?.length,
    lessons: entries.length,
  };

  check("lessons schemaVersion is 1", machine.schemaVersion === 1, "machine/lessons.json schemaVersion must be 1");
  check("lessons updatedAt is a date", isDate(machine.updatedAt), "machine/lessons.json updatedAt must be YYYY-MM-DD");
  check(
    "lessons target matches the written lessons",
    Number.isInteger(machine.target) && machine.target === entries.length,
    `lessons target is ${machine.target}, but ${entries.length} lessons are listed`,
  );

  const curriculum = await readText(path.join(learningDir, "Curriculum.md"));
  check(
    "Curriculum states the lesson count",
    curriculum.includes(`${machine.target} lessons`),
    `Curriculum.md does not state the ${machine.target}-lesson count`,
  );

  const files = (await readdir(learningDir))
    .filter((file) => /^\d{2}-.+\.md$/.test(file))
    .map((file) => file.replace(/\.md$/, ""));

  for (const lesson of entries) {
    const label = `lesson ${lesson.id ?? "<unnamed>"}`;
    check(`${label} has an id`, Boolean(lesson.id), `${label} is missing an id`);
    check(`${label} id is unique`, Boolean(lesson.id) && !ids.has(lesson.id), `${label} id is duplicated`);
    ids.add(lesson.id);
    check(
      `${label} order is positive and unique`,
      Number.isInteger(lesson.order) && lesson.order > 0 && !orders.has(lesson.order),
      `${label} has an invalid or duplicate order`,
    );
    orders.add(lesson.order);
    check(
      `${label} path matches its id`,
      lesson.path === `vault/05-Learning/${lesson.id}.md`,
      `${label} path is ${lesson.path}, expected vault/05-Learning/${lesson.id}.md`,
    );
    check(`${label} file exists`, existsSync(memoryPath(lesson.path ?? "")), `${label} file is missing: ${lesson.path}`);
    check(
      `${label} is linked from Curriculum`,
      curriculum.includes(`[[${lesson.id}]]`),
      `Curriculum.md does not link [[${lesson.id}]]`,
    );

    check(
      `${label} has proof commands`,
      Array.isArray(lesson.proofCommands) && lesson.proofCommands.length > 0,
      `${label} has no proofCommands`,
    );
    check(
      `${label} has source files`,
      Array.isArray(lesson.files) && lesson.files.length > 0,
      `${label} has no source files`,
    );

    for (const file of lesson.files ?? []) {
      check(`${label} source ${file} exists`, existsSync(path.join(root, file)), `${label} source does not exist: ${file}`);
    }

    if (!existsSync(memoryPath(lesson.path ?? ""))) continue;
    const text = await readText(memoryPath(lesson.path));
    for (const heading of LESSON_HEADINGS) {
      check(`${label} has "${heading}"`, text.includes(heading), `${lesson.path} is missing the "${heading}" section`);
    }

    for (const command of lesson.proofCommands ?? []) {
      check(`${label} teaches its proof command`, text.includes(command), `${lesson.path} does not contain the proof command "${command}"`);
      const parts = String(command).trim().split(/\s+/);
      check(`${label} proof command starts with pnpm`, parts[0] === "pnpm", `invalid proof command: ${command}`);
      const script = parts[1];
      check(
        `${label} proof command ${script} is a package script`,
        Boolean(script) && (scripts.has(script) || script === "vitest"),
        `proof command uses unknown package script: ${command}`,
      );
      const args = parts.slice(2);
      if (args[0] === "--") args.shift();
      for (const arg of args) {
        if (arg.includes("/") || arg.includes("\\")) {
          check(
            `${label} proof path ${arg} exists`,
            existsSync(path.join(root, arg)),
            `proof command path does not exist: ${arg}`,
          );
        }
      }
    }

    for (const fact of lesson.facts ?? []) {
      const actual = sources[fact.source];
      const match = String(fact.text ?? "").match(/(\d[\d,]*)/);
      check(
        `${label} fact ${fact.text} has a known source`,
        actual !== undefined && Number.isFinite(actual),
        `${label} fact uses unknown source ${fact.source}`,
      );
      check(
        `${label} fact ${fact.text} matches ${fact.source}`,
        Boolean(match) && Number(match[1].replaceAll(",", "")) === actual,
        `${label} says "${fact.text}" but ${fact.source} is ${actual}`,
      );
      check(
        `${label} fact ${fact.text} is taught`,
        text.includes(fact.text),
        `${lesson.path} does not contain the fact "${fact.text}"`,
      );
    }
  }

  for (const file of files) {
    check(
      `written lesson ${file} is in machine/lessons.json`,
      ids.has(file),
      `05-Learning/${file}.md exists but machine/lessons.json does not list it`,
    );
  }

  const ordered = [...entries].sort((a, b) => a.order - b.order);
  check(
    "lesson order has no gaps",
    ordered.every((lesson, index) => lesson.order === index + 1),
    "lesson order must be 1..n with no gaps",
  );

  console.log(`memory: ${entries.length} lessons checked against code, commands and facts`);
}

/**
 * Prose is memory too.
 *
 * Links and schemas can be perfect while a sentence says "18 roots" beside a
 * registry with 20. This pass scans the documents that speak in the present
 * tense and makes every count answer to the same machine files the bot reads.
 * A historical sentence is allowed to be wrong about today when it names the
 * pass it describes; a sentence with "now" or "current" in it never is.
 */
const COUNT_FACTS = {
  roots: "commands.json roots",
  subcommands: "commands.json subcommands",
  actions: "commands.json actions",
  contextMenus: "commands.json contextMenus",
  modules: "project.metrics.modules",
  tests: "test-report.json numTotalTests",
  files: "test-report.json testResults.length",
  passes: "passes.json passes.length",
};

// Only sentences that claim the global ledger are governed. A module page may
// legitimately say "3 roots" about its own share of the tree; that is not a
// contradiction. The phrasing below is what the live ledger and the budget use.
const COUNT_RULES = [
  { key: "roots", label: "root(s)", regex: /(\d[\d,]*)\s*\/\s*100\s+roots?\b/gi },
  { key: "roots", label: "root(s)", regex: /(\d[\d,]*)\s+(?:global\s+)?command\s+roots?\b/gi },
  { key: "roots", label: "root(s)", regex: /\bRegistry\s+(\d[\d,]*)\s+roots?\b/gi },
  { key: "roots", label: "root(s)", regex: /(\d[\d,]*)\s+roots?\s*(?:\/|·|\|)\s*\d[\d,]*\s+subcommands?/gi },
  {
    key: "roots",
    label: "root(s)",
    regex: /\b(?:ledger|registry|budget)\b[^.\n]{0,30}(?<![\d,])(\d[\d,]*)\s+roots?\b/gi,
  },
  {
    key: "subcommands",
    label: "subcommand(s)",
    regex: /(\d[\d,]*)\s+(?:real\s+)?subcommands?\b/gi,
    requires: /\b(?:ledger|registry|budget|roots?|actions?|doctor|total)\b/i,
  },
  {
    key: "actions",
    label: "action(s)",
    regex: /(\d[\d,]*)\s+(?:total\s+)?actions?\b/gi,
    requires: /\b(?:ledger|registry|budget|subcommands?|total|doctor)\b/i,
  },
  {
    key: "contextMenus",
    label: "context menu(s)",
    regex: /(?<![\w])(\d[\d,]*)\s+context\s+menus?\b/gi,
    requires: /\b(?:budget|ledger|registry|doctor|total)\b/i,
  },
  {
    key: "modules",
    label: "module(s)",
    regex: /(\d[\d,]*)\s+modules?\b/gi,
    requires: /\b(?:registered|total|ledger|all|modules,|catalog)\b/i,
  },
  { key: "passes", label: "pass(es)", regex: /(\d[\d,]*)\s+passes?\b/gi },
  { key: "suite", label: "full test suite", regex: /(\d[\d,]*)\s+tests?\s+(?:in|across)\s+(\d[\d,]*)\s+files?/gi },
  { key: "suite", label: "full test suite", regex: /(\d[\d,]*)\s+tests?\s*\/\s*(\d[\d,]*)\s+files?/gi },
  {
    key: "suite",
    label: "full test suite",
    regex: /[Tt]ests?\s+(?:are|remain|:)\s*\**\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+files?/gi,
  },
];

const PROSE_CURRENT = /(?<!then-)\b(?:now|current|currently|today|as of)\b/i;
const PROSE_HISTORY =
  /\b(?:at pass|in pass|before pass|after pass|since pass|pass[- ]?\d+|was|were|had|formerly|previously|brought|reached|became|rose|grew|old ledger|historical|at that pass|at that point|at the time|then-current|live\s+\d{4}-\d{2}-\d{2})\b/i;

function parseCount(value) {
  return Number(String(value).replaceAll(",", ""));
}

async function capabilityHasCode(capability) {
  for (const evidence of capability.evidence ?? []) {
    if (evidence.type === "path") {
      if (existsSync(path.join(root, evidence.path))) return true;
    } else if (evidence.type === "contains") {
      const file = path.join(root, evidence.path);
      if (existsSync(file) && (await readText(file)).includes(evidence.text)) return true;
    }
  }
  return false;
}

async function checkProseClaims() {
  const claimsPath = memoryPath("machine/claims.json");
  check("machine/claims.json exists", existsSync(claimsPath), "machine/claims.json is missing; prose is not governed");
  if (!existsSync(claimsPath)) return;

  const claims = JSON.parse(await readText(claimsPath));
  check("claims schemaVersion is 1", claims.schemaVersion === 1, "machine/claims.json schemaVersion must be 1");
  check("claims updatedAt is a date", isDate(claims.updatedAt), "machine/claims.json updatedAt must be YYYY-MM-DD");
  check(
    "claims govern at least one document",
    Array.isArray(claims.governed?.files) || Array.isArray(claims.governed?.directories),
    "machine/claims.json has no governed files or directories",
  );

  const commands = await readJson("machine/commands.json");
  const project = await readJson("machine/project.json");
  const passes = await readJson("machine/passes.json");
  const reportPath = memoryPath("machine/test-report.json");
  const report = existsSync(reportPath) ? JSON.parse(await readText(reportPath)) : undefined;

  // The prose points at commands.json, which must point at the same metrics the
  // registry audit checks. This closes the chain: prose -> commands.json ->
  // project.metrics -> registry.
  check(
    "commands.json roots matches project.metrics.commands",
    commands.roots === project.metrics?.commands,
    `commands.json has ${commands.roots} roots; project.metrics.commands is ${project.metrics?.commands}`,
  );
  check(
    "commands.json subcommands matches project.metrics.subcommands",
    commands.subcommands === project.metrics?.subcommands,
    `commands.json has ${commands.subcommands} subcommands; project.metrics.subcommands is ${project.metrics?.subcommands}`,
  );
  check(
    "commands.json actions matches project.metrics.actions",
    commands.actions === project.metrics?.actions,
    `commands.json has ${commands.actions} actions; project.metrics.actions is ${project.metrics?.actions}`,
  );
  check(
    "commands.json contextMenus matches project.metrics.contextMenus",
    commands.contextMenus === project.metrics?.contextMenus,
    `commands.json has ${commands.contextMenus} context menus; project.metrics.contextMenus is ${project.metrics?.contextMenus}`,
  );
  check(
    "project.metrics.modules matches the module list",
    project.metrics?.modules === (project.modules ?? []).length,
    `project.metrics.modules is ${project.metrics?.modules}; project.modules has ${(project.modules ?? []).length} entries`,
  );
  check(
    "project.metrics.tests matches the test report",
    Boolean(report) && project.metrics?.tests === report.numTotalTests,
    `project.metrics.tests is ${project.metrics?.tests}; the test report says ${report?.numTotalTests ?? "<none>"}`,
  );

  const facts = {
    roots: commands.roots,
    subcommands: commands.subcommands,
    actions: commands.actions,
    contextMenus: commands.contextMenus,
    modules: project.metrics?.modules,
    tests: report?.numTotalTests,
    files: report?.testResults?.length,
    passes: passes.passes?.length,
  };

  // --- governed documents --------------------------------------------------
  const governed = claims.governed ?? {};
  const excluded = new Set(governed.exclude ?? []);
  const docs = new Set();

  for (const file of governed.files ?? []) {
    check(`claims governed file ${file} exists`, existsSync(path.join(root, file)), `machine/claims.json governs a missing file: ${file}`);
    if (existsSync(path.join(root, file))) docs.add(path.join(root, file));
  }
  for (const dir of governed.directories ?? []) {
    const full = path.join(root, dir);
    check(`claims governed directory ${dir} exists`, existsSync(full), `machine/claims.json governs a missing directory: ${dir}`);
    if (existsSync(full)) for (const file of await listMarkdown(full)) docs.add(file);
  }

  const docList = [...docs].filter((file) => !excluded.has(rel(file))).sort();
  check("claims scan at least one document", docList.length > 0, "machine/claims.json resolves to no documents");

  let countClaims = 0;
  let capabilityMentions = 0;

  // --- current-tense counts ------------------------------------------------
  for (const file of docList) {
    const lines = (await readText(file)).split(/\r?\n/);
    const paragraphStart = [];
    let start = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() === "") start = index + 1;
      paragraphStart[index] = start;
    }

    const seen = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const window = [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" ");
      const heading = /^\s*\*{0,2}Pass[- ]?\d+/i.test(lines[paragraphStart[index]] ?? "");
      const historical = PROSE_HISTORY.test(window) || heading;
      if (historical && !PROSE_CURRENT.test(window)) continue;

      for (const rule of COUNT_RULES) {
        if (rule.requires && !rule.requires.test(window)) continue;
        for (const match of line.matchAll(rule.regex)) {
          const raw = match[1];
          if (raw === undefined) continue;
          const value = parseCount(raw);
          if (rule.key === "roots" && value === 100) continue;
          if (rule.key === "roots" && /for this module|of Discord's|this module|global roots \(|per module/i.test(window)) continue;
          // A command-level test run is not the full-suite claim.
          if (rule.key === "suite" && /vitest run|modules\//i.test(line)) continue;

          const id = `${index}:${match.index}:${rule.key}`;
          if (seen.has(id)) continue;
          seen.add(id);
          countClaims += 1;

          if (rule.key === "suite") {
            const files = parseCount(match[2] ?? "0");
            check(
              `${rel(file)}:${index + 1} full-suite test claim is ${value} / ${files}`,
              value === facts.tests && files === facts.files,
              `${rel(file)}:${index + 1} says ${value} tests in ${files} files, but the runner reports ${facts.tests} in ${facts.files}`,
            );
            continue;
          }

          const expected = facts[rule.key];
          if (expected === undefined) continue;
          check(
            `${rel(file)}:${index + 1} ${rule.label} claim is ${value}`,
            value === expected,
            `${rel(file)}:${index + 1} says ${value} ${rule.label}, but ${COUNT_FACTS[rule.key]} is ${expected}`,
          );
        }
      }
    }
  }

  // --- capabilities with no code behind them -------------------------------
  let capabilityIds = new Set();
  for (const capability of claims.capabilities ?? []) {
    const label = `capability ${capability.id ?? "<unnamed>"}`;
    check(`${label} has an id`, Boolean(capability.id), "a capability in machine/claims.json has no id");
    check(`${label} id is unique`, Boolean(capability.id) && !capabilityIds.has(capability.id), `${label} id is duplicated`);
    capabilityIds.add(capability.id);
    check(`${label} has a label`, typeof capability.label === "string" && capability.label.length > 0, `${label} has no label`);
    check(
      `${label} has evidence probes`,
      Array.isArray(capability.evidence) && capability.evidence.length > 0,
      `${label} has no evidence probes`,
    );

    let claimRegex;
    let markerRegex;
    try {
      claimRegex = new RegExp(capability.claim, "i");
      check(`${label} claim is a valid pattern`, true);
    } catch {
      check(`${label} claim is a valid pattern`, false, `${label} claim is not a valid regular expression`);
      continue;
    }
    try {
      markerRegex = new RegExp(capability.allowedMarker, "i");
      check(`${label} allowedMarker is a valid pattern`, true);
    } catch {
      check(`${label} allowedMarker is a valid pattern`, false, `${label} allowedMarker is not a valid regular expression`);
      continue;
    }

    for (const evidence of capability.evidence ?? []) {
      if (evidence.type === "contains") {
        check(
          `${label} evidence file ${evidence.path} exists`,
          existsSync(path.join(root, evidence.path)),
          `${label} evidence file does not exist: ${evidence.path}`,
        );
      }
    }

    if (await capabilityHasCode(capability)) continue;

    for (const file of docList) {
      const lines = (await readText(file)).split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!claimRegex.test(lines[index])) continue;
        if (PROSE_HISTORY.test([lines[index - 1] ?? "", lines[index], lines[index + 1] ?? ""].join(" ")) && !PROSE_CURRENT.test(lines[index])) {
          // A journal-style sentence about a past decision is not a claim that
          // the capability exists today.
          continue;
        }
        capabilityMentions += 1;
        const context = [lines[index - 1] ?? "", lines[index], lines[index + 1] ?? ""].join(" ");
        check(
          `${rel(file)}:${index + 1} marks ${capability.label} as future work`,
          markerRegex.test(context),
          `${rel(file)}:${index + 1} mentions ${capability.label} without a planned/future marker, and no code evidence exists`,
        );
      }
    }
  }

  // --- environment prose ---------------------------------------------------
  const live = await readJson("machine/live.json");
  if (live.services?.postgres?.reachable) {
    const stoppedClaim = /compose[^.\n]{0,80}(?:not started|not running)|live window is memory mode|DATABASE_URL: ECONNREFUSED|REDIS_URL: ECONNREFUSED/i;
    for (const file of docList) {
      const lines = (await readText(file)).split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!stoppedClaim.test(lines[index])) continue;
        const window = [lines[index - 1] ?? "", lines[index], lines[index + 1] ?? ""].join(" ");
        if (PROSE_HISTORY.test(window) && !PROSE_CURRENT.test(window)) continue;
        check(
          `${rel(file)}:${index + 1} does not call live services stopped`,
          false,
          `${rel(file)}:${index + 1} says Postgres/Redis are stopped, but machine/live.json records them reachable`,
        );
      }
    }
  }

  console.log(
    `memory: ${countClaims} prose count claim(s) and ${capabilityMentions} capability mention(s) checked against machine truth`,
  );
}

async function checkLocalLinks() {
  const files = await listMarkdown(vaultDir);
  const rootDocs = [
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "GOVERNANCE.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
  ]
    .map((file) => path.join(root, file))
    .filter((file) => existsSync(file));
  let count = 0;

  for (const file of [...files, ...rootDocs]) {
    const text = await readText(file);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (
        !target ||
        target.startsWith("#") ||
        target.startsWith("http:") ||
        target.startsWith("https:") ||
        target.startsWith("mailto:") ||
        target.startsWith("<")
      ) {
        continue;
      }
      target = target.split("#")[0];
      if (!target) continue;
      count += 1;
      const resolved = path.resolve(path.dirname(file), target);
      check(
        `${rel(file)} local link ${target}`,
        existsSync(resolved),
        `${rel(file)} has a broken local link: ${target}`,
      );
    }
  }

  console.log(`memory: ${count} local markdown links checked`);
}

async function checkVaultLinks() {
  if (!existsSync(vaultDir)) {
    errors.push("memory/vault is missing");
    return;
  }

  const files = await listMarkdown(vaultDir);
  const byPath = new Set();
  const byBasename = new Map();

  for (const file of files) {
    const relative = rel(file).replace(/^memory\/vault\//, "").replace(/\.md$/, "");
    byPath.add(relative);
    const base = path.basename(relative);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(relative);
  }

  let links = 0;
  for (const file of files) {
    const text = await readText(file);
    const relativeFile = rel(file);
    for (const match of text.matchAll(/\[\[([^\]|#]+?)(?:#[^\]|]+)?(?:\\?\|[^\]]+)?\]\]/g)) {
      const target = match[1].trim().replace(/\\$/, "").replace(/\.md$/, "").replace(/^\//, "");
      if (!target) continue;
      links += 1;
      const candidate = byPath.has(target)
        ? target
        : byBasename.get(path.basename(target))?.[0];
      check(
        `${relativeFile} link ${target}`,
        Boolean(candidate),
        `${relativeFile} has a broken wikilink: [[${target}]]`,
      );
    }
  }

  console.log(`memory: ${links} vault wikilinks checked`);
}

async function main() {
  if (!existsSync(projectPath)) {
    console.error("memory: machine/project.json is missing");
    process.exit(1);
  }

  const project = JSON.parse(await readText(projectPath));

  // --- top-level shape -----------------------------------------------------
  for (const key of ["schemaVersion", "name", "updatedAt", "phase", "lastPass", "modules", "decisions"]) {
    check(`project.${key} present`, key in project, `machine/project.json is missing "${key}"`);
  }

  check("project.phase is known", PHASES.includes(project.phase), `project.phase "${project.phase}" is not a known phase`);
  check("project.updatedAt is a date", isDate(project.updatedAt), `project.updatedAt "${project.updatedAt}" is not YYYY-MM-DD`);

  // --- journal -------------------------------------------------------------
  const lastPassFile = memoryPath(project.lastPass ?? "");
  check(
    "last pass journal exists",
    project.lastPass && existsSync(lastPassFile),
    `project.lastPass points at a missing file: ${project.lastPass}`,
  );

  if (existsSync(lastPassFile)) {
    const journal = await readText(lastPassFile);
    for (const heading of ["## What changed", "## What we tried and rejected", "## Verification", "## Next"]) {
      check(
        `journal has "${heading}"`,
        journal.includes(heading),
        `${project.lastPass} is missing the "${heading}" section`,
      );
    }
  }

  const journalDir = path.join(memoryDir, "journal");
  const journals = existsSync(journalDir)
    ? (await readdir(journalDir)).filter((f) => f.endsWith(".md"))
    : [];
  check("journal has at least one entry", journals.length > 0, "memory/journal is empty");

  // --- modules: bidirectional link ----------------------------------------
  const modulesDir = path.join(root, "modules");
  const codeDirs = existsSync(modulesDir)
    ? (await readdir(modulesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

  const listed = new Set();
  for (const mod of project.modules ?? []) {
    const label = `module ${mod.id}`;
    if (!mod.id || !mod.name) {
      errors.push(`${label}: id and name are required`);
      continue;
    }
    listed.add(mod.codePath);

    check(
      `${label}: code exists`,
      mod.codePath && existsSync(path.join(root, mod.codePath)),
      `${label}: codePath missing on disk (${mod.codePath})`,
    );
    check(
      `${label}: spec exists`,
      mod.specPath && existsSync(memoryPath(mod.specPath)),
      `${label}: specPath missing on disk (${mod.specPath})`,
    );
    check(
      `${label}: status exists`,
      mod.statusPath && existsSync(memoryPath(mod.statusPath)),
      `${label}: statusPath missing on disk (${mod.statusPath})`,
    );
    if (mod.teachingPath) {
      check(
        `${label}: teaching doc exists`,
        existsSync(memoryPath(mod.teachingPath)),
        `${label}: teachingPath missing on disk (${mod.teachingPath})`,
      );
    }

    if (existsSync(memoryPath(mod.statusPath ?? ""))) {
      const status = await readText(memoryPath(mod.statusPath));
      check(
        `${label}: status has "## Now"`,
        status.includes("## Now"),
        `${label}: Status.md is missing a "## Now" section`,
      );
    }

    if (existsSync(memoryPath(mod.specPath ?? ""))) {
      const spec = await readText(memoryPath(mod.specPath));
      check(
        `${label}: spec names its commands`,
        (mod.commands ?? []).every((command) => spec.includes(`/${command}`)),
        `${label}: Spec.md does not document every registered command (${(mod.commands ?? []).join(", ")})`,
      );
    }
  }

  for (const dir of codeDirs) {
    check(
      `modules/${dir} is in machine memory`,
      listed.has(`modules/${dir}`),
      `modules/${dir} exists in code but is not listed in memory/machine/project.json`,
    );
  }

  const agentsPath = path.join(root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const agents = await readText(agentsPath);
    const layout = agents.match(/^modules\/\s+(.+)$/m);
    const listedModules = layout ? layout[1].split(",").map((name) => name.trim()).filter(Boolean) : [];

    for (const dir of codeDirs) {
      check(
        `AGENTS.md layout lists modules/${dir}`,
        listedModules.includes(dir),
        `AGENTS.md layout omits modules/${dir}`,
      );
    }
    for (const name of listedModules) {
      check(
        `AGENTS.md layout module ${name} exists`,
        codeDirs.includes(name),
        `AGENTS.md layout lists modules/${name}, which does not exist`,
      );
    }

    const stateDate = agents.match(/^## Current state \((\d{4}-\d{2}-\d{2})\)/m);
    check(
      "AGENTS.md current-state date matches project.updatedAt",
      stateDate?.[1] === project.updatedAt,
      `AGENTS.md says ${stateDate?.[1] ?? "<no date>"} but project.updatedAt is ${project.updatedAt}`,
    );
  }

  // --- ADRs ----------------------------------------------------------------
  const adrDir = path.join(memoryDir, "vault/03-Architecture/ADR");
  const adrFiles = existsSync(adrDir) ? (await readdir(adrDir)).filter((f) => f.endsWith(".md")) : [];
  check("ADR directory has decisions", adrFiles.length > 0, "no ADRs found");

  for (const file of adrFiles) {
    const text = await readText(path.join(adrDir, file));
    check(
      `ADR ${file} has a Status section`,
      /^## Status/m.test(text),
      `ADR ${file} is missing "## Status"`,
    );
    check(
      `ADR ${file} records rejected alternatives`,
      /^## Alternatives/m.test(text),
      `ADR ${file} is missing "## Alternatives" — the reasoning is the teaching material`,
    );
  }

  // --- machine memory ------------------------------------------------------
  await checkFeatures();
  await checkLive();
  await checkResearch();
  await checkPasses();
  await checkDecisions();
  await checkGenerated();
  await checkCurriculum();
  await checkLessons();
  await checkProseClaims();
  await checkLocalLinks();
  await checkVaultLinks();

  // --- command budget consistency -----------------------------------------
  if (project.metrics) {
    check(
      `metrics.commands within Discord's limit`,
      project.metrics.commands <= project.metrics.commandLimit,
      `project.metrics.commands (${project.metrics.commands}) exceeds ${project.metrics.commandLimit}`,
    );
  }

  // --- open questions ------------------------------------------------------
  for (const question of project.openQuestions ?? []) {
    if (question.status === "answered" && !question.answer) {
      errors.push(`${question.id} is marked answered but has no answer`);
    }
  }

  // --- report --------------------------------------------------------------
  const failed = checks.filter((c) => !c.ok);
  const label = `${checks.length - failed.length}/${checks.length} memory checks passed`;

  if (failed.length === 0) {
    console.log(`memory: ${label}`);
    for (const warning of warnings) console.log(`  warning: ${warning}`);
    if (journals.length > 0) console.log(`  latest journal: ${path.basename(project.lastPass)}`);
    return;
  }

  console.error(`memory: ${label}\n`);
  for (const failure of errors) console.error(`  x ${failure}`);
  console.error("\nFix the links or update memory/machine/project.json, then re-run `pnpm memory:check`.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("memory-check crashed:", error);
  process.exit(1);
});
