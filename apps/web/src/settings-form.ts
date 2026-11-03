import type { ZodTypeAny } from "zod";
import { HttpError } from "./http-error";

/**
 * Turn a module's own Zod schema into a form model.
 *
 * There is no second settings schema and no hand-written per-module HTML. The
 * model is a presentation of the same schema `SettingsService` parses against,
 * so a widget can only submit a value the bot would accept, and a new setting
 * appears in the dashboard without a second edit.
 *
 * The handful of shapes in today's modules map to real widgets: boolean ->
 * checkbox, bounded number -> number input, enum -> select, string -> text or
 * textarea, primitive array -> one-per-line, length-bounded string -> textarea.
 * Records, arrays of objects and any shape without a widget fall back to a
 * schema-validated JSON box rather than being hidden.
 */

export const SECRET_SETTING_KEY = /(token|secret|password|api[_-]?key)$/i;

export type SettingsFieldKind =
  | "boolean"
  | "number"
  | "text"
  | "textarea"
  | "select"
  | "literal"
  | "lines"
  | "json";

export interface SettingsField {
  readonly path: string;
  readonly label: string;
  readonly kind: SettingsFieldKind;
  readonly value: unknown;
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number | "any";
  readonly help?: string;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly itemType?: "string" | "number";
}

export interface SettingsGroup {
  readonly path: string;
  readonly label: string;
  readonly fields: SettingsField[];
  readonly groups: SettingsGroup[];
}

export interface SettingsFormModel {
  readonly groups: SettingsGroup[];
  readonly fields: readonly SettingsField[];
  readonly rendered: readonly string[];
}

export interface SettingsIssue {
  readonly path: string;
  readonly message: string;
}

/** A schema rejection with field paths, so an HTML form can point at them. */
export class SettingsValidationError extends HttpError {
  constructor(readonly issues: readonly SettingsIssue[]) {
    super(
      400,
      `Invalid settings: ${issues
        .map((issue) => `${issue.path || "(root)"}: ${issue.message}`)
        .join("; ")}`,
      "settings_invalid",
    );
    this.name = "SettingsValidationError";
  }
}

interface ZodDefinition {
  typeName?: string;
  innerType?: ZodTypeAny;
  schema?: ZodTypeAny;
  type?: ZodTypeAny;
  valueType?: ZodTypeAny;
  values?: readonly string[];
  value?: unknown;
  defaultValue?: () => unknown;
  checks?: ReadonlyArray<{ kind: string; value?: number }>;
}

interface SchemaShape {
  shape?: Record<string, ZodTypeAny>;
}

function definition(schema: ZodTypeAny): ZodDefinition {
  return (schema as unknown as { _def: ZodDefinition })._def;
}

interface UnwrappedSchema {
  schema: ZodTypeAny;
  optional: boolean;
  nullable: boolean;
}

function unwrap(schema: ZodTypeAny): UnwrappedSchema {
  let current = schema;
  let optional = false;
  let nullable = false;

  for (;;) {
    const type = definition(current).typeName;
    if (type === "ZodOptional") {
      optional = true;
      current = definition(current).innerType as ZodTypeAny;
      continue;
    }
    if (type === "ZodNullable") {
      nullable = true;
      current = definition(current).innerType as ZodTypeAny;
      continue;
    }
    if (type === "ZodDefault") {
      current = definition(current).innerType as ZodTypeAny;
      continue;
    }
    if (type === "ZodEffects") {
      current = definition(current).schema as ZodTypeAny;
      continue;
    }
    break;
  }

  return { schema: current, optional, nullable };
}

const ACRONYMS = new Set(["id", "xp", "ai", "usd", "ms", "url", "sla", "dm", "api", "json"]);

export function labelFor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word, index) => {
      if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
      const lower = word.toLowerCase();
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    })
    .join(" ");
}

function checkValue(schema: ZodTypeAny, kind: "min" | "max" | "int"): number | undefined {
  const check = definition(schema).checks?.find((entry) => entry.kind === kind);
  return check?.value;
}

function numericBounds(schema: ZodTypeAny): { min?: number; max?: number; integer: boolean } {
  return {
    min: checkValue(schema, "min"),
    max: checkValue(schema, "max"),
    integer: definition(schema).checks?.some((entry) => entry.kind === "int") ?? false,
  };
}

function valueHelp(field: {
  kind: SettingsFieldKind;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: readonly string[];
  optional: boolean;
  nullable: boolean;
}): string {
  const parts: string[] = [];
  if (field.kind === "number") {
    if (field.min !== undefined && field.max !== undefined) {
      parts.push(`${field.integer ? "Integer" : "Number"} from ${field.min} to ${field.max}.`);
    } else if (field.min !== undefined) {
      parts.push(`${field.integer ? "Integer" : "Number"} at least ${field.min}.`);
    } else if (field.max !== undefined) {
      parts.push(`${field.integer ? "Integer" : "Number"} at most ${field.max}.`);
    }
  }
  if (field.kind === "select" && field.options) {
    parts.push(`One of: ${field.options.join(", ")}.`);
  }
  if (field.kind === "lines") parts.push("One value per line; blank lines are ignored.");
  if (field.kind === "json") parts.push("JSON, validated by this module's schema.");
  if (field.kind === "text" || field.kind === "textarea") {
    if (field.max !== undefined) parts.push(`Up to ${field.max.toLocaleString("en-US")} characters.`);
  }
  if (field.nullable) parts.push("Leave blank for none.");
  else if (field.optional) parts.push("Leave blank to clear this override.");
  return parts.join(" ");
}

function makeField(
  schema: ZodTypeAny,
  key: string,
  path: string,
  value: unknown,
  unwrapped: UnwrappedSchema,
): SettingsField {
  const inner = unwrapped.schema;
  const type = definition(inner).typeName;
  const base = {
    path,
    label: labelFor(key),
    value,
    optional: unwrapped.optional,
    nullable: unwrapped.nullable,
  };

  if (type === "ZodBoolean") {
    return { ...base, kind: "boolean", help: valueHelp({ kind: "boolean", optional: unwrapped.optional, nullable: unwrapped.nullable }) };
  }

  if (type === "ZodNumber") {
    const bounds = numericBounds(inner);
    return {
      ...base,
      kind: "number",
      ...(bounds.min !== undefined ? { min: bounds.min } : {}),
      ...(bounds.max !== undefined ? { max: bounds.max } : {}),
      step: bounds.integer ? 1 : "any",
      help: valueHelp({
        kind: "number",
        min: bounds.min,
        max: bounds.max,
        integer: bounds.integer,
        optional: unwrapped.optional,
        nullable: unwrapped.nullable,
      }),
    };
  }

  if (type === "ZodEnum") {
    const options = definition(inner).values ?? [];
    return {
      ...base,
      kind: "select",
      options,
      help: valueHelp({ kind: "select", options, optional: unwrapped.optional, nullable: unwrapped.nullable }),
    };
  }

  if (type === "ZodLiteral") {
    return { ...base, kind: "literal", help: "Fixed by this module's schema." };
  }

  if (type === "ZodArray") {
    const element = unwrap(definition(inner).type as ZodTypeAny).schema;
    const elementType = definition(element).typeName;
    if (elementType === "ZodString" || elementType === "ZodNumber") {
      const max = checkValue(element, "max");
      return {
        ...base,
        kind: "lines",
        itemType: elementType === "ZodNumber" ? "number" : "string",
        ...(max !== undefined ? { max } : {}),
        help: `${valueHelp({
          kind: "lines",
          max,
          optional: unwrapped.optional,
          nullable: unwrapped.nullable,
        })}${elementType === "ZodNumber" ? " Each line must be a number." : ""}`,
      };
    }
    return {
      ...base,
      kind: "json",
      help: valueHelp({ kind: "json", optional: unwrapped.optional, nullable: unwrapped.nullable }),
    };
  }

  if (type === "ZodString") {
    const max = checkValue(inner, "max");
    const multiline = max !== undefined && max > 200;
    return {
      ...base,
      kind: multiline ? "textarea" : "text",
      ...(max !== undefined ? { max } : {}),
      help: valueHelp({
        kind: multiline ? "textarea" : "text",
        max,
        optional: unwrapped.optional,
        nullable: unwrapped.nullable,
      }),
    };
  }

  return {
    ...base,
    kind: "json",
    help: valueHelp({ kind: "json", optional: unwrapped.optional, nullable: unwrapped.nullable }),
  };
}

function objectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  return (schema as unknown as SchemaShape).shape;
}

function buildGroup(
  schema: ZodTypeAny,
  value: unknown,
  path: string,
  label: string,
): SettingsGroup {
  const shape = objectShape(unwrap(schema).schema) ?? {};
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const fields: SettingsField[] = [];
  const groups: SettingsGroup[] = [];

  for (const [key, childSchema] of Object.entries(shape)) {
    if (SECRET_SETTING_KEY.test(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    const unwrapped = unwrap(childSchema);
    if (objectShape(unwrapped.schema)) {
      groups.push(buildGroup(childSchema, record[key], childPath, labelFor(key)));
    } else {
      fields.push(makeField(childSchema, key, childPath, record[key], unwrapped));
    }
  }

  return { path, label, fields, groups };
}

function flatten(group: SettingsGroup): SettingsField[] {
  return [
    ...group.fields,
    ...group.groups.flatMap((child) => flatten(child)),
  ];
}

export function buildSettingsForm(
  schema: ZodTypeAny,
  values: Record<string, unknown>,
): SettingsFormModel {
  const root = buildGroup(schema, values, "", "General");
  const fields = flatten(root);
  return { groups: [root], fields, rendered: fields.map((field) => field.path) };
}

export interface ParsedSettingsForm {
  readonly patch: Record<string, unknown>;
  readonly errors: ReadonlyMap<string, string>;
  readonly rendered: ReadonlySet<string> | undefined;
}

function safeParts(path: string): string[] {
  const parts = path.split(".");
  for (const part of parts) {
    if (!part || ["__proto__", "constructor", "prototype"].includes(part)) {
      throw new Error(`Unsafe settings path: ${path}`);
    }
  }
  return parts;
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = safeParts(path);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

function blankValue(field: SettingsField): unknown {
  if (field.nullable) return null;
  if (field.optional) return undefined;
  return undefined;
}

/**
 * Read a browser form back into a patch.
 *
 * `__rendered` is the form's own list of fields. It is what lets an unchecked
 * checkbox mean false without a partial request silently clearing every other
 * boolean: a field that the form did not render is left alone. A caller that
 * omits the marker (tests, a tiny partial form) gets the stricter reading that
 * only fields actually present are changed.
 */
export function parseSettingsForm(
  model: SettingsFormModel,
  params: URLSearchParams,
): ParsedSettingsForm {
  const renderedList = params.get("__rendered");
  const rendered = renderedList
    ? new Set(renderedList.split(",").filter(Boolean))
    : undefined;
  const patch: Record<string, unknown> = {};
  const errors = new Map<string, string>();

  for (const field of model.fields) {
    const active = rendered ? rendered.has(field.path) : params.has(field.path);
    if (!active) continue;

    if (field.kind === "boolean") {
      setAtPath(patch, field.path, params.has(field.path));
      continue;
    }

    if (field.kind === "literal") {
      setAtPath(patch, field.path, field.value);
      continue;
    }

    const raw = params.get(field.path) ?? "";

    if (field.kind === "number") {
      const trimmed = raw.trim();
      if (trimmed === "") {
        const value = blankValue(field);
        if (value === undefined && !field.optional && !field.nullable) {
          errors.set(field.path, "Enter a number.");
        } else {
          setAtPath(patch, field.path, value);
        }
        continue;
      }
      const value = Number(trimmed);
      if (!Number.isFinite(value)) {
        errors.set(field.path, "Enter a valid number.");
        continue;
      }
      setAtPath(patch, field.path, value);
      continue;
    }

    if (field.kind === "text" || field.kind === "textarea") {
      if (raw === "") {
        if (field.nullable) setAtPath(patch, field.path, null);
        else if (field.optional) setAtPath(patch, field.path, undefined);
        else setAtPath(patch, field.path, "");
      } else {
        setAtPath(patch, field.path, raw);
      }
      continue;
    }

    if (field.kind === "select") {
      if (raw === "") {
        if (field.nullable) setAtPath(patch, field.path, null);
        else if (field.optional) setAtPath(patch, field.path, undefined);
        else errors.set(field.path, "Choose one of the listed values.");
        continue;
      }
      if (field.options && !field.options.includes(raw)) {
        errors.set(field.path, "Choose one of the listed values.");
        continue;
      }
      setAtPath(patch, field.path, raw);
      continue;
    }

    if (field.kind === "lines") {
      const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (field.itemType === "number") {
        const numbers: number[] = [];
        let bad: string | undefined;
        for (const line of lines) {
          const value = Number(line);
          if (!Number.isFinite(value)) {
            bad = line;
            break;
          }
          numbers.push(value);
        }
        if (bad !== undefined) {
          errors.set(field.path, `"${bad}" is not a number.`);
          continue;
        }
        setAtPath(patch, field.path, numbers);
      } else {
        setAtPath(patch, field.path, lines);
      }
      continue;
    }

    // JSON fallback: records, arrays of objects and unknown shapes.
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (field.nullable) setAtPath(patch, field.path, null);
      else if (field.optional) setAtPath(patch, field.path, undefined);
      else errors.set(field.path, "Enter JSON for this field.");
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      errors.set(field.path, "That is not valid JSON.");
      continue;
    }
    setAtPath(patch, field.path, value);
  }

  return { patch, errors, rendered };
}

