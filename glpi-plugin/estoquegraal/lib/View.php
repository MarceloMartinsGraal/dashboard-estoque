<?php
namespace EstoqueGraal;
final class View {
    public static function h(mixed $value):string{return htmlspecialchars((string)$value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
    public static function ticket(string $base,array$ctx,string$csrf,bool$move,bool$create):string {
        $h=[self::class,'h'];
        return '<section class="eg-plugin" data-eg-root data-endpoint="'.$h($base.'/ajax/endpoint.php').'" data-ticket="'.$h($ctx['ticket']).'" data-csrf="'.$h($csrf).'" data-move="'.($move?'1':'0').'" data-create="'.($create?'1':'0').'" data-date="'.$h(date('Y-m-d')).'">
        <h3><img class="eg-brand" src="'.$h($base.'/pics/logo.svg').'" alt="Graal Solutions"> Estoque Graal</h3>
        <p>Estoque operacional do Dashboard Graal. Nenhuma ação de abertura ou encerramento do chamado movimenta produtos.</p>
        <p data-eg-feedback role="status" aria-live="polite"></p>
        <div class="eg-search"><label>Buscar produto por nome ou identificação<input data-eg-search type="search" maxlength="200" autocomplete="off"></label><button type="button" data-eg-search-button>Buscar</button></div>
        <p data-eg-search-status role="status" aria-live="polite"></p><section data-eg-products aria-label="Resultados da busca" aria-live="polite"></section>
        <nav class="eg-paging" aria-label="Paginação dos produtos"><button type="button" data-eg-prev disabled>Anterior</button><span data-eg-page>Página 1</span><button type="button" data-eg-next disabled>Próxima</button></nav>
        <section data-eg-selected hidden><h4 data-eg-product-name></h4><p data-eg-product-info></p><p data-eg-balance-status role="status" aria-live="polite"></p><div data-eg-distribution></div>
        <p data-eg-location-status role="status" aria-live="polite"></p><form data-eg-movement><div class="eg-grid"><label>Operação<select name="kind"><option value="saida">↑ Saída</option><option value="entrada">↓ Entrada</option></select></label>
        <label>Armário<select name="locationId" required><option value="">Selecione explicitamente</option></select></label>
        <label>Quantidade (unidades inteiras)<input name="quantity" inputmode="decimal" required autocomplete="off"></label>
        <label>Data do evento<input type="date" name="eventDate" value="'.$h(date('Y-m-d')).'" required></label>
        <label>Motivo<select name="reason"><option value="chamado">Chamado</option><option value="recebimento">Recebimento</option><option value="uso_interno">Uso interno</option><option value="rma">RMA</option><option value="outro">Outro</option><option value="correcao_estoque">Correção de estoque</option></select></label>
        <label>Observação<textarea name="observation" maxlength="2000"></textarea></label></div>
        <button type="button" data-eg-more-locations hidden>Carregar mais armários</button><button type="submit" data-eg-review '.(!$move?'disabled':'').'>Revisar movimentação</button></form></section>
        <section class="eg-new"><button type="button" data-eg-create-toggle '.(!$create?'disabled':'').'>Cadastrar produto</button><form data-eg-create hidden><p>Pesquise antes de cadastrar para evitar duplicatas. Cadastro não cria saldo; produtos novos têm base zero e recebem entrada separada após confirmação.</p><label>Descrição completa<input name="description" maxlength="2000" required></label><p>Unidade: unidade. Produto ativo.</p><div data-eg-matches aria-live="polite"></div><label><input type="checkbox" data-eg-distinct> É um produto diferente dos candidatos revisados</label><label>Justificativa (obrigatória se houver candidatos)<textarea data-eg-distinct-reason maxlength="500"></textarea></label><button type="submit">Revisar cadastro</button><button type="button" data-eg-create-cancel>Cancelar cadastro</button></form></section>
        <section class="eg-confirm" data-eg-confirm hidden><h4 tabindex="-1">Confira antes de confirmar</h4><p data-eg-summary></p><p data-eg-state role="status"></p><label><input type="checkbox" data-eg-ack> Conferi produto, quantidade, armário e chamado.</label><div class="eg-actions"><button type="button" data-eg-confirm-button disabled>Confirmar operação</button><button type="button" data-eg-recover hidden>Consultar resultado</button><button type="button" data-eg-retry hidden>Reenviar a mesma intenção</button><button type="button" data-eg-cancel>Cancelar revisão</button></div></section>
        <button type="button" data-eg-refresh-reads>Atualizar consultas (sem movimentar)</button><section><h4>Intenções pendentes deste usuário neste chamado</h4><p>Após timeout, recupere a intenção existente antes de criar outra operação.</p><button type="button" data-eg-load-intents>Atualizar intenções</button><p data-eg-intents-status role="status" aria-live="polite"></p><p data-eg-intent-status role="status" aria-live="polite"></p><div data-eg-intents></div></section>
        <section><h4>Movimentações vinculadas ao chamado</h4><button type="button" data-eg-history-refresh>Atualizar histórico</button><p data-eg-history-status role="status" aria-live="polite"></p><div data-eg-history></div><nav class="eg-paging" aria-label="Paginação do histórico"><button type="button" data-eg-history-prev disabled>Anterior</button><span data-eg-history-page>Página 1</span><button type="button" data-eg-history-next disabled>Próxima</button></nav></section>
        </section>';
    }
}
