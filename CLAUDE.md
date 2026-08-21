# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A content-only repository: four portable [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
(Markdown + YAML frontmatter, no code, no build system) for working with
[Kikwiflow](https://kikwiflow.io) process definitions (`.kikwi` files — JSON graphs of nodes, each
node's logic a plain Java bean referenced by name; no BPMN XML, no embedded expression language).
Each skill lives at `skills/<name>/SKILL.md`, which is the Claude Code auto-discovery layout — the
whole `skills/` directory is meant to be copied as-is into a target project's `.claude/skills/` (or
`~/.claude/skills/` for personal use across projects).

Each skill folder follows the same progressive-disclosure layout:

```
skills/<name>/
  SKILL.md              # entry point: frontmatter + always-relevant steps
  reference/*.md         # dense lookup material, pulled in only when a step needs it
                          # (only model-kikwi-process and document-java-as-kikwi have this —
                          #  beautify-kikwi-diagram and implement-kikwi-components are already lean)
  examples/*.kikwi.json  # a complete, valid file to use as a formatting template
                          # (implement-kikwi-components has examples/*.java instead — see below)
```

`schemas/kikwi-deploy.schema.json` and `schemas/kikwi-docs.schema.json` are structural JSON Schemas
(one per output flavor) that catch shape mistakes in a `.kikwi` file — not a substitute for each
skill's `reference/validation-checklist.md`, just a fast first filter. `TUTORIAL.md` (mirrored in Portuguese at `TUTORIAL.pt-br.md` — keep both in sync on edits) is a
worked prompt → output walkthrough per skill, including the `model-kikwi-process` →
`beautify-kikwi-diagram` handoff applied to a real file.

The only thing to "test" here is that `examples/*.kikwi.json` stay valid JSON and validate against
their schema after an edit:

```bash
python3 -c "import json; json.load(open('path/to/file.kikwi.json'))"
python3 -c "
import json, jsonschema
schema = json.load(open('schemas/kikwi-deploy.schema.json'))  # or kikwi-docs.schema.json
doc = json.load(open('path/to/file.kikwi.json'))
jsonschema.validate(doc, schema)
"
```

Otherwise, "working in this repo" means editing `SKILL.md`/`reference/*.md` prose and JSON/Java examples
and keeping the four skills consistent with each other, with `TUTORIAL.md`, and with `README.md`.

## The four skills and how they fit together

| Skill | Starts from | Produces |
|---|---|---|
| `model-kikwi-process` | a natural-language spec (user story, requirements) | a **deployable** `.kikwi` — exact engine field names (`ProcessDefinitionDeployRequest`/`FlowNodeDefinition` from `kikwi-model`), real bean resolution, deploy-validation checklist |
| `document-java-as-kikwi` | an **existing Java project** | a documentation-only `.kikwi` — never deployed, rich per-node `kikwi:documentation` (real code excerpts, Mermaid diagrams) |
| `beautify-kikwi-diagram` | an already-correct `.kikwi` from either skill above | the same graph with computed `layout` coordinates only — never touches business/schema fields |
| `implement-kikwi-components` | `model-kikwi-process`'s "components to implement" list (or a bare `.kikwi`'s dangling `executor`/`providerBean` refs) | real `TaskHandler`/`AnswerProvider`/`DueDateProvider`/`CorrelationKeysProvider` Java classes + unit tests — never touches the `.kikwi` |

`model-kikwi-process` and `document-java-as-kikwi` are mirror images (intent → runnable process vs.
existing code → read-only diagram). Both deliberately leave every node's `layout` zeroed and hand
off to `beautify-kikwi-diagram` as a separate final pass — mixing "is this graph correct" with
"does this look good" in one pass is what produces mistakes in both. Don't add layout/coordinate
guidance to the two construction skills; that's `beautify-kikwi-diagram`'s job alone.
`implement-kikwi-components` is a second, independent follow-up to `model-kikwi-process` only (never
`document-java-as-kikwi` — its `executor`/`providerBean` values are descriptive labels, not real
references) — it can run before, after, or interleaved with `beautify-kikwi-diagram` since the two
never touch the same artifact.

## Editing conventions (keeping the four skills coherent)

- **Shared vocabulary.** All four skills use the same 15 `.kikwi` node types (`DEFAULT_START_EVENT`,
  `DEFAULT_END_EVENT`, `EXECUTABLE_TASK`, `EXTERNAL_TASK`, `EXCLUSIVE_GATEWAY`, `PARALLEL_GATEWAY`,
  `JOIN_GATEWAY`, `BOUNDARY_INTERRUPTIVE_TIMER`, `BOUNDARY_NON_INTERRUPTIVE_TIMER`,
  `BOUNDARY_ERROR_HANDLER`, `BOUNDARY_INTERRUPTIVE_CATCH_EVENT`, `TIMER_TASK`, `EVENT_CATCHER`,
  `EVENT_THROWER`, `CALL_ACTIVITY_COORDINATOR`) and the same rule that business errors are modeled
  as a `BOUNDARY_ERROR_HANDLER` attached to the failing task (one handler per `errorCode`), **never**
  as an `EXCLUSIVE_GATEWAY` switching on a failure reason — a gateway can only route on a value that
  was already successfully computed. If you add a node type or change a validation rule, update
  every skill that references it, not just one.
- **`kikwi:documentation` / `kikwi:documentationLink`** are the two reserved `extensionProperties`
  keys for rich per-node docs (Markdown + Mermaid), mutually exclusive in the modeler's editing UI —
  keep their semantics identical across all four skills.
- **`implement-kikwi-components` is the only skill that writes to the target project's source tree**;
  its golden rule ("wire correctly, guess nothing" — see its SKILL.md) is deliberately stricter than
  the other three's gap-handling language, because a generated Java class that silently guesses wrong
  is a shipped bug, not just a documented assumption. Its node-type → interface table
  (`TaskHandler`/`AnswerProvider`/`DueDateProvider`/`CorrelationKeysProvider`) and the
  `ExecutionContext`-vs-`EvaluationContext` distinction must stay in sync with `model-kikwi-process`'s
  own `providerType: BEAN` guidance if either changes.
- **Deliberate schema divergence between the two construction skills is intentional, not a bug**:
  `model-kikwi-process`'s `outgoing` (`SequenceFlowDefinition`) has no `transitionType` and no
  per-edge `extensionProperties` (its output must actually deploy, so it follows the engine's real
  deserialization records); `document-java-as-kikwi`'s `outgoing` keeps both fields (its output is
  never deployed, so there's no cost to the extra descriptive fields). Don't "fix" this to make the
  two match.
- **Cross-links use relative paths** (`../<skill-name>/SKILL.md`) so the repo works both as a
  standalone clone and once copied into a `.claude/skills/` directory elsewhere — don't switch these
  to absolute URLs.
- **`SKILL.md` stays lean; `reference/` holds per-node-type/checklist lookup material.** Each
  construction skill's `SKILL.md` points to its own `reference/node-types.md` and
  `reference/validation-checklist.md` rather than inlining the full 15-type catalog and checklist —
  keep that split when editing; don't paste reference content back into `SKILL.md`.
- **`examples/*.kikwi.json` and `schemas/*.schema.json` must stay valid and in sync.** If a rule
  change makes an example non-representative (a field renamed, a new required field), update the
  example and, if the shape changed, the corresponding schema in `schemas/` — validate both (see
  above) before considering the edit done.
- **Ground truth for `model-kikwi-process`** (field names, deploy-validator behavior) is
  `kikwi-model`'s `record`s and `kikwi-core`'s `DeployValidator` in the Kikwiflow engine repo, not
  prose docs under `docs/` (which are known to drift) — that skill's own "Where the ground truth
  lives" section explains the split between tier-A (deploy-enforced) and tier-B (unenforced but
  still breaks at runtime) validation rules. Preserve that split when editing it.
- **Output language** in generated `.kikwi` files follows the input spec's/project's language, not a
  fixed default — this is called out explicitly in both construction skills and should stay that way.

## When adding or changing a skill

Each `SKILL.md`'s YAML frontmatter `description` is what Claude Code uses to decide when the skill
is relevant — no separate registration step. Keep the frontmatter `description` accurate to trigger
phrasing (the README's table of "Typical trigger phrases" should stay in sync with each skill's
frontmatter). If you touch `README.md`'s skill table, architecture diagram, or "Keeping these skills
coherent" section, verify the corresponding `SKILL.md` still matches what's claimed there.
