import type {
  ButtonStyle,
  SelectOption,
  V2ActionComponent,
  V2ActionRow,
  V2Button,
  V2Component,
  V2ContainerChild,
  V2Section,
  V2Select,
  V2Separator,
  V2TextDisplay,
  V2Thumbnail,
} from "@keystone/kernel";

/**
 * A panel that Discord would reject must fail here, in a test, not at runtime
 * in a guild. Every message names the offending value and the rule it broke.
 */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

export const MAX_COMPONENTS = 40;
export const MAX_TEXT = 4_000;
export const MAX_CONTAINER_CHILDREN = 10;
export const MAX_BUTTONS_PER_ROW = 5;
export const MAX_SELECT_OPTIONS = 25;

export interface Ui {
  container(
    options: { accentColor?: number; spoiler?: boolean },
    build: (box: Box) => void,
  ): void;
  text(content: string): void;
  separator(options?: { divider?: boolean; spacing?: "small" | "large" }): void;
  section(texts: string | string[], accessory?: V2Button | V2Thumbnail): void;
  actions(components: V2ActionComponent[]): void;
  button(input: {
    style: ButtonStyle;
    label: string;
    customId?: string;
    url?: string;
    disabled?: boolean;
  }): V2Button;
  select(input: {
    customId: string;
    placeholder: string;
    options: SelectOption[];
    minValues?: number;
    maxValues?: number;
    disabled?: boolean;
  }): V2Select;
  thumbnail(input: { url: string; description?: string; spoiler?: boolean }): V2Thumbnail;
}

export interface Box {
  text(content: string): void;
  separator(options?: { divider?: boolean; spacing?: "small" | "large" }): void;
  section(texts: string | string[], accessory?: V2Button | V2Thumbnail): void;
  actions(components: V2ActionComponent[]): void;
}

/**
 * Build one Components V2 layout. The builder returns a plain structural tree;
 * `apps/bot/src/adapt.ts` is the only place that knows discord.js builders.
 */
export function layout(build: (ui: Ui) => void): V2Component[] {
  const components: V2Component[] = [];
  const ui: Ui = {
    container(options, buildBox) {
      const children: V2ContainerChild[] = [];
      const box: Box = {
        text: (content) => children.push(text(content)),
        separator: (separatorOptions) => children.push(separator(separatorOptions)),
        section: (texts, accessory) => children.push(section(texts, accessory)),
        actions: (actions) => children.push(actionRow(actions)),
      };
      buildBox(box);
      if (children.length === 0) {
        throw new LayoutError("a container needs at least one child");
      }
      if (children.length > MAX_CONTAINER_CHILDREN) {
        throw new LayoutError(
          `a container holds at most ${MAX_CONTAINER_CHILDREN} children; this one has ${children.length}`,
        );
      }
      components.push({ type: "container", ...options, components: children });
    },
    text: (content) => components.push(text(content)),
    separator: (options) => components.push(separator(options)),
    section: (texts, accessory) => components.push(section(texts, accessory)),
    actions: (actions) => components.push(actionRow(actions)),
    button: (input) => makeButton(input),
    select: (input) => makeSelect(input),
    thumbnail: (input) => makeThumbnail(input),
  };

  build(ui);

  const budget = measure(components);
  if (budget.components > MAX_COMPONENTS) {
    throw new LayoutError(
      `a panel holds at most ${MAX_COMPONENTS} components; this one has ${budget.components}`,
    );
  }
  if (budget.text > MAX_TEXT) {
    throw new LayoutError(
      `a panel holds at most ${MAX_TEXT} characters of text; this one has ${budget.text}`,
    );
  }
  return components;
}

function text(content: string): V2TextDisplay {
  if (typeof content !== "string" || content.length === 0) {
    throw new LayoutError("a text display needs at least one character");
  }
  if (content.length > MAX_TEXT) {
    throw new LayoutError(`a text display holds at most ${MAX_TEXT} characters; got ${content.length}`);
  }
  return { type: "text-display", content };
}

function separator(options?: { divider?: boolean; spacing?: "small" | "large" }): V2Separator {
  return { type: "separator", ...options };
}

function section(texts: string | string[], accessory?: V2Button | V2Thumbnail): V2Section {
  const list = typeof texts === "string" ? [texts] : texts;
  if (list.length === 0 || list.length > 3) {
    throw new LayoutError(`a section holds 1-3 text displays; got ${list.length}`);
  }
  let checked: V2Button | V2Thumbnail | undefined;
  if (accessory?.type === "button") {
    if (accessory.style === "link") {
      throw new LayoutError("a section accessory button cannot be a link button");
    }
    checked = makeButton(accessory);
  } else if (accessory?.type === "thumbnail") {
    checked = makeThumbnail(accessory);
  }
  return {
    type: "section",
    texts: list.map((content) => text(content)),
    ...(checked ? { accessory: checked } : {}),
  };
}

function actionRow(components: V2ActionComponent[]): V2ActionRow {
  if (components.length === 0) {
    throw new LayoutError("an action row needs at least one component");
  }
  const select = components.find(
    (component): component is V2Select => component.type === "select",
  );
  if (select) {
    if (components.length !== 1) {
      throw new LayoutError("a select must be the only component in its action row");
    }
    return { type: "action-row", components: [makeSelect(select)] };
  }
  if (components.length > MAX_BUTTONS_PER_ROW) {
    throw new LayoutError(
      `an action row holds at most ${MAX_BUTTONS_PER_ROW} buttons; got ${components.length}`,
    );
  }
  return {
    type: "action-row",
    components: components.map((component) => makeButton(component as V2Button)),
  };
}

function makeButton(input: {
  style: ButtonStyle;
  label: string;
  customId?: string;
  url?: string;
  disabled?: boolean;
}): V2Button {
  if (typeof input.label !== "string" || input.label.length < 1 || input.label.length > 80) {
    throw new LayoutError(`a button label is 1-80 characters; got ${JSON.stringify(input.label)}`);
  }
  if (input.style === "link") {
    if (!input.url) throw new LayoutError(`a link button needs a url: ${input.label}`);
    if (input.customId) {
      throw new LayoutError(`a link button cannot carry a custom id: ${input.label}`);
    }
    return {
      type: "button",
      style: "link",
      label: input.label,
      url: input.url,
      ...(input.disabled ? { disabled: true } : {}),
    };
  }
  if (!input.customId || input.customId.length > 100) {
    throw new LayoutError(`a button custom id is 1-100 characters: ${input.label}`);
  }
  if (input.url) throw new LayoutError(`only a link button can carry a url: ${input.label}`);
  return {
    type: "button",
    style: input.style,
    label: input.label,
    customId: input.customId,
    ...(input.disabled ? { disabled: true } : {}),
  };
}

function makeSelect(input: {
  customId: string;
  placeholder: string;
  options: SelectOption[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}): V2Select {
  if (!input.customId || input.customId.length > 100) {
    throw new LayoutError("a select custom id is 1-100 characters");
  }
  if (input.options.length === 0 || input.options.length > MAX_SELECT_OPTIONS) {
    throw new LayoutError(
      `a select holds 1-${MAX_SELECT_OPTIONS} options; got ${input.options.length}`,
    );
  }
  const minValues = input.minValues ?? 0;
  const maxValues = input.maxValues ?? 1;
  if (
    !Number.isInteger(minValues) ||
    !Number.isInteger(maxValues) ||
    minValues < 0 ||
    minValues > maxValues ||
    maxValues > input.options.length ||
    maxValues > MAX_SELECT_OPTIONS
  ) {
    throw new LayoutError(
      `a select needs 0 <= minValues <= maxValues <= ${MAX_SELECT_OPTIONS}; got ${minValues}-${maxValues} for ${input.options.length} options`,
    );
  }
  return {
    type: "select",
    customId: input.customId,
    placeholder: input.placeholder,
    options: input.options.map((option) => ({ ...option })),
    minValues,
    maxValues,
    ...(input.disabled ? { disabled: true } : {}),
  };
}

function makeThumbnail(input: {
  url: string;
  description?: string;
  spoiler?: boolean;
}): V2Thumbnail {
  if (!input.url) throw new LayoutError("a thumbnail needs a url");
  return {
    type: "thumbnail",
    url: input.url,
    ...(input.description ? { description: input.description } : {}),
    ...(input.spoiler ? { spoiler: true } : {}),
  };
}

interface Budget {
  components: number;
  text: number;
}

function measure(components: readonly V2Component[]): Budget {
  let count = 0;
  let characters = 0;

  const visit = (component: V2Component | V2Button | V2Select | V2Thumbnail): void => {
    count += 1;
    switch (component.type) {
      case "container":
        for (const child of component.components) visit(child);
        return;
      case "text-display":
        characters += component.content.length;
        return;
      case "separator":
      case "thumbnail":
        return;
      case "button":
        characters += component.label.length;
        return;
      case "select":
        count += component.options.length;
        return;
      case "section":
        for (const entry of component.texts) visit(entry);
        if (component.accessory) visit(component.accessory);
        return;
      case "action-row":
        for (const entry of component.components) visit(entry);
        return;
    }
  };

  for (const component of components) visit(component);
  return { components: count, text: characters };
}
