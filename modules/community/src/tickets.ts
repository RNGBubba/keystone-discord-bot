import { UserError } from "@keystone/kernel";
import type { CommunityActions, CommunityStore, TicketRecord } from "@keystone/kernel";
import { DEFAULT_LOCALE, t } from "@keystone/i18n";
import { ticketPanel } from "./panels";
import type { CommunitySettings } from "./settings";

export interface TicketStats {
  open: number;
  claimed: number;
  closed: number;
  averageCloseMinutes: number | null;
}

export class TicketService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Post the public panel. The button id is signed by the bot and passed in; a
   * panel is a message, so the only way to keep an old one from opening a
   * ticket is the signature's expiry, checked by the shared router.
   */
  async panel(
    guildId: string,
    channelId: string,
    openCustomId: string,
    title?: string,
    locale: string = DEFAULT_LOCALE,
  ): Promise<{ messageId: string }> {
    const result = await this.actions.sendMessage(guildId, channelId, {
      v2: ticketPanel({ openCustomId, title }, locale),
    });
    if (!result.ok || !result.id) throw new Error(result.detail ?? "Could not post ticket panel");
    return { messageId: result.id };
  }

  async open(
    guildId: string,
    openerId: string,
    parentChannelId: string,
    subject: string,
    locale: string = DEFAULT_LOCALE,
  ): Promise<TicketRecord> {
    const open = (await this.store.listTickets(guildId, {
      openerId,
      limit: 100,
    })).filter((ticket) => ticket.state !== "closed");
    if (open.length >= this.settings.tickets.maxOpenPerUser) {
      throw new UserError(
        t(locale, "ticket.open.tooMany", open.length, this.settings.tickets.maxOpenPerUser),
      );
    }

    const thread = await this.actions.createThread(
      guildId,
      parentChannelId,
      `ticket-${openerId.slice(-4)}-${this.now().toString(36)}`,
      `<@${openerId}> opened a ticket: **${subject.slice(0, 200)}**`,
    );
    if (!thread.ok || !thread.id) {
      throw new UserError(thread.detail ?? "Could not create the ticket thread.");
    }

    const ticket = await this.store.createTicket({
      guildId,
      channelId: thread.id,
      openerId,
      subject: subject.slice(0, 500),
      slaDueAt: new Date(this.now() + this.settings.tickets.slaMinutes * 60_000).toISOString(),
    });
    await this.store.appendTicketEvent(guildId, ticket.id, "opened", openerId, {
      subject: ticket.subject,
    });
    await this.actions.sendMessage(guildId, ticket.channelId, {
      content: `Ticket opened. A support member will claim it; use \`/ticket close\` when resolved.`,
    });
    return ticket;
  }

  async claim(guildId: string, ticketId: string, userId: string): Promise<TicketRecord> {
    const ticket = await this.store.getTicket(guildId, ticketId);
    if (!ticket) throw new UserError("That ticket does not exist.");
    if (ticket.state === "closed") throw new UserError("That ticket is closed.");
    const updated = await this.store.updateTicket(guildId, ticketId, {
      claimerId: userId,
      state: "claimed",
    });
    if (!updated) throw new UserError("Could not claim that ticket.");
    await this.store.appendTicketEvent(guildId, ticketId, "claimed", userId);
    return updated;
  }

  async close(guildId: string, ticketId: string, userId: string): Promise<TicketRecord> {
    const ticket = await this.store.getTicket(guildId, ticketId);
    if (!ticket) throw new UserError("That ticket does not exist.");
    if (ticket.state === "closed") throw new UserError("That ticket is already closed.");
    const updated = await this.store.updateTicket(guildId, ticketId, {
      state: "closed",
      closedAt: new Date(this.now()).toISOString(),
    });
    if (!updated) throw new UserError("Could not close that ticket.");
    await this.store.appendTicketEvent(guildId, ticketId, "closed", userId);
    await this.actions.sendMessage(guildId, ticket.channelId, {
      content: `Ticket closed by <@${userId}>. The transcript remains in the ticket record.`,
    });
    await this.actions.closeThread(guildId, ticket.channelId, "Ticket closed");
    return updated;
  }

  async addParticipant(
    guildId: string,
    ticketId: string,
    actorId: string,
    userId: string,
  ): Promise<void> {
    const ticket = await this.store.getTicket(guildId, ticketId);
    if (!ticket) throw new UserError("That ticket does not exist.");
    await this.store.appendTicketEvent(guildId, ticketId, "participant.added", actorId, {
      userId,
    });
    await this.actions.sendMessage(guildId, ticket.channelId, {
      content: `<@${userId}> was added to this ticket by <@${actorId}>.`,
    });
  }

  async appendMessage(
    guildId: string,
    ticketId: string,
    userId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    const ticket = await this.store.getTicket(guildId, ticketId);
    if (!ticket) return;
    await this.store.putRecord(guildId, "ticket_message", `${ticketId}:${messageId}`, {
      ticketId,
      userId,
      content: content.slice(0, 1_500),
      createdAt: new Date(this.now()).toISOString(),
    });
  }

  async transcript(
    guildId: string,
    ticketId: string,
  ): Promise<{ ticket: TicketRecord; text: string }> {
    const ticket = await this.store.getTicket(guildId, ticketId);
    if (!ticket) throw new UserError("That ticket does not exist.");
    const events = await this.store.listTicketEvents(guildId, ticketId);
    const messages = (await this.store.listRecords<{
      ticketId: string;
      userId: string;
      content: string;
      createdAt: string;
    }>(guildId, "ticket_message", 100)).filter((record) => record.data.ticketId === ticketId);

    const lines = [
      `Ticket ${ticket.id} · ${ticket.subject}`,
      `Opened by ${ticket.openerId} · state ${ticket.state}`,
      "",
      ...events.map((event) => `[${event.createdAt}] ${event.type}${event.actorId ? ` by ${event.actorId}` : ""}`),
      "",
      ...messages.map(
        (record) =>
          `[${record.data.createdAt}] ${record.data.userId}: ${record.data.content}`,
      ),
    ];
    return { ticket, text: lines.join("\n").slice(0, 6_000) };
  }

  async stats(guildId: string): Promise<TicketStats> {
    const tickets = await this.store.listTickets(guildId, { limit: 100 });
    const closed = tickets.filter((ticket) => ticket.state === "closed");
    const durations = closed
      .filter((ticket) => ticket.closedAt)
      .map(
        (ticket) =>
          (new Date(ticket.closedAt as string).getTime() -
            new Date(ticket.createdAt).getTime()) /
          60_000,
      );
    return {
      open: tickets.filter((ticket) => ticket.state === "open").length,
      claimed: tickets.filter((ticket) => ticket.state === "claimed").length,
      closed: closed.length,
      averageCloseMinutes:
        durations.length > 0
          ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
          : null,
    };
  }
}
