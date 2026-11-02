import type { CaseEvent, EmbedPayload, ModerationCase } from "@keystone/kernel";

/** One case rendering used by /mod, security alerts and the review queue. */
export function caseEmbed(record: ModerationCase, title = `Case #${record.caseNumber}`): EmbedPayload {
  const fields: NonNullable<EmbedPayload["fields"]> = [
    { name: "Action", value: record.action, inline: true },
    { name: "Target", value: record.targetId, inline: true },
    { name: "State", value: record.state, inline: true },
    { name: "Actor", value: record.actorId, inline: true },
    { name: "Rule", value: record.rule ?? "manual", inline: true },
    { name: "Case", value: `#${record.caseNumber}`, inline: true },
  ];
  if (record.expiresAt) {
    const unix = Math.floor(new Date(record.expiresAt).getTime() / 1_000);
    fields.push({ name: "Expires", value: `<t:${unix}:R>`, inline: true });
  }
  return {
    title,
    description: record.reason,
    color: record.state === "open" || record.state === "pending" ? 0xfee75c : 0x5865f2,
    fields,
    footer: { text: "Case events are append-only. Appeal with /appeal or the button." },
  };
}

export interface AppealStatusEntry {
  readonly record: ModerationCase;
  readonly appeals: readonly CaseEvent[];
}

function appealMessage(event: CaseEvent): string {
  const data = event.data as { message?: unknown } | undefined;
  const message = typeof data?.message === "string" ? data.message.trim() : "";
  return message.length > 0 ? message.slice(0, 500) : "No message was included.";
}

/**
 * Appeal status is rendered from append-only `appealed` events, not from a
 * current state alone. A review may change the case state; it cannot erase the
 * fact that the member appealed.
 */
export function appealStatusEmbed(
  entries: readonly AppealStatusEntry[],
  title = "Your appeals",
): EmbedPayload {
  if (entries.length === 0) {
    return {
      title,
      description:
        "No appeal events are on record for you. Use `/appeal open case:<number>` to appeal a case against you.",
      color: 0x57f287,
      footer: { text: "Only appealed cases appear here; a case state alone is not proof of an appeal." },
    };
  }

  return {
    title,
    description:
      "Read from the append-only appeal events. A case state may change after review; the event cannot.",
    color: 0x5865f2,
    fields: entries.slice(0, 5).map((entry) => {
      const latest = entry.appeals[entry.appeals.length - 1];
      return {
        name: `#${entry.record.caseNumber} · ${entry.record.action} · ${entry.record.state}`,
        value: [
          `Appeals on record: ${entry.appeals.length}`,
          `Last filed: ${latest?.createdAt ?? "unknown"}`,
          `Message: ${latest ? appealMessage(latest) : "No message was included."}`,
        ].join("\n"),
      };
    }),
    footer: { text: "Use /appeal status case:<number> for one case." },
  };
}

export function caseListEmbed(records: readonly ModerationCase[], title: string): EmbedPayload {
  if (records.length === 0) {
    return { title, description: "No matching cases.", color: 0x57f287 };
  }
  return {
    title,
    description: records
      .map(
        (record) =>
          `**#${record.caseNumber}** · ${record.action} · <@${record.targetId}> · ${record.state}\n${record.reason}`,
      )
      .join("\n\n")
      .slice(0, 4_000),
    color: 0x5865f2,
    footer: { text: "Newest first. Use /mod case for one record." },
  };
}
