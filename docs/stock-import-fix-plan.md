# Correção de visibilidade — 21/10/2026

Escopo: reproduzir conteúdo por armário e importação antes de corrigir. Sem mudanças nos dados reais ou no cálculo de saldo.

1. Regressões: sequência A2 → A5 → A4 → A2/B2, localização não informada e ausência de linhas duplicadas; legado por padrão; relatório e idempotência da importação.
2. Reproduzir os fluxos no Edge com API e PostgreSQL isolados. Distinguir defeito de consulta de ausência de contagem física/quantidades.
3. Corrigir somente causas comprovadas: filtro padrão e relatório; manter conteúdo do armário acessível e atualizado após movimentos iniciados nele.
4. Conferir arquivo real somente com parser, sem importá-lo. Testes, tipos, build, navegador e revisão independente antes da entrega.

## Evidências obtidas

- Antes: navegador confirmou ledger correto por armário e legado persistido invisível por filtro operacional padrão. Testes novos falharam nos requisitos de visibilidade/relatório.
- Depois: 45 testes PostgreSQL aprovados; build/tipos aprovados. Navegador confirmou A2/B2/global4, atualização 2→3→2 após ações no conteúdo, importação sintética pelo formulário e abas corretas sem saldo operacional.
- Arquivo original apenas analisado: 608 produtos, 1233 entradas, 1825 saídas, 25 zeros (21/4). Nenhum dado real importado.
- Sem nova migração; procedimento de atualização em README.md. Revisão independente sem achados relevantes. A divergência específica na base do usuário não foi reproduzida; não houve reparo silencioso dos dados.
