# Busca e cadastro rápido GLPI — 26/10/2026

Formulário identificado: frontend/src/main.ts productFields({}) chamado por Novo produto/editProduct: Descrição obrigatória; Categoria opcional padrão Não classificada; Subcategoria opcional padrão Não informada, exige categoria compatível; Situação obrigatória padrão Ativo. Armário só em edição aberta. Backend valida descrição1..2000, UUIDs, categoria/subcategoria e boolean. Unidade implícita unidade. Não há ambiguidade de formulário.

1. Regressões backend/PHP/UI antes da alteração: disponibilidade filtra antes de limit/count, zeros/inativos/legado, paginação; os quatro campos e intenções.
2. Endpoint de busca integração aceita availability positive/all e status, com default antigo preservado para clientes existentes; plugin envia padrão ativo/positive sempre. Dashboard permanece igual. Projeção inclui armários operacionais do resultado. Product-options read reutiliza cadastro de categorias/subcategorias.
3. Plugin opção Incluir produtos sem saldo desmarcada; estado vazio oferece a pesquisa ampliada antes de cadastro. Formulário quatro campos com opções reais, duplicidade catálogo inteiro, exceção/justificativa somente quando candidatos e confirmação distinta. Nenhuma alteração em base zero/entradas/permissões.
4. Testes isolados de regras/API/PHP e navegador; revisão; docs/contrato/OpenAPI e ZIP0.1.7. Sem commit/deploy/servidor real.

Concluído: filtro e opções no backend, quatro campos no plugin, preferência automática e carga inicial, regressões isoladas/PHP/proxy/navegador e66 testes backend. Não houve migração, commit ou acesso a servidor.
