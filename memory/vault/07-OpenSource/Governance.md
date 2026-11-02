# Governance

## Model

**Maintainer-led, with a public decision trail.** Not a foundation, not a
consensus-of-everyone. The project needs to be able to say no quickly; that is
what keeps an all-in-one bot from becoming an unreviewed plugin bazaar.

## Roles

| Role | Can | How you get it |
| --- | --- | --- |
| Contributor | Open issues and PRs | Show up |
| Reviewer | Approve module PRs in one area | 3+ merged modules, trusted judgement |
| Maintainer | Merge anything, cut releases, change the contract | Invitation by existing maintainers |
| Owner | Final call on licence, hosting, security | Current owner names a successor |

## Decisions

- **Small:** a PR review comment. No ceremony.
- **Contract-level** (`CommandContext`, `ModuleManifest`, `InteractionLike`,
  licence, data model): an ADR in `03-Architecture/ADR/`, with **Alternatives**
  filled in, merged before the code.
- **Disputed:** the owner decides, and the ADR records the disagreement. "We
  decided" without "what we rejected" is not a decision record.

## No CLA, no copyright assignment

Contributions are accepted under the project licence, AGPL-3.0-or-later (see
[LICENSE](../../../LICENSE)). We do not ask contributors to assign copyright or
grant relicensing rights — that requirement is a documented reason people stop
contributing to projects like NadekoBot.

The trade-off is explicit: without a CLA, the project cannot unilaterally
relicense to a proprietary licence later. That is a feature.

## Money, if it ever exists

- Hosting revenue funds infrastructure and, when it can, maintainers.
- No feature is ever moved from free to paid. See [[Non-Negotiables]].
- Donations do not buy roadmap priority. They buy gratitude.

## Bus factor

Named maintainers, documented runbooks, and a self-host path that does not need
us. If the owner disappears, the code and the docs are enough to continue — that
is the whole point of [[Mission]].

## Succession

The owner names a successor publicly (a pinned issue) before v1.0, as
[GOVERNANCE.md](../../../GOVERNANCE.md) records. If none is named and the owner
is unreachable for 90 days, maintainers may fork the project publicly and
continue under the same licence.
