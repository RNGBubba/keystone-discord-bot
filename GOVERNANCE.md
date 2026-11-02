# Governance

**Maintainer-led, with a public decision trail.** Not a foundation, not a
consensus of everyone. The project must be able to say no quickly; that is what
keeps an all-in-one bot from becoming an unreviewed plugin bazaar.

The reasoning and history live in
[memory/vault/07-OpenSource/Governance.md](memory/vault/07-OpenSource/Governance.md).

## Roles

| Role | Can | How you get it |
| --- | --- | --- |
| Contributor | Open issues and pull requests | Show up |
| Reviewer | Approve module pull requests in one area | Several merged modules and trusted judgement |
| Maintainer | Merge anything, cut releases, change the contract | Invitation by existing maintainers |
| Owner | Final call on licence, hosting and security | The current owner names a successor |

## Decisions

- **Small:** a pull-request review comment. No ceremony.
- **Contract-level** (`CommandContext`, `ModuleManifest`, `InteractionLike`,
  licence, data model): an ADR in
  `memory/vault/03-Architecture/ADR/`, with **Alternatives** filled in, merged
  before the code.
- **Disputed:** the owner decides, and the ADR records the disagreement. "We
  decided" without "what we rejected" is not a decision record.

## Licence and contributions

Keystone is **AGPL-3.0-or-later**. There is no CLA and no copyright assignment:
contributions are inbound=outbound. The trade-off is explicit — the project
cannot unilaterally relicense to a proprietary licence later. That is a feature.

## Money

- Hosting revenue, if it ever exists, funds infrastructure and maintainers.
- No feature is moved from free to paid.
- Donations do not buy roadmap priority.

## Bus factor and succession

The code and the documentation must be enough to continue without any one
person. Named maintainers, runbooks and a self-host path are part of the
product, not extras.

The owner names a successor publicly (a pinned issue) before v1.0. If no
successor is named and the owner is unreachable for 90 days, maintainers may
fork the project publicly and continue under the same licence.

Changes to this document follow the contract-level decision rule above.
