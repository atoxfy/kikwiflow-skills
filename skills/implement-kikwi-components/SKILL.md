---
name: implement-kikwi-components
description: >
  Turns a Kikwiflow .kikwi file's dangling executor/providerBean references — typically the
  "Components to implement" list a model-kikwi-process delivery hands back — into real Java classes:
  TaskHandler, AnswerProvider, DueDateProvider, or CorrelationKeysProvider, registered as the exact
  named Spring bean the .kikwi file references, plus an isolated unit test per class. Never edits the
  .kikwi file itself — same read-only-input discipline as beautify-kikwi-diagram, mirrored onto source
  code instead of layout. Never invents unstated business logic: where the spec/model only names a
  decision without saying how to make it, the generated code compiles and wires correctly but flags
  the missing rule explicitly instead of guessing one. Trigger this skill when asked to "implement this
  process's handlers", "generate the TaskHandler for...", "wire up the beans this .kikwi needs", or
  "implement the components [a model-kikwi-process delivery] listed".
---

# Skill: Implement a Kikwiflow process's missing Java components

> See also: [`model-kikwi-process`](../model-kikwi-process/SKILL.md) — this skill's usual input source
> (its Step 7 delivery includes a "Components to implement" list this skill turns into real code) — and
> [`beautify-kikwi-diagram`](../beautify-kikwi-diagram/SKILL.md), an independent follow-up pass on the
> same `.kikwi` file. The two don't interact and can run in either order: this skill only ever writes
> Java source, never touches the `.kikwi` file's `layout` or any other field; `beautify-kikwi-diagram`
> only ever touches `layout`.
>
> **Not for `document-java-as-kikwi` output.** That skill's `executor`/`providerBean` values are
> descriptive labels pointing back at *existing* code, never meant to resolve to a real bean — running
> this skill against its output would be inventing new production code for a file whose entire purpose
> is documenting code that's already there. Only run this against `model-kikwi-process` output, or a
> hand-written `.kikwi` that's genuinely meant to deploy.

## Why this is a separate skill, and its golden rule

`model-kikwi-process` already tries to resolve `executor`/`providerBean` against beans that exist in the
target project (its Step 4), and lists what doesn't resolve as a concrete TODO rather than gloss over it
(its Step 7). This skill is what closes that TODO list — but it's the first skill in this set that
writes to the target project's actual source tree instead of only producing/editing a `.kikwi` file, so
it carries a different, higher-stakes golden rule:

**Wire correctly, guess nothing.** A `.kikwi` file (or the natural-language spec behind it) almost never
states a business rule with enough precision to hand-write it blind — it says *what* decision a gateway
makes ("classify the customer's risk"), not the exact threshold; *that* a task validates something, not
every field/format rule involved. This skill's job is to produce a class that **compiles, is registered
under the exact right bean name, and reads/writes the exact right variable names** — and, wherever the
actual business logic isn't stated anywhere available to you, leave it as an explicit, impossible-to-miss
`TODO` (a thrown `UnsupportedOperationException` with a message naming exactly what's missing is the
recommended shape — see Step 4) rather than inventing a plausible-looking condition and shipping it as if
it were real. A generated class that quietly guesses wrong is worse than one that fails loudly with a
clear next step, because the former looks done and isn't.

## Step 1 — Build the work list

Two ways to arrive here:

- **From a `model-kikwi-process` delivery**: start directly from its "Components to implement" list —
  it already has the bean name, the node(s) referencing it, and which interface it needs.
- **From a bare `.kikwi` file**: scan every node's `executor` (on `EXECUTABLE_TASK`) and `providerBean`
  (on any node with `providerType: BEAN`), then check the target Spring project for an existing
  `@Component("<that exact name>")` implementing the right interface (see Step 2's table). Anything that
  doesn't resolve — or resolves to a bean implementing the *wrong* interface — goes on the work list.

**`providerVariable` entries need no Java class** — they're read from a process variable set by an
earlier node, not resolved by a bean. If a variable a node depends on doesn't appear to be set anywhere
in the process or the surrounding code, that's a real gap, but a different one: flag it in the delivery
(Step 7) instead of trying to "implement" it.

**Never silently overwrite an existing bean.** If a bean with the target name already exists but
implements a different interface, or its logic looks unrelated to what the node needs, stop and flag the
conflict instead of replacing it — that's very likely a naming collision with unrelated code, not a
stale implementation to clobber.

---

## Step 2 — The four contracts

Every `providerType: BEAN` reference and every `EXECUTABLE_TASK.executor` maps to exactly one of these
four interfaces, based on the node type (and, for gateways/timers/correlation nodes, the field the bean
name came from):

| Node / field | Interface | Method | Bean field |
|---|---|---|---|
| `EXECUTABLE_TASK.executor` | `TaskHandler` | `void handle(ExecutionContext execution)` | `executor` |
| `EXCLUSIVE_GATEWAY.providerBean` (`providerType: BEAN`) | `AnswerProvider` | `String resolve(EvaluationContext context)` | `providerBean` |
| `BOUNDARY_INTERRUPTIVE_TIMER.providerBean` / `TIMER_TASK.providerBean` (`providerType: BEAN`) | `DueDateProvider` | `String resolve(EvaluationContext execution)` | `providerBean` |
| `EVENT_CATCHER.providerBean` / `EVENT_THROWER.providerBean` / `BOUNDARY_INTERRUPTIVE_CATCH_EVENT.providerBean` (`providerType: BEAN`) | `CorrelationKeysProvider` | `List<CorrelationItem> resolveCorrelationItems(EvaluationContext context)` | `providerBean` |

### `ExecutionContext` vs. `EvaluationContext` — the detail most likely to break a build

**`TaskHandler` is the only one of the four that can mutate process variables**, and it's the only one
that receives `ExecutionContext`, not `EvaluationContext` — mixing these up doesn't compile:

```java
// TaskHandler — read/write, wrapped values
public interface TaskHandler {
    void handle(ExecutionContext execution);
}
public interface ExecutionContext {
    void setVariable(String variableName, ProcessVariable value);
    void removeVariable(String variableName);
    ProcessVariable getVariable(String variableName);   // wrapped — unwrap via .value()
    boolean hasVariable(String variableName);
    String getProcessInstanceId();
    FlowNodeDefinition getFlowNode();
}

// AnswerProvider / DueDateProvider / CorrelationKeysProvider — read-only, unwrapped values
public interface EvaluationContext {
    Optional<Object> getVariableValue(String variableName);  // already unwrapped
}
```

`AnswerProvider`, `DueDateProvider`, and `CorrelationKeysProvider` all take `EvaluationContext` and have
no way to write a variable at all — if the logic you're generating seems to need to persist something,
that's a sign the node type is wrong (or that write belongs in an upstream `EXECUTABLE_TASK` instead),
not a signal to look for a write method that doesn't exist on the interface.

### `AnswerProvider`

```java
@FunctionalInterface
public interface AnswerProvider {
    /** Returning null is allowed, but must be handled explicitly by a handlesNull edge in the process model. */
    String resolve(EvaluationContext context);
}
```

```java
@Component("customerRiskStrategy")
public class CustomerRiskStrategy implements AnswerProvider {
    @Override
    public String resolve(EvaluationContext context) {
        double score = (double) context.getVariableValue("riskScore").orElseThrow();
        if (score > 80) return "HIGH_RISK";
        return null; // no special classification -> the gateway's isDefault edge
    }
}
```

### `DueDateProvider`

```java
public interface DueDateProvider {
    /** ISO-8601 duration ("PT1H") or absolute instant ("2026-12-25T20:00:00Z") — either is accepted,
     *  the engine tries absolute-instant parsing first and falls back to duration. */
    String resolve(EvaluationContext execution);
}
```

```java
@Component("slaCriticoBean")
public class SlaCriticoDueDateProvider implements DueDateProvider {
    @Override
    public String resolve(EvaluationContext execution) {
        boolean vip = Boolean.TRUE.equals(execution.getVariableValue("customerVip").orElse(false));
        return vip ? "PT30M" : "PT2H";
    }
}
```

### `CorrelationKeysProvider`

```java
public interface CorrelationKeysProvider {
    List<CorrelationItem> resolveCorrelationItems(EvaluationContext context);
}
// CorrelationItem(String key, String displayName) — displayName is optional/cosmetic.
```

```java
@Component("productCorrelationResolver")
public class ProductCorrelationResolver implements CorrelationKeysProvider {
    @Override
    public List<CorrelationItem> resolveCorrelationItems(EvaluationContext context) {
        List<Product> products = (List<Product>) context.getVariableValue("products").orElseThrow();
        return products.stream()
                .map(p -> new CorrelationItem("PROD_" + p.getId() + "_ACTIVATED", "Activation: " + p.getName()))
                .toList();
    }
}
```

A node whose `catchType`/behavior expects exactly one correlation key (a `STANDALONE` `EVENT_CATCHER`, an
`EVENT_THROWER`, a `BOUNDARY_INTERRUPTIVE_CATCH_EVENT`) needs a provider that resolves **exactly one**
item — resolving zero or more than one fails at runtime with `IllegalStateException`. A `GROUP`
`EVENT_CATCHER` expects one item per key it's waiting on.

### `TaskHandler`

```java
public interface TaskHandler {
    void handle(ExecutionContext execution);
}
```

```java
@Component("enrichCustomerProfileTaskHandler")
public class EnrichCustomerProfileTaskHandler implements TaskHandler {
    private final CustomerDirectory customerDirectory;

    public EnrichCustomerProfileTaskHandler(CustomerDirectory customerDirectory) {
        this.customerDirectory = customerDirectory;
    }

    @Override
    public void handle(ExecutionContext execution) {
        String taxId = execution.getVariable("taxId").value().toString();
        var profile = customerDirectory.findByTaxId(taxId);
        execution.setVariable("name", new ProcessVariable("name", profile.name()));
    }
}
```

Prefer one `TaskHandler` per business responsibility over a generic handler that branches internally by
node id — keeps every generated class trivially unit-testable in isolation (Step 6).

---

## Step 3 — Match the project's real conventions before writing anything

Search the target project for 2-3 existing classes implementing any of the four interfaces above (if
this process already has other resolved beans, or any sibling process does) and copy their shape:

- **Package location** — co-located with the domain code they call into, a dedicated `handlers`/
  `providers` package, or per-process? Follow whatever the project already does; don't invent a new
  convention.
- **Naming suffix** — `XxxTaskHandler`, `XxxAnswerProvider`, `XxxDueDateProvider`,
  `XxxCorrelationKeysProvider` are the names used above and in the Kikwiflow docs; match the project's
  own pattern if it differs.
- **Constructor injection style**, Lombok usage (`@RequiredArgsConstructor` vs. explicit constructors),
  logging conventions (a `Logger` field? structured logging?) — match what's already there.

If there's nothing to pattern-match against (greenfield project, first handler in the codebase), fall
back to the shapes shown in Step 2 — they're taken directly from the interfaces' own documentation.

---

## Step 4 — Generate the class body: wire correctly, flag what's missing

For every component on the work list:

1. **The bean annotation and class signature are never ambiguous** — `@Component("<exact executor/
   providerBean value from the .kikwi>")` implementing the interface from Step 2's table. Get this
   letter-for-letter right; `SpringTaskHandlerResolver` (and its equivalents for the other three
   interfaces) resolve by exact bean name and fail loudly if it doesn't match — but "fails loudly" here
   means a deploy-time or runtime resolution error, not a compile error, so a typo here is easy to ship
   by accident. Double-check it against the `.kikwi` field value directly, not from memory.
2. **Variable reads/writes**: if the `.kikwi` node's `description`/`kikwi:documentation`, or the spec
   text behind a `model-kikwi-process` delivery, names specific process variables the component should
   read or (for `TaskHandler` only) write, wire those exactly — variable names are just as easy to get
   subtly wrong as bean names, and a mismatch fails the same way (silently missing data, not a compile
   error).
3. **The actual decision/business rule**: implement it fully only when it's genuinely stated somewhere
   available to you (the node's own documentation, the original spec, an explicit answer from the user).
   Otherwise, generate a method body that compiles and is correctly wired, but makes the gap impossible
   to miss:

```java
@Override
public void handle(ExecutionContext execution) {
    // TODO(kikwiflow): the source spec only said "the system validates the data" — no concrete rule
    // (which fields, which format, what makes this invalid) was ever stated anywhere available to this
    // generator. Wire the real rule here before this handler is production-ready.
    throw new UnsupportedOperationException(
        "expenseValidationTaskHandler: validation rule not yet specified — see TODO above");
}
```

   A thrown `UnsupportedOperationException` naming exactly what's missing is the recommended shape for
   an undetermined rule: it fails every path through this handler immediately and loudly (impossible to
   accidentally ship as if it were finished, impossible to silently pass a test that isn't asserting the
   real behavior) instead of returning a default/`null`/no-op that looks like it works.

---

## Step 5 — Business errors: wire the `errorCode`s that are already known

If the `.kikwi` attaches one or more `BOUNDARY_ERROR_HANDLER` nodes to the `EXECUTABLE_TASK` you're
implementing, their `errorCode` values are **not** a gap — they're already fully specified by the model,
just waiting for the handler to actually throw them:

```java
public class ProcessErrorException extends RuntimeException {
    public ProcessErrorException(String errorCode, String message) { /* ... */ }
    public ProcessErrorException(String errorCode) { /* ... */ }
}
```

Generate a `throw new ProcessErrorException("<the exact declared errorCode>", "...")` at the point in
the handler where that condition would be detected — but per Step 4, if the *condition itself* that
should trigger a given `errorCode` isn't stated, mark that condition as the TODO, not the `errorCode`
string, which you already know for certain:

```java
if (/* TODO(kikwiflow): condition that should raise DOCUMENTO_INVALIDO — not stated in the spec */ false) {
    throw new ProcessErrorException("DOCUMENTO_INVALIDO", "...");
}
```

A thrown `ProcessErrorException` whose `errorCode` matches no `BOUNDARY_ERROR_HANDLER` on that task
becomes an unhandled technical incident, not a modeled business outcome — so an `errorCode` typo here has
the same "fails at runtime, not compile time" risk as a bean-name typo; copy it from the `.kikwi`
verbatim.

---

## Step 6 — Generate an isolated unit test per class

Match the target project's testing conventions (JUnit 5 is standard for Kikwiflow projects — see the
engine's own testing guide if the project ships it), and default to the style every `TaskHandler`/
provider is meant to support: mock the context, no Spring context, no engine, no I/O:

```java
class EnrichCustomerProfileTaskHandlerTest {
    @Test
    void writesProfileFieldsFromTaxId() {
        ExecutionContext execution = mock(ExecutionContext.class);
        when(execution.getVariable("taxId")).thenReturn(new ProcessVariable("taxId", "111.111.111-11"));
        when(customerDirectory.findByTaxId("111.111.111-11")).thenReturn(new Profile("Jane Doe"));

        new EnrichCustomerProfileTaskHandler(customerDirectory).handle(execution);

        verify(execution).setVariable(eq("name"), argThat(pv -> "Jane Doe".equals(pv.value())));
    }
}
```

For a class whose body is a Step 4 TODO placeholder, don't fabricate a passing assertion just to have a
green test — that would hide exactly the gap Step 4 went out of its way to surface. A minimal test that
documents the gap (or none at all, noted in the delivery instead) beats a test asserting behavior nobody
specified. This is deliberately narrower than a full engine test: verifying that a real process instance
routes through this node correctly (the flow/routing itself, not each handler's internal logic) is a
different, integration-level concern, out of scope for this skill.

---

## Step 7 — What to deliver

1. The generated Java files (one class + one test per component), placed following the conventions
   found in Step 3.
2. A summary: how many components implemented, which interface each one maps to, and confirmation that
   every bean name/variable name/`errorCode` was copied verbatim from the `.kikwi` rather than
   retyped from memory.
3. **Open TODOs** — every place a real business rule couldn't be determined and was left as a flagged
   `UnsupportedOperationException`/condition placeholder (Steps 4-5), in the same spirit as
   `model-kikwi-process`'s own "Assumptions and open questions" delivery item. Be explicit that these
   need a real answer before the process is production-ready — don't bury this in the diff.
4. Confirm the `.kikwi` file itself was not modified — this skill only ever adds Java source.
5. If you have shell access to the target project, run its existing build/test command over just the new
   files to confirm they actually compile before calling the delivery done — don't just assert they do.

---

## Reference example

[`examples/ExpenseValidationTaskHandler.java`](examples/ExpenseValidationTaskHandler.java) and its test
implement the one dangling component from `model-kikwi-process`'s own
[`expense-approval.kikwi.json`](../model-kikwi-process/examples/expense-approval.kikwi.json) example (see
the [repo tutorial](../../TUTORIAL.md) for the full delivery that names it). That file's `VALIDATE` node
has an empty `description` — the spec behind it only ever said "the system validates the data," with no
stated rule — so the example deliberately takes the Step 4 TODO path rather than inventing a plausible
validation rule, to illustrate the "wire correctly, guess nothing" discipline concretely instead of only
in prose.

## Where the ground truth lives

The four interface signatures above (`TaskHandler`, `AnswerProvider`, `DueDateProvider`,
`CorrelationKeysProvider`), `ExecutionContext`/`EvaluationContext`, and `ProcessErrorException` are
transcribed from the Kikwiflow engine's own developer guide (its "Tarefas Executáveis", "Decisões e
Gateways", "Timers e Prazos", "EVENT_CATCHER — Correlação de Eventos", and "Tratando Erros de Negócio"
pages), not reconstructed from the `.kikwi` schema alone — if that documentation site's source is
available for cross-checking, it's the authoritative tie-breaker over anything written here, the same way
`model-kikwi-process` defers to `kikwi-model`/`kikwi-core` directly when available.
