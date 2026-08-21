<p align="center">
  <img src="assets/logo.svg" alt="Kikwiflow logo" width="120" />
</p>

# kikwiflow-skills

Agent Skills for working with [Kikwiflow](https://kikwiflow.io) process definitions (`.kikwi` files) —
turning a natural-language spec into a deployable process, turning existing Java code into a
documentation diagram, and laying either one out for a human to read. Written as portable
[Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
(Markdown + YAML frontmatter), usable with Claude Code, Devin, or any other agent that can load a
Markdown file into context.

## What is Kikwiflow, and what's a `.kikwi` file?

Kikwiflow is a Java process orchestration engine (workflow/BPM), with one key difference from
BPMN-based engines (Camunda, Activiti, jBPM): it has no XML and no embedded expression language.
A process is just a **graph of nodes described in JSON** — a `.kikwi` file — where each node's
logic (a decision, a task) is a plain Java bean referenced by name. A `.kikwi` file is what a
business flowchart would look like if you wrote it down as structured JSON instead of drawing it:
a start, a sequence of steps, decision points, waits on something external, error handling, and one
or more ends.

## What's in here

| Skill | Purpose | Typical trigger phrases |
|---|---|---|
| [`model-kikwi-process`](skills/model-kikwi-process/SKILL.md) | Turns a natural-language spec (a user story, a requirements doc) into a **deployable** `.kikwi` — exact engine field names, real bean resolution, deploy-validation checklist. | "model a process for...", "design the flow for...", "create a Kikwiflow process from this spec" |
| [`document-java-as-kikwi`](skills/document-java-as-kikwi/SKILL.md) | Reads an **existing Java project** and produces a `.kikwi` that documents its business flow — never deployed, rich per-node `kikwi:documentation` (real code excerpts, Mermaid diagrams). | "document this service as `.kikwi`", "map this project's order flow", "diagram how this module works" |
| [`beautify-kikwi-diagram`](skills/beautify-kikwi-diagram/SKILL.md) | Takes an already-correct `.kikwi` graph (from either skill above) and computes readable `layout` coordinates — non-overlapping cards, minimal edge crossings. Never touches business/schema fields. | "lay out this `.kikwi`", "beautify/reflow/reposition this diagram" |

New to these skills? [`TUTORIAL.md`](TUTORIAL.md) (also available [in Portuguese](TUTORIAL.pt-br.md)) walks
through one realistic prompt per skill — what each one does internally, what comes back, a genuine spec gap
being flagged instead of guessed at, and the `model-kikwi-process` → `beautify-kikwi-diagram` handoff
applied to a real file.

Each skill's `SKILL.md` is the entry point; dense lookup material (the full node type catalog, the
validation checklist) lives in that skill's `reference/` folder and is pulled in only when a step actually
needs it, and each construction skill's `examples/` folder holds a complete, valid `.kikwi` file to use as a
formatting template. [`schemas/`](schemas/) has a structural JSON Schema per output flavor
(`kikwi-deploy.schema.json` for `model-kikwi-process`, `kikwi-docs.schema.json` for
`document-java-as-kikwi`) — a fast first check, not a substitute for the reference checklist.

### How they fit together

`model-kikwi-process` and `document-java-as-kikwi` are mirror images of each other — one starts
from *intent* and produces something meant to actually run, the other starts from *existing code*
and produces a read-only diagram. Neither one computes pixel positions: both leave every node's
`layout` zeroed and hand off to `beautify-kikwi-diagram` as a separate, final pass. Run the layout
skill *after* one of the construction skills, not interleaved with it — mixing "is this graph
correct" with "does this look good" in the same pass is what produces mistakes in both.

```
        natural-language spec                 existing Java project
                │                                       │
                ▼                                       ▼
      model-kikwi-process                    document-java-as-kikwi
   (deployable, real beans)              (documentation-only, never deployed)
                │                                       │
                └───────────────────┬───────────────────┘
                                     ▼
                          beautify-kikwi-diagram
                        (layout only, same graph)
                                     │
                                     ▼
                         readable .kikwi, ready for
                          the Kikwiflow visual editor
```

## Using with Claude Code

Claude Code auto-discovers skills from a `skills/<name>/SKILL.md` layout — which is exactly how
this repo is structured, so you can copy the `skills/` directory in as-is:

- **Project-level** (this project only): copy or symlink the three folders under `skills/` into
  the target project's `.claude/skills/` directory.
- **Personal** (every project): copy them into `~/.claude/skills/` instead.

```bash
# from inside the target project
mkdir -p .claude/skills
cp -r /path/to/kikwiflow-skills/skills/* .claude/skills/
```

Claude Code reads each `SKILL.md`'s frontmatter `description` to decide when a skill is relevant —
no extra registration step needed. Once copied, just ask for what you want ("model a Kikwiflow
process for...", "document this project as `.kikwi`") and Claude will pick up the matching skill.

## Using with Devin

Devin doesn't have a fixed skill-folder convention the way Claude Code does, but it can pull any
Markdown file into context as project knowledge. Two practical options:

- **Add this repo as a knowledge source** in your Devin workspace/org settings, so `SKILL.md`
  content is available whenever a relevant request comes in.
- **Reference a specific skill directly** in a Devin Playbook or session prompt — point it at the
  raw `SKILL.md` URL (or paste the file's content) and ask Devin to follow it for the task at hand.

Either way, each `SKILL.md` is self-contained — frontmatter plus a full walkthrough — so pulling in
just the one file you need for a given task is enough; you don't need the whole repo in context.

## Keeping these skills coherent

If you're extending or adapting these skills, keep them consistent with each other:

- **Shared vocabulary.** All three skills use the same 15 `.kikwi` node types and the same
  `BOUNDARY_ERROR_HANDLER`-not-`EXCLUSIVE_GATEWAY` rule for business errors. If you add a new node
  type or change a validation rule, update it in every skill that references it, not just one.
- **`kikwi:documentation` / `kikwi:documentationLink`** are the two reserved `extensionProperties`
  keys for rich per-node docs across all three skills — keep their semantics (mutually exclusive,
  Markdown + Mermaid support) identical everywhere they're mentioned.
- **Cross-links use relative paths** (`../<skill-name>/SKILL.md`) so the repo works both as a
  standalone clone and once copied into a `.claude/skills/` directory elsewhere — don't switch
  these to absolute URLs.
- **Layout stays out of the construction skills.** Don't add coordinate-computation guidance to
  `model-kikwi-process` or `document-java-as-kikwi` — that's `beautify-kikwi-diagram`'s job,
  deliberately kept separate (see "How they fit together" above).
- **`SKILL.md` stays lean; `reference/` holds the lookup material.** The node type catalog and the
  validation checklist are large, denser tables an agent consults per-node or before delivering — not
  content it needs held in mind on every turn — so they live in each construction skill's `reference/`
  folder, pointed to from the relevant `SKILL.md` step. If you add a node type or change a checklist rule,
  update the `reference/` file (and its sibling in the other construction skill, per the point above), not
  a copy pasted back into `SKILL.md`.
- **`examples/*.kikwi.json` and `schemas/*.schema.json` must stay valid.** Each construction skill's example
  is real, standalone JSON — validate it (`python3 -c "import json; json.load(open('path'))"`) and against
  its schema in `schemas/` after editing either. If a rule change makes an example non-representative (e.g.
  a field gets renamed), update the example, not just the prose.

## Contributing

Issues and PRs welcome — especially real-world `.kikwi` examples, edge cases the checklists miss,
or reports of the engine's actual behavior diverging from what's documented here (see each skill's
"where the ground truth lives" note for how field names/validation rules were sourced).

## License

[MIT](LICENSE)
