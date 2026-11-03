import type { V2Component } from "@keystone/kernel";
import { DEFAULT_LOCALE, t } from "@keystone/i18n";
import { layout } from "@keystone/ui";

/**
 * The community module's V2 surfaces. Each builder returns a structural tree;
 * `apps/bot/src/adapt.ts` is the only file that knows discord.js. The data
 * (level, XP, rank, substituted greeting text) is passed in, never computed
 * here, so the card and the command read the same service rows.
 */
export interface RankCardInput {
  readonly userId: string;
  readonly level: number;
  readonly xp: number;
  /** Absent when the member has no leaderboard position yet. */
  readonly rank?: number;
}

export function rankPanel(input: RankCardInput, locale: string = DEFAULT_LOCALE): V2Component[] {
  return layout((ui) => {
    ui.container({ accentColor: 0x5865f2 }, (box) => {
      box.text(`## <@${input.userId}>`);
      box.text(t(locale, "rank.line", input.level, input.xp, input.rank));
      box.separator();
      box.text(t(locale, "rank.footer"));
    });
  });
}

/**
 * A greeting is one operator-authored string with `{user}` and `{server}`
 * already substituted. It is not translated: the text belongs to the guild, so
 * the catalog has no key for it.
 */
export function greetingPanel(text: string): V2Component[] {
  return layout((ui) => {
    ui.container({ accentColor: 0x57f287 }, (box) => {
      box.text(text);
    });
  });
}

export interface TicketPanelInput {
  /** A signed id minted by the bot; the module never signs. */
  readonly openCustomId: string;
  /** Operator-chosen panel title; the catalog supplies the default. */
  readonly title?: string;
}

/** Long enough for a pinned support panel; an old id is still refused. */
export const TICKET_PANEL_TTL_MS = 30 * 24 * 60 * 60_000;

export function ticketPanel(
  input: TicketPanelInput,
  locale: string = DEFAULT_LOCALE,
): V2Component[] {
  return layout((ui) => {
    ui.container({ accentColor: 0x5865f2 }, (box) => {
      box.text(`## ${(input.title ?? t(locale, "ticket.panel.title")).slice(0, 200)}`);
      box.text(t(locale, "ticket.panel.description"));
      box.actions([
        ui.button({
          style: "primary",
          label: t(locale, "ticket.panel.open"),
          customId: input.openCustomId,
        }),
      ]);
    });
  });
}
