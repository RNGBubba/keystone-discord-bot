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

async function checkLocalLinks() {
  const files = await listMarkdown(vaultDir);
  const rootDocs = [path.join(root, "README.md"), path.join(root, "AGENTS.md")].filter((file) => existsSync(file));
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
  await checkResearch();
  await checkPasses();
  await checkDecisions();
  await checkGenerated();
  await checkCurriculum();
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
