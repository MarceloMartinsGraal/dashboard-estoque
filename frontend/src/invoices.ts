import { api, ApiError, uploadInvoice } from './api';
type Row = Record<string, any>;
type UI = {
    el: <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => HTMLElementTagNameMap[K];
    button: (text: string, action: () => unknown, primary?: boolean) => HTMLButtonElement;
    dialog: (name: string) => HTMLDialogElement;
    table: (headers: string[], rows: Row[], render: (r: Row) => Array<string | Node>) => HTMLElement;
    message: (text: string, error?: boolean) => void;
};
export function invoiceUi(ui: UI) {
    const { el, button, dialog, table, message } = ui;
    const errorText = (e: unknown) => e instanceof Error ? e.message : 'Falha ao consultar notas fiscais.';
    function link(row: Row, download = false) { const a = el('a', download ? 'Baixar' : 'Visualizar', 'invoice-link'); a.href = '/api/invoices/' + encodeURIComponent(row.id) + '/file' + (download ? '?download=true' : ''); if (!download) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
    } return a; }
    function picker(initial: Row | null = null, onChange: () => void = () => { }) {
        const area = el('section', '', 'invoice-picker');
        area.ariaLabel = 'Seleção de produto';
        const label = el('label', 'Buscar produto por nome ou identificação'), search = el('input');
        search.type = 'search';
        label.append(search);
        const selectedText = el('p'), results = el('div'), status = el('p');
        status.role = 'status';
        const confirm = el('input');
        confirm.type = 'checkbox';
        const confirmLabel = el('label');
        confirmLabel.append(confirm, ' Confirmo que este produto inativo é o cadastro correto.');
        let selected = initial, generation = 0, timer: ReturnType<typeof setTimeout>;
        function selection(p: Row | null) { selected = p; selectedText.textContent = p ? `${p.description} · ID ${p.legacyId ?? p.id} · ${p.active ? 'Ativo' : 'Inativo'}` : 'Nenhum produto selecionado.'; confirm.checked = false; confirmLabel.hidden = !p || p.active; onChange(); }
        async function load(page = 1) {
            const seq = ++generation, q = search.value.trim();
            status.textContent = 'Buscando produtos, inclusive sem saldo…';
            results.replaceChildren();
            try {
                const r = await api('invoices/products?' + new URLSearchParams({ q, page: String(page), limit: '10' }));
                if (seq !== generation || !area.isConnected)
                    return;
                status.textContent = r.total ? `${r.total} produtos encontrados.` : 'Nenhum produto encontrado. Não é criado cadastro automaticamente.';
                for (const p of r.items) {
                    const item = el('article');
                    item.append(el('p', p.description), el('p', `ID: ${p.legacyId ?? p.id} · ${p.active ? 'Ativo' : 'Inativo'}`), button('Selecionar produto', () => { selection(p); results.replaceChildren(); status.textContent = 'Produto selecionado.'; }));
                    results.append(item);
                }
                const prev = button('Produtos anteriores', () => load(page - 1)), next = button('Próximos produtos', () => load(page + 1));
                prev.disabled = page <= 1;
                next.disabled = page * r.limit >= r.total;
                results.append(prev, next);
            }
            catch (e) {
                if (seq === generation) {
                    status.textContent = 'Falha na busca: ' + errorText(e);
                    results.append(button('Tentar busca novamente', () => load(page)));
                }
            }
        }
        search.oninput = () => { clearTimeout(timer); generation++; selection(null); results.replaceChildren(); if (search.value.trim())
            timer = setTimeout(() => void load(), 300);
        else
            status.textContent = 'Digite para buscar um produto existente.'; };
        selection(initial);
        area.append(label, selectedText, button('Limpar produto', () => selection(null)), confirmLabel, status, results);
        return { area, selected: () => selected, confirmed: () => confirm.checked, check: () => { if (!selected)
                throw new Error('Busque e selecione um produto existente.'); if (!selected.active && !confirm.checked)
                throw new Error('Confirme que o produto inativo é o cadastro correto.'); } };
    }
    function actions(row: Row, refresh: () => Promise<void>) { const a = el('div', '', 'invoice-actions'); a.append(link(row), link(row, true), button('Alterar nome ou vínculo', () => editor(row, refresh))); return a; }
    function editor(row: Row | null, refresh: () => Promise<void>, initial: Row | null = null) {
        const d = dialog(row ? 'Alterar nota fiscal' : 'Anexar nota fiscal'), form = el('form'), error = el('p', '', 'error');
        error.role = 'alert';
        const titleLabel = el('label', 'Nome ou identificação da nota'), name = el('input');
        name.required = true;
        name.maxLength = 200;
        name.name = 'invoiceName';
        name.value = row?.name ?? '';
        titleLabel.append(name);
        const modeLabel = el('label', 'Vínculo'), mode = el('select');
        mode.name = 'invoiceLink';
        for (const [v, t] of [['loose', 'Nota avulsa'], ['linked', 'Vincular a um produto']]) {
            const o = el('option', t);
            o.value = v;
            mode.append(o);
        }
        mode.value = (row?.product ?? initial) ? 'linked' : 'loose';
        modeLabel.append(mode);
        const product = picker(row?.product ?? initial);
        product.area.hidden = mode.value === 'loose';
        mode.onchange = () => { product.area.hidden = mode.value === 'loose'; };
        const fileLabel = el('label', 'Arquivo PDF (máximo 20 MiB)'), file = el('input');
        file.type = 'file';
        file.accept = '.pdf,application/pdf';
        file.required = !row;
        file.name = 'invoiceFile';
        fileLabel.append(file);
        file.onchange = () => { if (file.files?.[0])
            name.value = file.files[0].name; };
        const save = el('button', row ? 'Salvar alterações' : 'Enviar PDF', 'primary');
        save.type = 'submit';
        let saving = false;
        const cancel = button('Cancelar', () => d.close()), extra = el('div', '', 'invoice-actions');
        form.append(...(row ? [] : [fileLabel]), titleLabel, modeLabel, product.area, error, extra, cancel, save);
        d.append(form);
        d.addEventListener('cancel', e => { if (saving)
            e.preventDefault(); });
        form.onsubmit = async (e) => {
            e.preventDefault();
            if (saving || !form.reportValidity())
                return;
            error.textContent = '';
            extra.replaceChildren();
            let data;
            try {
                if (mode.value === 'linked')
                    product.check();
                data = { name: name.value.trim(), productId: mode.value === 'linked' ? product.selected()!.id : null, confirmInactive: product.confirmed() };
                if (!row && (!file.files?.[0] || file.files[0].size > 20 * 1024 * 1024))
                    throw new Error('Selecione um PDF de até 20 MiB.');
            }
            catch (e) {
                error.textContent = errorText(e);
                return;
            }
            saving = true;
            for (const c of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button'))
                c.disabled = true;
            let done = false;
            try {
                if (row)
                    await api('invoices/' + row.id, data);
                else
                    await uploadInvoice(file.files![0], data);
                done = true;
            }
            catch (e) {
                error.textContent = errorText(e);
                if (e instanceof ApiError && e.data.code === 'INVOICE_DUPLICATE') {
                    try {
                        const existing = await api('invoices/' + e.data.documentId);
                        extra.append(el('p', 'PDF já cadastrado: ' + existing.name), link(existing), button('Revisar vínculo existente', () => { d.close(); editor(existing, refresh); }));
                    }
                    catch (e) {
                        extra.append(el('p', 'Não foi possível carregar a nota existente: ' + errorText(e)));
                    }
                }
                else
                    extra.append(button('Conferir lista antes de reenviar', async () => { d.close(); await refresh(); }));
            }
            finally {
                saving = false;
                for (const c of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button'))
                    c.disabled = false;
            }
            if (done) {
                d.close();
                message(row ? 'Nota fiscal atualizada.' : 'Nota fiscal anexada, sem alteração de estoque.');
                try {
                    await refresh();
                }
                catch (e) {
                    message('Operação confirmada, mas a lista não atualizou: ' + errorText(e), true);
                }
            }
        };
    }
    async function page(main: HTMLElement, isCurrent:()=>boolean=()=>true) {
        main.replaceChildren(el('h1', 'Notas fiscais'), el('p', 'Documentos PDF avulsos ou vinculados a produtos. Anexar não altera o estoque.', 'muted'));
        const host = el('section'), filters = el('form', '', 'invoice-filters'), searchLabel = el('label', 'Nome ou identificação'), search = el('input');
        search.type = 'search';
        searchLabel.append(search);
        const linkLabel = el('label', 'Tipo de vínculo'), filter = el('select');
        for (const [v, t] of [['all', 'Todas'], ['loose', 'Avulsas'], ['linked', 'Vinculadas']]) {
            const o = el('option', t);
            o.value = v;
            filter.append(o);
        }
        linkLabel.append(filter);
        const params = new URLSearchParams(location.search);
        search.value = params.get('q') ?? '';
        filter.value = params.get('link') ?? 'all';
        let pageNo = Math.max(1, Number(params.get('page') ?? 1) || 1), generation = 0;
        let initial = null;
        if (params.get('productId'))
            initial = await api('invoices/products/' + encodeURIComponent(params.get('productId')!));
        if(!isCurrent())return;
        const product = picker(initial), status = el('p'), list = el('div'), paging = el('div', '', 'pagination');
        status.role = 'status';
        const apply = el('button', 'Pesquisar', 'primary');
        apply.type = 'submit';
        filters.append(searchLabel, linkLabel, product.area, apply);
        const add = button('Anexar nota fiscal', () => editor(null, load, product.selected()), true);
        main.append(add, filters, host);
        host.append(status, list, paging);
        async function load() {
            if(!isCurrent()||!host.isConnected)return;
            const seq = ++generation;
            const q = new URLSearchParams({ page: String(pageNo), limit: '20', q: search.value, link: filter.value || 'all' });
            if (product.selected())
                q.set('productId', product.selected()!.id);
            const url = new URLSearchParams(q);
            url.set('view', 'invoices');
            window.history.replaceState(null, '', location.pathname + '?' + url);
            status.textContent = 'Carregando notas fiscais…';
            host.ariaBusy = 'true';
            list.replaceChildren();
            paging.replaceChildren();
            try {
                const r = await api('invoices?' + q);
                if (seq !== generation || !host.isConnected)
                    return;
                status.textContent = r.total ? `${r.total} notas fiscais · Página ${r.page}` : (search.value || product.selected() || filter.value !== 'all' ? 'Nenhuma nota corresponde aos filtros.' : 'Nenhuma nota fiscal cadastrada.');
                if (r.items.length)
                    list.append(table(['Nota fiscal', 'Produto', 'Anexada por', 'Data', 'Ações'], r.items, row => [row.name, row.product ? row.product.description + (row.product.active ? '' : ' · Inativo') : 'Nota avulsa', row.uploadedBy.name, new Date(row.uploadedAt).toLocaleString('pt-BR'), actions(row, load)]));
                const prev = button('Anterior', () => { pageNo--; return load(); }), next = button('Próxima', () => { pageNo++; return load(); });
                prev.disabled = pageNo <= 1;
                next.disabled = pageNo * r.limit >= r.total;
                paging.append(prev, next);
            }
            catch (e) {
                if (seq === generation && host.isConnected) {
                    status.textContent = 'Falha ao carregar notas fiscais: ' + errorText(e);
                    list.append(button('Tentar novamente', load));
                }
            }
            finally {
                if (seq === generation)
                    host.ariaBusy = 'false';
            }
        }
        filters.onsubmit = e => { e.preventDefault(); pageNo = 1; void load(); };
        await load();
        if (isCurrent() && host.isConnected && params.get('attach') === 'true')
            editor(null, load, initial);
    }
    function productSection(d: HTMLDialogElement, p: Row, openGeneral: () => void) {
        const area = el('section');
        area.append(el('h3', 'Notas fiscais'));
        d.append(area);
        const body = el('div');
        area.append(body, button('Ver todas as notas deste produto', openGeneral), button('Anexar nota a este produto', () => editor(null, load, p)));
        async function load() { body.replaceChildren(el('p', 'Carregando notas fiscais…')); try {
            const r = await api('invoices?' + new URLSearchParams({ productId: p.id, limit: '5' }));
            if (!d.isConnected)
                return;
            body.replaceChildren();
            if (!r.items.length)
                body.append(el('p', 'Nenhuma nota fiscal vinculada.'));
            for (const row of r.items) {
                const item = el('article');
                item.append(el('p', row.name), actions(row, load));
                body.append(item);
            }
        }
        catch (e) {
            body.replaceChildren(el('p', 'Falha ao consultar notas fiscais: ' + errorText(e), 'error'), button('Tentar novamente', load));
        } }
        void load();
    }
    return { page, productSection };
}
