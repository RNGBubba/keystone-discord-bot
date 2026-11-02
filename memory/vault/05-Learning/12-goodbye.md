# Lesson 12 — goodbye: reuse before a second service

## The problem

Welcome and goodbye look symmetrical. It is tempting to write a second service,
a second settings object and a second event handler. The two paths then drift:
welcome gets a new placeholder or a new length cap, goodbye does not.

There is also a real asymmetry. A member who just left cannot receive a DM, and
granting or removing a role while Discord is removing the member is a race. The
copy-paste version keeps code that cannot work.

## The naive version

```ts
if (event === "join") {
  await welcome.send(member);
} else {
  await welcome.send(member); // plus a DM and a role branch
}
```

The shared call is accidental. The branches assume a live member, and the
settings object grows a second set of keys that must be kept in sync by hand.

## Our version

Read `modules/community/src/settings.ts`,
`modules/community/src/engagement.ts` and
`apps/bot/src/community-events.ts`.

- `goodbye` lives in the same `communitySettingsSchema` as `welcome`. It has
  `enabled`, an optional `channelId` and a default message; the same Zod parser
  and the same length cap apply.
- `WelcomeService.handleLeave` substitutes `{user}` and `{server}` exactly as
  `handleJoin` does, then sends one channel message. It deliberately has no
  role and no DM branch.
- `registerCommunityEvents` subscribes to `GuildMemberRemove` beside
  `GuildMemberAdd` and delegates to that service. The adapter does not know the
  template.
- `/tools goodbye` writes the settings through the normal `ctx.settings.update`
  path; `ManageGuild` is required, as it is for `/tools welcome`.
- No timer or queue is involved. The member-leave event is the trigger; there is
  nothing to schedule.

The event test emits a real `GuildMemberRemove` against the adapter and asserts
the exact configured text. A real member leaving a real guild is still
unobserved.

## Exercise

Run the focused tests:

```bash
pnpm test -- modules/community/src/community.test.ts modules/community/src/commands.test.ts apps/bot/src/community-events.test.ts
```

Open `handleLeave` and remove the `enabled`/`channelId` guard. The disabled
goodbye test now calls `sendMessage` and fails. Restore the guard. The guard is
the only thing that makes “disabled” mean disabled; there is no second switch in
the event adapter.

## What we rejected

- **A separate `GoodbyeService` and settings object.** It duplicates the
  placeholder substitution and cap, and the two copies drift. Reuse the service
  and omit the branches that cannot work.
- **DM the leaving member.** Discord does not guarantee delivery to a member who
  is no longer in the guild, and a failed DM would turn a harmless goodbye into
  an error path.
- **Grant a role on leave.** It races the gateway's own member removal. A
  leaving member has no use for a role.
- **A V2 panel now.** There is no `packages/ui`; a panel-shaped placeholder would
  promise an image pipeline the repo does not have. Text is the shipped surface.

## Check yourself

1. Where is the goodbye message validated, and why is that the same place as
   welcome?
2. Which event does the adapter subscribe to, and what does it pass to the
   service?
3. Why does `handleLeave` have no `roleId` or `dm` field to disable?
