# Tutorial: exemplos de prompts e resultados esperados

*[Read this in English](TUTORIAL.md)*

Este tutorial percorre um prompt realista por skill (dois para a `model-kikwi-process`, um por modo), o que
a skill realmente faz com ele internamente, e o que volta como resultado — incluindo comportamentos mais
fáceis de passar batido só lendo os `SKILL.md`: uma skill de construção sinalizando uma lacuna genuína do
input em vez de inventar uma resposta, o modo rascunho da `model-kikwi-process` deixando campos técnicos de
fora inteiramente em vez de chutá-los, e as passagens deliberadas em várias etapas de uma skill de
construção para a `beautify-kikwi-diagram`/`implement-kikwi-components`. Os arquivos completos referenciados
abaixo vivem na pasta `examples/` de cada skill — este documento só mostra trechos.

Pré-requisito: copie `skills/` para `.claude/skills/` no projeto alvo (veja [`README.md`](README.md) para os
passos exatos) para que o Claude Code descubra as skills.

---

## 1. `model-kikwi-process` — spec → processo implantável

### Prompt

> "Modele um processo Kikwiflow para o nosso fluxo de aprovação de despesas: um funcionário envia um
> relatório de despesas, o sistema valida os dados, e então é encaminhado para o gestor do funcionário
> aprovar. Se o gestor não responder em 48 horas, escale para o time financeiro revisar."

### O que a skill faz com isso

1. O **Step 1** percorre a frase e mapeia cada indício de linguagem de negócio para um tipo de nó: "envia" →
   `DEFAULT_START_EVENT`, "o sistema valida" → `EXECUTABLE_TASK`, "encaminhado para o gestor aprovar" →
   `EXTERNAL_TASK`, "não responder em 48 horas, escale" → `BOUNDARY_INTERRUPTIVE_TIMER` anexado a esse
   `EXTERNAL_TASK`.
2. Antes de finalizar, ela roda a checagem **"lidar com lacunas explicitamente"** do Step 1. Essa spec
   descreve o que acontece no timeout, mas nunca diz o que acontece se o gestor explicitamente *rejeitar* a
   despesa — só o silêncio é tratado. Essa é uma lacuna estrutural (muda o que o processo de fato faz),
   então a skill ou faz uma pergunta de esclarecimento, ou — rodando de forma autônoma — modela só o que a
   spec sustenta e sinaliza a lacuna com destaque nas notas de entrega, em vez de inventar um caminho de
   rejeição.
3. Os **Steps 2–4** produzem os nomes exatos de campo do engine e tentam resolver
   `executor: expenseValidationTaskHandler` contra um bean `TaskHandler` real no projeto alvo (ou listá-lo
   como componente a implementar, se nenhum existir).
4. O **Step 5** deixa todo `layout` zerado — isso é trabalho da `beautify-kikwi-diagram`, não desta skill.

### Resultado (trecho)

Arquivo completo: [`skills/model-kikwi-process/examples/expense-approval.kikwi.json`](skills/model-kikwi-process/examples/expense-approval.kikwi.json)

```json
"AWAIT_APPROVAL": {
  "id": "AWAIT_APPROVAL", "name": "Await Manager Approval", "type": "EXTERNAL_TASK",
  "commitBefore": true, "commitAfter": false,
  "outgoing": [{ "id": "flow-3", "targetNodeId": "APPROVED", "isDefault": false, "handlesNull": false, "name": "", "description": "" }],
  "boundaryEventIds": ["ESCALATE_TIMER"],
  "extensionProperties": {}, "layout": { "x": 0, "y": 0 }
},
"ESCALATE_TIMER": {
  "id": "ESCALATE_TIMER", "name": "48h No Response", "type": "BOUNDARY_INTERRUPTIVE_TIMER",
  "attachedToRef": "AWAIT_APPROVAL", "providerType": "STATIC", "staticValue": "PT48H",
  "outgoing": [{ "id": "flow-4", "targetNodeId": "AWAIT_FINANCE_REVIEW", "isDefault": false, "handlesNull": false, "name": "", "description": "" }],
  "commitBefore": false, "commitAfter": false, "extensionProperties": {}, "layout": { "x": 0, "y": 0 }
}
```

### O que acompanha o arquivo

Segundo o Step 7, a entrega não é só o JSON — é o arquivo mais:

- **Componentes a implementar**: `expenseValidationTaskHandler` (precisa de um bean `TaskHandler`), caso
  nenhum bean correspondente tenha sido encontrado no projeto alvo.
- **Premissas e questões em aberto**: *"a spec nunca declara o que acontece se o gestor explicitamente
  rejeitar a despesa — só o timeout de não-resposta está modelado; confirmar se um caminho de rejeição é
  necessário."*
- Confirmação de que a `beautify-kikwi-diagram` ainda precisa rodar — veja a §4 abaixo.

Esse é o ponto de a skill sinalizar lacunas em vez de adivinhar: um caminho de rejeição inventado
silenciosamente aqui pareceria completo e passaria no deploy tranquilamente, e só estaria *errado* na
primeira vez que um gestor de fato clicasse em rejeitar.

---

## 2. `model-kikwi-process` em modo rascunho — esboçando sem detalhe técnico

### Prompt

> "Vamos esboçar um processo de aprovação de crédito: o cliente pede um empréstimo, a gente analisa o
> crédito, e encaminha pra assinatura de contrato se aprovado ou avisa o cliente se reprovado. Ainda não sei
> os detalhes técnicos — só quero ver a forma primeiro."

Nenhum projeto alvo é referenciado, e o prompt já diz de cara que os detalhes técnicos não são conhecidos
ainda — exatamente o sinal que o Step 0 procura.

### O que a skill faz com isso

1. O **Step 0** lê esses sinais — sem codebase no contexto, "ainda não sei os detalhes técnicos" — e escolhe
   o **modo rascunho** em vez do modo deploy. Ela diz isso explicitamente de cara, em vez de seguir em
   silêncio como se fosse um pedido normal de nível deploy.
2. O **Step 1** mapeia linguagem de negócio pra tipos de nó exatamente como na §1 — o modo rascunho não muda
   *a forma* do grafo, só quanto detalhe técnico fica anexado a ele.
3. Onde o modo deploy precisaria de `providerType`/`providerBean` no `EXCLUSIVE_GATEWAY`, ou `executor` em
   cada `EXECUTABLE_TASK`, o modo rascunho **deixa esses campos de fora** em vez de inventar um
   `providerType: VARIABLE` que parece plausível ou um nome de bean falso — e coloca a decisão em aberto
   direto na `description` daquele nó, pra um desenvolvedor que for pegar isso depois saber exatamente o
   que ainda falta resolver.
4. O **Step 6** valida contra [`schemas/kikwi-draft.schema.json`](schemas/kikwi-draft.schema.json) — só
   checa que os tipos de nó são reais e que as arestas apontam pra algum lugar, não que algum campo técnico
   esteja presente.
5. A entrega do **Step 7** é reformulada: declarada claramente como um **rascunho, não implantável**, com
   uma lista de "decisões técnicas em aberto" tirada das descrições dos nós — não uma lista de "componentes
   a implementar", já que ainda não existe nome de bean nenhum pra `implement-kikwi-components` agir em cima.

### Resultado (trecho)

Arquivo completo: [`skills/model-kikwi-process/examples/credit-approval.draft.kikwi.json`](skills/model-kikwi-process/examples/credit-approval.draft.kikwi.json)

```json
"CREDIT_DECISION": {
  "id": "CREDIT_DECISION", "name": "Credit Approved?", "type": "EXCLUSIVE_GATEWAY",
  "description": "Roteia com base no resultado da análise de crédito. Decisão técnica em aberto: a
    chamada de aprovar/reprovar é feita por um bean de motor de regras (providerType: BEAN) ou é só a
    leitura de uma variável que ANALYZE_CREDIT já definiu (providerType: VARIABLE)? Ainda não decidido.",
  "outgoing": [
    { "id": "flow-3", "targetNodeId": "SEND_TO_SIGNATURE", "name": "Aprovado", "expectedAnswer": "APPROVED" },
    { "id": "flow-4", "targetNodeId": "NOTIFY_REJECTION", "name": "Reprovado", "isDefault": true }
  ]
}
```

Repare o que *não* está ali: nenhum `providerType`, nenhum `providerBean`/`providerVariable`. Validar esse
arquivo contra o `schemas/kikwi-deploy.schema.json` em vez do schema de rascunho falha exatamente com esses
três campos reportados como faltando — que é o objetivo, não um bug. Esse arquivo nunca foi feito pra passar
nesse schema ainda.

### Endurecendo depois

Quando as decisões técnicas de fato forem tomadas (digamos, a engenharia confirma que a decisão é um bean de
motor de regras), entregar o mesmo arquivo de volta pra `model-kikwi-process` com essa resposta roda a skill
de novo em **modo deploy** sobre o mesmo grafo — os Steps 1–3 não precisam ser refeitos, só o Step 4 (preencher
o que o modo rascunho deixou de fora) e os Steps 6–7 normalmente. É a mesma skill, o mesmo mapeamento de tipo
de nó, só a flag de modo que muda quando existe algo real pra resolver.

---

## 3. `document-java-as-kikwi` — código existente → diagrama de documentação

### Prompt

> "Documente esse serviço de processamento de pedidos como um `.kikwi` para que um novo integrante da equipe
> consiga ver o fluxo sem ler `OrderService` linha por linha. Foca no `OrderController` e no `OrderService`."

Imagine que `OrderService.validateOrder(Order order)` checa estoque e região de entrega, `OrderController`
trata a ramificação por método de pagamento, e `PaymentGatewayCallbackController` recebe um webhook
assíncrono de um gateway de pagamento externo (com um webhook de recusa separado que cancela a espera).

### O que a skill faz com isso

1. O **Step 1** lê o código e mapeia no nível de processo de negócio, não no nível de código — o ponto de
   entrada vira `DEFAULT_START_EVENT`, o método de validação vira um único `EXECUTABLE_TASK` (não dois nós
   para seus dois `if`s internos — veja a nota de granularidade no Step 4), a ramificação por método de
   pagamento vira um `EXCLUSIVE_GATEWAY`, e a chamada assíncrona ao gateway vira um `EXTERNAL_TASK` com um
   `BOUNDARY_INTERRUPTIVE_CATCH_EVENT` para o webhook de recusa (**não** `BOUNDARY_ERROR_HANDLER` — esse tipo
   só é válido em `EXECUTABLE_TASK`, conforme a tabela de anexação de boundary events).
2. O **Step 4** é onde essa skill se justifica frente a um simples dump de propriedades: todo nó recebe um
   trecho de código real ou um diagrama Mermaid em `kikwi:documentation`, não só um nome apontando para uma
   classe.
3. `executor: orderServiceValidateOrder` é **apenas um rótulo descritivo** — essa skill nunca afirma que ele
   resolve para um bean Spring real, ao contrário da `model-kikwi-process`.

### Resultado (trecho)

Arquivo completo: [`skills/document-java-as-kikwi/examples/process-order.kikwi.json`](skills/document-java-as-kikwi/examples/process-order.kikwi.json)

Um trecho de código real anexado ao passo de validação:

```json
"kikwi:documentation": "Checks item availability against `InventoryService` and rejects orders whose shipping address falls outside a supported region.\n\n```java\npublic void validateOrder(Order order) {\n    if (!inventoryService.hasStock(order.getItems())) {\n        throw new OrderValidationException(\"OUT_OF_STOCK\");\n    }\n    ...\n}\n```"
```

Um diagrama de sequência Mermaid anexado ao passo assíncrono de pagamento, porque mais de um sistema está
envolvido na ida e volta:

```mermaid
sequenceDiagram
    participant OS as OrderService
    participant PG as Payment Gateway
    participant WH as PaymentGatewayCallbackController
    OS->>PG: POST /charges (orderId, amount)
    PG-->>OS: 202 Accepted (charge queued)
    Note over OS: Flow waits here (EXTERNAL_TASK)
    PG->>WH: webhook onPaymentConfirmed(orderId)
    WH->>OS: resumes flow -> ORDER_CONFIRMED
```

Ambos renderizam dentro do preview de documentação em tela cheia do editor visual Kikwiflow para aquele nó —
o leitor nunca precisa sair do diagrama para ver a lógica real.

---

## 4. Encadeando com a `beautify-kikwi-diagram`

Pegue o arquivo de aprovação de despesas da §1 — todo `layout` ainda está `{ "x": 0, "y": 0 }`. Entregar esse
arquivo para a `beautify-kikwi-diagram` com um prompt como:

> "Organize o layout desse expense-approval.kikwi para que fique legível."

roda os Steps 1–4 dessa skill: ela identifica `START → VALIDATE → AWAIT_APPROVAL → APPROVED` como o caminho
principal, reconhece `ESCALATE_TIMER → AWAIT_FINANCE_REVIEW` como um ramo que reconverge em `APPROVED`,
dimensiona cada nó por família (`AWAIT_APPROVAL` é um `EXTERNAL_TASK` — 300px de largura, +35px mais alto
pelo badge do timer de boundary que agora carrega), e posiciona o ramo em sua própria linha abaixo da linha
principal para não colidir com ela. Ela muda **apenas** o `layout` — todo `executor`, `providerType`,
`attachedToRef` e `errorCode` da §1 permanece idêntico, byte a byte.

| Nó | Antes (§1) | Depois |
|---|---|---|
| `START` | `{x:0, y:0}` | `{x:0, y:300}` |
| `VALIDATE` | `{x:0, y:0}` | `{x:350, y:300}` |
| `AWAIT_APPROVAL` | `{x:0, y:0}` | `{x:850, y:300}` |
| `AWAIT_FINANCE_REVIEW` | `{x:0, y:0}` | `{x:850, y:600}` — linha própria, reconvergindo em `APPROVED` |
| `APPROVED` | `{x:0, y:0}` | `{x:1350, y:300}` — de volta à linha principal |

Resultado completo: [`skills/beautify-kikwi-diagram/examples/expense-approval.beautified.kikwi.json`](skills/beautify-kikwi-diagram/examples/expense-approval.beautified.kikwi.json).
Essa é também a resposta para "por que não pedir para uma única skill fazer as duas coisas de uma vez":
acertar os tipos de nó/anexações e acertar o posicionamento em pixels são tipos diferentes de raciocínio, e a
separação evita que as coordenadas acima sejam derivadas por tentativa e erro misturado com a mesma passada
da lógica do grafo.

---

## 5. Fechando o loop: `implement-kikwi-components`

Voltando à §1, a entrega de aprovação de despesas listou um item em aberto: `expenseValidationTaskHandler`
precisa de um bean `TaskHandler` real. Entregar esse mesmo `.kikwi` (ou só essa linha da entrega) para a
`implement-kikwi-components` com um prompt como:

> "Implemente os componentes que esse processo de aprovação de despesas ainda precisa."

produz uma classe Java real, que compila — mas não uma regra de validação inventada. A `description` do
nó `VALIDATE` estava vazia; a spec original só dizia "o sistema valida os dados", nunca *como*. Seguindo a
regra "conecte certo, não adivinhe nada" da skill, o handler gerado fica totalmente conectado (o nome
exato do bean, a interface certa, as convenções de pacote/teste do projeto), mas falha alto em vez de
ficar silenciosamente inerte ou inventar uma regra que parece plausível:

```java
@Component("expenseValidationTaskHandler")
public class ExpenseValidationTaskHandler implements TaskHandler {
    @Override
    public void handle(ExecutionContext execution) {
        // TODO(kikwiflow): a spec original só dizia "o sistema valida os dados" — nenhuma regra
        // concreta foi declarada. Conecte a regra real aqui antes desse handler ir para produção.
        throw new UnsupportedOperationException(
            "expenseValidationTaskHandler: regra de validação ainda não especificada — ver TODO acima");
    }
}
```

Exemplo completo (classe + teste unitário correspondente):
[`skills/implement-kikwi-components/examples/`](skills/implement-kikwi-components/examples/). A entrega
junto com ele sinaliza isso como um **TODO em aberto**, do mesmo jeito que a `model-kikwi-process` sinalizou
o caminho de rejeição faltando na §1 — a disciplina é a mesma, um nível abaixo na pilha: não deixar um
artefato gerado *parecer* pronto quando uma decisão real ainda está faltando.

Essa skill e a `beautify-kikwi-diagram` são dois follow-ups independentes da `model-kikwi-process` — a
ordem entre elas não importa, já que uma só escreve código-fonte Java e a outra só mexe no `layout` do
`.kikwi`; nenhuma das duas lê o que a outra produziu.

---

## 6. Opcional: checagem de sanidade de um resultado

A saída da `model-kikwi-process` (modo deploy) e da `document-java-as-kikwi` cada uma tem um JSON Schema
estrutural em [`schemas/`](schemas/) — [`kikwi-deploy.schema.json`](schemas/kikwi-deploy.schema.json) e
[`kikwi-docs.schema.json`](schemas/kikwi-docs.schema.json), respectivamente.
[`kikwi-draft.schema.json`](schemas/kikwi-draft.schema.json) é o terceiro, deliberadamente leve, pro modo
rascunho da §2 — veja lá o porquê de validar um rascunho contra o schema de deploy *dever* falhar. Os dois
schemas rígidos pegam erros de formato (um `executor` faltando em um `EXECUTABLE_TASK`, um campo
desconhecido, um valor de enum inválido para `providerType`) mas — deliberadamente — não o conjunto completo
de regras semânticas (nós inalcançáveis, `kikwi:documentation`/`kikwi:documentationLink` ambos definidos ao
mesmo tempo). Essa checagem mais profunda é para o que serve o `reference/validation-checklist.md` de cada
skill; o schema é um primeiro filtro rápido, não um substituto para ele.

```bash
pip install jsonschema
python3 -c "
import json, jsonschema
schema = json.load(open('schemas/kikwi-deploy.schema.json'))
doc = json.load(open('skills/model-kikwi-process/examples/expense-approval.kikwi.json'))
jsonschema.validate(doc, schema)
print('valid')
"
```
