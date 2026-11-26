# Como revisar um PR (roteiro prático)

Use este roteiro em todo PR, inclusive nos que o Claude abrir. Revisar não é ler linha por linha: é responder às perguntas abaixo.

## 1. Antes do código (2 min)

- [ ] **O título e a descrição dizem o que muda e por quê?** Se não entendeu o objetivo, pergunte antes de ler o código.
- [ ] **O CI está verde?** (aba *Checks*). Vermelho = não aprova; abra o log do passo que falhou.
- [ ] **O tamanho é razoável?** PR grande demais: peça para dividir (ideal: menos de ~400 linhas de mudança real).

## 2. Visão geral (aba *Files changed*)

- [ ] **Quais pastas mudaram?** Mudança em `db/migrations/` mexe no banco de produção: leia com atenção redobrada.
- [ ] **Algum arquivo inesperado?** `.env`, `.csv`, `data/`, chaves, senhas, `node_modules/` nunca devem aparecer.
- [ ] **Migração nova é só "adicionar"?** `ADD COLUMN`, `CREATE TABLE` são seguros. `DROP`, `DELETE`, `ALTER ... TYPE` apagam/alteram dados: exija explicação.

## 3. Segurança (o que mais importa neste projeto)

- [ ] **Rota nova do painel usa `exigirLogin`?** E se altera algo, `exigirDono`?
- [ ] **Toda consulta do painel filtra por `leiloeiro_id`?** Sem isso, um leiloeiro vê dados de outro.
- [ ] **SQL com valores do usuário usa `$1, $2` (parâmetros)?** Nunca texto concatenado (`'... ' + valor`).
- [ ] **Dado pessoal (CPF, documento) aparece em log, URL ou mensagem de erro?** Não pode.
- [ ] **Texto do usuário exibido no Telegram passa por `escapeHtml`?** No painel, entra por `textContent` (nunca `innerHTML`)?

## 4. Comportamento

- [ ] **Tem teste para o que mudou?** Procure em `tests/` um `it('...')` que descreva o caso novo.
- [ ] **O caso de erro foi pensado?** (banco fora, arquivo inválido, usuário clicando duas vezes).
- [ ] **Mensagens para o arrematante estão claras e em português correto?**

## 5. Teste você mesmo (quando muda o que o usuário vê)

```powershell
git fetch origin
git switch <nome-da-branch-do-PR>
npm ci
npm test
```

Ou peça no PR: "mostre um print da tela nova".

## 6. Decidir

| Situação | Ação no GitHub |
|---|---|
| Tudo certo | *Review changes* → **Approve** → **Merge** (prefira *Squash and merge*) |
| Detalhe pequeno | **Comment** na linha, pode aprovar mesmo assim |
| Problema real (segurança, bug, sem teste) | **Request changes** explicando o que e por quê |

Dica: comente na **linha** do código (botão `+` ao passar o mouse), não só no PR geral. Pergunta também é um ótimo comentário: "por que isso é necessário?".

## Regras desta branch `main`

- Não aceita push direto: só via PR.
- PR só pode ser mesclado com o check **testes** verde (tipos, 138+ testes, auditoria de dependências e build Docker).
- Force-push e exclusão da branch são bloqueados.
