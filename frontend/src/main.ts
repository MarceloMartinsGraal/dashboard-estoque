import './style.css';
import { api } from './api';
type Row = Record<string, any>;
type Choice = { value: string; label: string };
type Field = {
  key: string;
  label: string;
  type?: string;
  value?: any;
  options?: Choice[];
  required?: boolean;
};
const root = document.querySelector<HTMLDivElement>('#app')!;
let user: Row | null = null,
  main: HTMLElement,
  catalog: Row = {
    categories: [],
    subcategories: [],
    units: [],
    locations: [],
  };
let navigationVersion = 0,
  productsVersion = 0,
  historyVersion = 0;
let current = 'Visão geral',
  productPage = 1,
  productQuery = '',
  productStatus = 'todos',
  productUnit = '',
  productCategory = '',
  productLocation = '';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  cls = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(label: string, action: () => unknown, primary = false) {
  const b = el('button', label, primary ? 'primary' : '');
  b.type = 'button';
  b.addEventListener('click', () =>
    Promise.resolve(action()).catch(notifyError),
  );
  return b;
}
function message(text: string, error = false) {
  const p = el('p', text, error ? 'error' : 'success');
  p.id = 'feedback';
  p.role = error ? 'alert' : 'status';
  document.querySelector('#feedback')?.remove();
  document.body.append(p);
  setTimeout(() => p.remove(), 8000);
}
function notifyError(error: unknown) {
  message(
    error instanceof Error
      ? error.message
      : 'Não foi possível concluir a operação',
    true,
  );
}
function title(name: string, subtitle: string) {
  main.replaceChildren(el('h1', name), el('p', subtitle, 'muted'));
}
function empty(text = 'Nenhum registro encontrado.') {
  return el('div', text, 'empty');
}
function options(rows: Row[], labelKey = 'name'): Choice[] {
  return rows.map((x) => ({ value: x.id ?? x.code, label: x[labelKey] }));
}
function control(field: Field) {
  const label = el('label', field.label);
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (field.options) {
    input = el('select');
    for (const choice of field.options) {
      const o = el('option', choice.label);
      o.value = choice.value;
      input.append(o);
    }
  } else if (field.type === 'textarea') input = el('textarea');
  else {
    input = el('input');
    input.type = field.type ?? 'text';
    if (input.type === 'password')
      input.autocomplete =
        field.key === 'password' ? 'current-password' : 'new-password';
    if (field.type === 'number') {
      input.min = '0';
      input.step = '0.001';
    }
  }
  input.name = field.key;
  input.required = field.required ?? true;
  input.value = field.value ?? field.options?.[0]?.value ?? '';
  label.append(input);
  return { label, input };
}
function table(
  headers: string[],
  rows: Row[],
  render: (row: Row) => Array<string | Node>,
) {
  if (!rows.length) return empty();
  const wrap = el('div', '', 'table-wrap'),
    t = el('table'),
    head = el('thead'),
    tr = el('tr');
  for (const name of headers) tr.append(el('th', name));
  head.append(tr);
  const body = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const value of render(row)) {
      const td = el('td');
      if (value instanceof Node) td.append(value);
      else td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(head, body);
  wrap.append(t);
  return wrap;
}
function dialog(name: string) {
  const d = el('dialog'),
    heading = el('h2', name);
  d.append(heading);
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
function formDialog(
  name: string,
  fields: Field[],
  submit: (values: Row) => Promise<unknown>,
  note?: string,
) {
  const d = dialog(name),
    form = el('form'),
    grid = el('div', '', 'form-grid'),
    error = el('p', '', 'error');
  error.hidden = true;
  if (note) d.append(el('p', note, 'notice'));
  for (const f of fields) {
    const item = control(f);
    grid.append(item.label);
  }
  const actions = el('div', '', 'dialog-actions'),
    save = el('button', 'Salvar', 'primary');
  save.type = 'submit';
  actions.append(
    button('Cancelar', () => d.close()),
    save,
  );
  form.append(grid, error, actions);
  d.append(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    error.hidden = true;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await submit(values);
      d.close();
      message('Operação registrada com sucesso.');
      await navigate(current);
    } catch (e) {
      error.hidden = false;
      error.textContent = (e as Error).message;
    } finally {
      save.disabled = false;
    }
  });
  return d;
}
async function loginScreen() {
  user = null;
  root.replaceChildren();
  const wrap = el('section', '', 'login');
  wrap.append(
    el('div', 'GRAAL', 'brand'),
    el('h1', 'Controle de estoque'),
    el('p', 'Entre com sua conta individual.', 'muted'),
  );
  const form = el('form'),
    username = control({ key: 'username', label: 'Login' }),
    password = control({ key: 'password', label: 'Senha', type: 'password' });
  username.input.autocomplete = 'username';
  const error = el('p', '', 'error');
  error.hidden = true;
  const submit = el('button', 'Entrar', 'primary');
  submit.type = 'submit';
  form.append(username.label, password.label, error, submit);
  wrap.append(
    form,
    el(
      'p',
      'Primeiro acesso? Solicite sua conta ao responsável pelo sistema.',
      'subtle',
    ),
  );
  root.append(wrap);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await api('auth/csrf');
      const result = await api('auth/login', {
        username: username.input.value,
        password: password.input.value,
      });
      user = result.employee;
      await shell();
    } catch (e) {
      error.hidden = false;
      error.textContent = (e as Error).message;
    } finally {
      submit.disabled = false;
    }
  });
}
async function shell() {
  root.replaceChildren();
  const header = el('header'),
    brand = el('div', 'GRAAL', 'brand');
  brand.append(el('small', 'Estoque da empresa'));
  const account = el('div', '', 'user');
  account.append(
    el('span', user!.name),
    button('Sair', async () => {
      await api('auth/logout', {});
      await loginScreen();
    }),
  );
  header.append(brand, account);
  const layout = el('div', '', 'layout'),
    nav = el('nav');
  nav.ariaLabel = 'Navegação principal';
  main = el('main');
  for (const item of [
    'Visão geral',
    'Produtos',
    'Histórico',
    'Importação',
    'Cadastros',
    ...(user!.manages_accounts ? ['Funcionários'] : []),
  ])
    nav.append(button(item, () => navigate(item)));
  layout.append(nav, main);
  root.append(header, layout);
  await navigate('Visão geral');
}
async function navigate(page: string) {
  const revision = ++navigationVersion;
  current = page;
  for (const b of root.querySelectorAll('nav button'))
    b.setAttribute('aria-current', b.textContent === page ? 'page' : 'false');
  main.replaceChildren(el('p', 'Carregando…', 'muted'));
  try {
    const loadedCatalog = await api('catalog');
    if (revision !== navigationVersion) return;
    catalog = loadedCatalog;
    if (page === 'Visão geral') await overview();
    else if (page === 'Produtos') await products();
    else if (page === 'Histórico') await history();
    else if (page === 'Importação') await imports();
    else if (page === 'Cadastros') await masterData();
    else await employees();
  } catch (e) {
    if (revision === navigationVersion)
      main.replaceChildren(
        el('p', (e as Error).message, 'error'),
        button('Tentar novamente', () => navigate(page)),
      );
  }
}
async function overview() {
  const d = await api('overview');
  if (current !== 'Visão geral') return;
  title(
    'Estoque da Graal',
    'Disponibilidade operacional baseada em contagens aprovadas e movimentações confirmadas.',
  );
  const metrics = el('section', '', 'metrics');
  for (const [label, value] of [
    ['Produtos cadastrados', String(d.products)],
    ['Saldo em unidades', d.totals.unidade ?? '0.000'],
    ['Saldo em metros', d.totals.metro ?? '0.000'],
    ['Aberturas pendentes', String(d.pending)],
  ]) {
    const m = el('div', '', 'metric');
    m.append(el('span', label), el('strong', value));
    metrics.append(m);
  }
  main.append(metrics);
  if (d.pending)
    main.append(
      el(
        'p',
        'Há produtos aguardando contagem física. O histórico legado não é somado à disponibilidade.',
        'notice',
      ),
    );
  main.append(
    button('Consultar produtos e movimentar', () => navigate('Produtos'), true),
    el('h2', 'Operação rastreável'),
    el(
      'p',
      'Entradas, saídas e realocações registram funcionário, data, motivo e localização. Correções são feitas por estorno vinculado e novo lançamento.',
      'muted',
    ),
  );
}
function productFields(p: Row = {}): Field[] {
  return [
    { key: 'description', label: 'Descrição', value: p.description },
    {
      key: 'unit',
      label: 'Unidade',
      options: [
        { value: 'unidade', label: 'Unidade (inteiros)' },
        { value: 'metro', label: 'Metro (até 3 casas)' },
      ],
      value: p.unit ?? 'unidade',
    },
    {
      key: 'categoryId',
      label: 'Categoria',
      options: [
        { value: '', label: 'Não classificada' },
        ...options(catalog.categories),
      ],
      value: p.category_id ?? '',
      required: false,
    },
    {
      key: 'subcategoryId',
      label: 'Subcategoria',
      options: [
        { value: '', label: 'Não informada' },
        ...catalog.subcategories.map((s: Row) => ({
          value: s.id,
          label:
            catalog.categories.find((c: Row) => c.id === s.category_id)?.name +
            ' / ' +
            s.name,
        })),
      ],
      value: p.subcategory_id ?? '',
      required: false,
    },
    {
      key: 'minimum',
      label: 'Estoque mínimo (opcional)',
      value: p.minimum ?? '',
      required: false,
    },
    {
      key: 'active',
      label: 'Situação',
      options: [
        { value: 'true', label: 'Ativo' },
        { value: 'false', label: 'Inativo' },
      ],
      value: String(p.active ?? true),
    },
  ];
}
function editProduct(p: Row = {}) {
  formDialog(
    p.id ? 'Editar produto' : 'Cadastrar produto',
    productFields(p),
    async (d) => {
      await api('products', {
        ...(p.id ? { id: p.id } : {}),
        description: d.description,
        unit: d.unit,
        categoryId: d.categoryId || null,
        subcategoryId: d.subcategoryId || null,
        minimum: d.minimum || null,
        active: d.active === 'true',
      });
    },
    p.source
      ? 'A descrição original e o ID legado serão preservados. Não altere a unidade de um produto com histórico.'
      : undefined,
  );
}
async function products() {
  const revision = ++productsVersion;
  title(
    'Produtos',
    'Busque um produto para consultar armários, aprovar uma contagem ou registrar uma movimentação.',
  );
  const toolbar = el('form', '', 'toolbar');
  const search = control({
      key: 'q',
      label: 'Buscar descrição ou ID legado',
      value: productQuery,
      required: false,
    }),
    status = control({
      key: 'status',
      label: 'Situação',
      options: [
        { value: 'todos', label: 'Todos' },
        { value: 'ativo', label: 'Ativos' },
        { value: 'inativo', label: 'Inativos' },
        { value: 'abertura_pendente', label: 'Abertura pendente' },
      ],
      value: productStatus,
    }),
    unit = control({
      key: 'unit',
      label: 'Unidade',
      options: [
        { value: '', label: 'Todas' },
        { value: 'unidade', label: 'Unidades' },
        { value: 'metro', label: 'Metros' },
      ],
      value: productUnit,
      required: false,
    }),
    category = control({
      key: 'category',
      label: 'Categoria',
      options: [{ value: '', label: 'Todas' }, ...options(catalog.categories)],
      value: productCategory,
      required: false,
    }),
    location = control({
      key: 'location',
      label: 'Armário',
      options: [{ value: '', label: 'Todos' }, ...options(catalog.locations)],
      value: productLocation,
      required: false,
    });
  const filter = el('button', 'Filtrar');
  filter.type = 'submit';
  toolbar.append(
    search.label,
    status.label,
    unit.label,
    category.label,
    location.label,
    filter,
    button('Novo produto', () => editProduct(), true),
  );
  toolbar.addEventListener('submit', (e) => {
    e.preventDefault();
    productQuery = search.input.value;
    productStatus = status.input.value;
    productUnit = unit.input.value;
    productCategory = category.input.value;
    productLocation = location.input.value;
    productPage = 1;
    products().catch(notifyError);
  });
  main.append(toolbar);
  const query = new URLSearchParams({
    q: productQuery,
    status: productStatus,
    page: String(productPage),
    limit: '30',
  });
  if (productUnit) query.set('unit', productUnit);
  if (productCategory) query.set('categoryId', productCategory);
  if (productLocation) query.set('locationId', productLocation);
  const result = await api('products?' + query);
  if (current !== 'Produtos' || revision !== productsVersion) return;
  main.append(
    table(
      ['Produto', 'Categoria', 'Disponível', 'Unidade', 'Abertura', 'Ações'],
      result.items,
      (p) => {
        const name = el(
          'div',
          p.description || 'Descrição pendente de validação',
        );
        if (p.legacy_id)
          name.append(el('div', 'Legado #' + p.legacy_id, 'subtle'));
        const actions = el('div', '', 'actions');
        actions.append(
          button('Armários', () => balances(p)),
          button('Editar', () => editProduct(p)),
        );
        if (p.active)
          actions.append(
            p.opening_date
              ? button('Movimentar', () => movement(p))
              : button('Contagem', () => opening(p)),
          );
        return [
          name,
          p.category ?? 'Não classificada',
          p.opening_date ? p.quantity : 'Pendente',
          p.unit,
          p.opening_date ?? 'Pendente',
          actions,
        ];
      },
    ),
  );
  const paging = el('div', '', 'pagination'),
    prev = button('Anterior', async () => {
      productPage--;
      await products();
    }),
    next = button('Próxima', async () => {
      productPage++;
      await products();
    });
  prev.disabled = productPage === 1;
  next.disabled = productPage * 30 >= result.total;
  paging.append(
    prev,
    el('span', `Página ${productPage} · ${result.total} produtos`),
    next,
  );
  main.append(paging);
}
async function balances(p: Row) {
  const result = await api('products/' + p.id + '/balances');
  const d = dialog(p.description || 'Descrição pendente');
  d.append(
    el(
      'p',
      p.opening_date
        ? `Saldo operacional: ${result.total} ${p.unit}`
        : 'Abertura pendente de contagem física.',
      'notice',
    ),
    table(['Armário', 'Saldo'], result.locations, (r) => [r.name, r.quantity]),
    button('Fechar', () => d.close()),
  );
}
function movement(p: Row) {
  const locations = options(catalog.locations.filter((l: Row) => l.active));
  formDialog(
    'Movimentar · ' + p.description,
    [
      {
        key: 'kind',
        label: 'Operação',
        options: [
          'entrada',
          'saida',
          'realocacao',
          'ajuste_entrada',
          'ajuste_saida',
        ].map((x) => ({
          value: x,
          label: (
            {
              entrada: 'Entrada',
              saida: 'Saída',
              realocacao: 'Realocação',
              ajuste_entrada: 'Ajuste de entrada',
              ajuste_saida: 'Ajuste de saída',
            } as Row
          )[x],
        })),
        value: 'saida',
      },
      { key: 'quantity', label: 'Quantidade em ' + p.unit },
      {
        key: 'locationId',
        label: 'Armário de origem / entrada',
        options: locations,
      },
      {
        key: 'destinationId',
        label: 'Destino (somente realocação)',
        options: [{ value: '', label: 'Não se aplica' }, ...locations],
        required: false,
      },
      {
        key: 'eventDate',
        label: 'Data do evento',
        type: 'date',
        value: today(),
      },
      {
        key: 'reason',
        label: 'Motivo',
        options: [
          { value: 'uso_interno', label: 'Uso interno' },
          { value: 'chamado', label: 'Chamado' },
          { value: 'recebimento', label: 'Recebimento' },
          { value: 'rma', label: 'RMA' },
          { value: 'correcao_estoque', label: 'Correção de estoque' },
          { value: 'outro', label: 'Outro' },
        ],
      },
      { key: 'ticket', label: 'Chamado (preserva zeros)', required: false },
      {
        key: 'justification',
        label: 'Justificativa / observação',
        type: 'textarea',
        required: false,
      },
    ],
    async (d) => {
      if (
        !confirm(
          'Confirmar lançamento? Após confirmar, a correção exige estorno e novo lançamento.',
        )
      )
        throw new Error('Confirmação cancelada');
      const data: Row = { ...d, productId: p.id };
      if (!data.destinationId) delete data.destinationId;
      await api('movements', data);
    },
    'Quantidade positiva. Ajustes, correção de estoque e motivo “outro” exigem justificativa; motivo “chamado” exige referência.',
  );
}
function opening(p: Row) {
  const d = dialog(
      'Contagem física · ' + (p.description || 'Descrição pendente'),
    ),
    form = el('form'),
    date = control({
      key: 'eventDate',
      label: 'Data de corte',
      type: 'date',
      value: today(),
    }),
    justification = control({
      key: 'justification',
      label: 'Evidência e justificativa da contagem',
      type: 'textarea',
    }),
    rows = el('div'),
    error = el('p', '', 'error');
  error.hidden = true;
  const list: Array<{
    container: HTMLElement;
    location: HTMLSelectElement;
    quantity: HTMLInputElement;
  }> = [];
  function add() {
    const container = el('div', '', 'count-row'),
      location = control({
        key: 'location',
        label: 'Armário',
        options: options(catalog.locations.filter((l: Row) => l.active)),
      }).input as HTMLSelectElement,
      quantity = control({ key: 'quantity', label: 'Quantidade', value: '0' })
        .input as HTMLInputElement;
    location.ariaLabel = 'Armário da contagem';
    quantity.ariaLabel = 'Quantidade em ' + p.unit;
    container.append(
      location,
      quantity,
      button('Remover', () => {
        container.remove();
        list.splice(
          list.findIndex((x) => x.container === container),
          1,
        );
      }),
    );
    list.push({ container, location, quantity });
    rows.append(container);
  }
  add();
  const label = el('label'),
    check = el('input');
  check.type = 'checkbox';
  check.required = true;
  label.append(
    check,
    document.createTextNode(
      'Confirmo que esta contagem foi conferida fisicamente por produto e armário.',
    ),
  );
  const save = el('button', 'Aprovar abertura', 'primary');
  save.type = 'submit';
  form.append(
    date.label,
    el('h3', 'Saldos por armário'),
    rows,
    button('Adicionar armário', add),
    justification.label,
    label,
    error,
    el('div', '', 'dialog-actions'),
  );
  form.lastElementChild!.append(
    button('Cancelar', () => d.close()),
    save,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (
      !confirm(
        'Aprovar esta contagem como abertura operacional? O histórico legado continuará separado.',
      )
    )
      return;
    save.disabled = true;
    try {
      await api('products/' + p.id + '/opening', {
        eventDate: date.input.value,
        justification: justification.input.value,
        counts: list.map((r) => ({
          locationId: r.location.value,
          quantity: r.quantity.value,
        })),
      });
      d.close();
      message('Abertura aprovada e registrada.');
      await products();
    } catch (e) {
      error.hidden = false;
      error.textContent = (e as Error).message;
    } finally {
      save.disabled = false;
    }
  });
  d.append(
    el(
      'p',
      'Aprove somente uma contagem física validada. Não use o saldo histórico como substituto da conferência.',
      'notice',
    ),
    form,
  );
}
async function history(regime = 'operacional', page = 1) {
  const revision = ++historyVersion;
  title(
    'Histórico',
    'Lançamentos confirmados são preservados. Legado e operação têm consultas separadas.',
  );
  const toolbar = el('div', '', 'toolbar');
  toolbar.append(
    button('Operacional', () => history('operacional')),
    button('Legado', () => history('legado')),
  );
  main.append(toolbar);
  if (regime === 'legado')
    main.append(
      el(
        'p',
        'Histórico importado: não compõe a disponibilidade operacional. Datas não possuem horário e autoria é identificada como importação legada.',
        'notice',
      ),
    );
  const rows = await api(`history?regime=${regime}&page=${page}&limit=50`);
  if (current !== 'Histórico' || revision !== historyVersion) return;
  main.append(
    table(
      [
        'Evento',
        'Produto',
        'Operação',
        'Quantidade',
        'Motivo / chamado',
        'Responsável',
        'Registro / ação',
      ],
      rows,
      (r) => {
        const action = el(
          'div',
          r.recorded_at
            ? new Date(r.recorded_at).toLocaleString('pt-BR')
            : 'Sem horário legado',
        );
        if (
          regime === 'operacional' &&
          !['abertura', 'estorno'].includes(r.kind)
        )
          action.append(
            button('Estornar', () =>
              formDialog(
                'Estornar movimentação',
                [
                  {
                    key: 'eventDate',
                    label: 'Data do estorno',
                    type: 'date',
                    value: today(),
                  },
                  {
                    key: 'justification',
                    label: 'Justificativa',
                    type: 'textarea',
                  },
                ],
                async (data) => {
                  if (!confirm('Confirmar estorno vinculado?'))
                    throw new Error('Cancelado');
                  await api('movements/' + r.id + '/reverse', data);
                },
                'O lançamento original será preservado. Faça um novo lançamento se necessário.',
              ),
            ),
          );
        if (r.zero_evidence)
          action.append(
            el('div', 'Quantidade zero: evidência legada', 'badge'),
          );
        if (r.date_estimated)
          action.append(el('div', 'Data estimada — validar', 'badge'));
        return [
          r.event_date,
          r.description || 'Descrição pendente',
          r.kind,
          r.quantity,
          r.reason + (r.ticket ? ' · ' + r.ticket : ''),
          r.author,
          action,
        ];
      },
    ),
  );
  const paging = el('div', '', 'pagination');
  const prev = button('Anterior', () => history(regime, page - 1));
  prev.disabled = page === 1;
  const next = button('Próxima', () => history(regime, page + 1));
  next.disabled = rows.length < 50;
  paging.append(prev, el('span', 'Página ' + page), next);
  main.append(paging);
}
async function imports() {
  title(
    'Importação legada',
    'Valide o arquivo, revise a prévia e confirme em uma etapa separada.',
  );
  main.append(
    el(
      'p',
      'Preserve o arquivo original em armazenamento protegido. A cópia organizada não é homologada. A importação não abre saldo, não converte unidades e não resolve pendências automaticamente.',
      'notice',
    ),
  );
  const form = el('form', '', 'toolbar'),
    field = control({
      key: 'file',
      label: 'Arquivo JSON da auditoria',
      type: 'file',
    });
  (field.input as HTMLInputElement).accept = '.json,application/json';
  const submit = el('button', 'Validar e gerar prévia', 'primary');
  submit.type = 'submit';
  form.append(field.label, submit);
  main.append(form);
  const output = el('section');
  main.append(output);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    output.replaceChildren(el('p', 'Validando arquivo…'));
    try {
      const file = (field.input as HTMLInputElement).files?.[0];
      if (!file) throw new Error('Selecione um arquivo');
      if (file.size > 8 * 1024 * 1024) throw new Error('Limite: 8 MiB');
      const content = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
      const batch = await api('imports/preview', { content });
      output.replaceChildren();
      renderBatch(output, batch);
    } catch (e) {
      output.replaceChildren(el('p', (e as Error).message, 'error'));
    } finally {
      submit.disabled = false;
    }
  });
  const batches = await api('imports');
  if (current !== 'Importação') return;
  if (batches.length) {
    main.append(el('h2', 'Lotes anteriores'));
    for (const batch of batches) {
      const detail = el('details'),
        summary = el(
          'summary',
          new Date(batch.created_at).toLocaleString('pt-BR') +
            ' · ' +
            (batch.confirmed_at ? 'Legado importado' : 'Prévia'),
        );
      detail.append(summary);
      renderBatch(detail, batch);
      main.append(detail);
    }
  }
}
function renderBatch(container: HTMLElement, batch: Row) {
  const p = batch.preview,
    c = p.counts;
  container.append(
    el(
      'p',
      `${c.products} produtos · ${c.categories} categorias · ${c.movements} movimentos · ${c.zeroEvidence} registros zerados`,
    ),
    el('p', 'Checksum SHA-256: ' + batch.checksum, 'subtle'),
    el(
      'p',
      `${p.pending.length} pendências. Abertura: pendente de contagem física.`,
      'notice',
    ),
    el(
      'p',
      `Saldos históricos líquidos: ${p.unitTotals.unidade ?? '0.000'} unidades; ${p.unitTotals.metro ?? '0.000'} metros. Não representam disponibilidade.`,
    ),
  );
  const pending = el('details');
  pending.append(
    el('summary', 'Pendências de validação'),
    table(['Tipo', 'Referência', 'Estado'], p.pending, (r) => [
      r.type,
      String(
        r.productId ?? r.movementId ?? r.ids?.join('/') ?? r.origin ?? '—',
      ),
      r.status,
    ]),
  );
  const balances = el('details');
  balances.append(
    el('summary', 'Saldos legados por produto'),
    table(
      ['ID legado', 'Descrição', 'Saldo histórico', 'Unidade'],
      p.balances,
      (r) => [String(r.legacyId), r.description, r.quantity, r.unit],
    ),
  );
  container.append(pending, balances);
  if (!batch.confirmed_at) {
    const ack = el('label'),
      checkbox = el('input');
    checkbox.type = 'checkbox';
    ack.append(
      checkbox,
      document.createTextNode(
        'Estou ciente das pendências. Confirmar apenas o histórico, mantendo a abertura pendente.',
      ),
    );
    const b = button(
      'Confirmar importação legada',
      async () => {
        if (!checkbox.checked)
          throw new Error('Confirme ciência das pendências');
        if (
          !confirm(
            'Importar somente o histórico legado, sem abrir saldo operacional?',
          )
        )
          return;
        b.disabled = true;
        try {
          await api('imports/' + batch.id + '/confirm', {
            acknowledgePending: true,
          });
          message('Histórico importado; abertura continua pendente.');
          await imports();
        } finally {
          b.disabled = false;
        }
      },
      true,
    );
    container.append(ack, b);
  }
}
async function masterData() {
  title(
    'Cadastros',
    'Organize categorias, subcategorias e armários. Inativar preserva o histórico.',
  );
  for (const [key, name] of [
    ['locations', 'Armários'],
    ['categories', 'Categorias'],
    ['subcategories', 'Subcategorias'],
  ]) {
    const section = el('section');
    section.append(el('h2', name));
    const edit = (row: Row = {}) => {
      const fields: Field[] = [
        { key: 'name', label: 'Nome', value: row.name },
        {
          key: 'active',
          label: 'Situação',
          options: [
            { value: 'true', label: 'Ativo' },
            { value: 'false', label: 'Inativo' },
          ],
          value: String(row.active ?? true),
        },
      ];
      if (key === 'locations')
        fields.unshift({ key: 'code', label: 'Código', value: row.code });
      if (key === 'subcategories')
        fields.unshift({
          key: 'categoryId',
          label: 'Categoria',
          options: options(catalog.categories),
          value: row.category_id,
        });
      formDialog('Cadastro · ' + name, fields, async (d) => {
        await api(key, {
          ...d,
          active: d.active === 'true',
          ...(row.id ? { id: row.id } : {}),
        });
      });
    };
    section.append(
      button('Adicionar', () => edit()),
      table(['Nome', 'Situação', 'Ação'], catalog[key], (r) => [
        r.code ? r.code + ' · ' + r.name : r.name,
        r.active ? 'Ativo' : 'Inativo',
        button('Editar', () => edit(r)),
      ]),
    );
    main.append(section);
  }
  main.append(
    el('h2', 'Unidades de medida'),
    el(
      'p',
      'Unidade: quantidades inteiras. Metro: até três casas decimais. Não há conversões automáticas entre embalagens ou unidades.',
      'muted',
    ),
    table(['Nome', 'Precisão', 'Ação'], catalog.units, (r) => [
      r.name,
      r.precision_digits === 0 ? 'Inteiros' : 'Até três casas',
      button('Editar nome', () =>
        formDialog(
          'Unidade de medida',
          [{ key: 'name', label: 'Nome', value: r.name }],
          async (d) => {
            await api('units', { code: r.code, name: d.name });
          },
        ),
      ),
    ]),
  );
}
async function employees() {
  title(
    'Funcionários',
    'Contas individuais. Todos os funcionários ativos operam o estoque; responsáveis também administram contas.',
  );
  const rows = await api('employees');
  if (current !== 'Funcionários') return;
  function edit(row: Row = {}) {
    formDialog(
      'Conta individual',
      [
        { key: 'username', label: 'Login', value: row.username },
        { key: 'name', label: 'Nome', value: row.name },
        {
          key: 'password',
          label: row.id
            ? 'Nova senha (deixe vazia para manter)'
            : 'Senha inicial (mínimo 12 caracteres)',
          type: 'password',
          required: !row.id,
        },
        {
          key: 'active',
          label: 'Situação',
          options: [
            { value: 'true', label: 'Ativo' },
            { value: 'false', label: 'Inativo' },
          ],
          value: String(row.active ?? true),
        },
        {
          key: 'managesAccounts',
          label: 'Administra contas?',
          options: [
            { value: 'false', label: 'Não' },
            { value: 'true', label: 'Sim' },
          ],
          value: String(row.manages_accounts ?? false),
        },
      ],
      async (d) => {
        const payload: Row = {
          ...d,
          active: d.active === 'true',
          managesAccounts: d.managesAccounts === 'true',
          ...(row.id ? { id: row.id } : {}),
        };
        if (!payload.password) delete payload.password;
        await api('employees', payload);
      },
      'Use uma senha individual e transmita-a por canal seguro. Alterações de conta revogam as sessões existentes.',
    );
  }
  main.append(
    button('Novo funcionário', () => edit(), true),
    table(['Nome', 'Login', 'Situação', 'Administração', 'Ação'], rows, (r) => [
      r.name,
      r.username,
      r.active ? 'Ativo' : 'Inativo',
      r.manages_accounts ? 'Responsável' : 'Operacional',
      button('Editar', () => edit(r)),
    ]),
  );
}
window.addEventListener('session-expired', () => {
  if (user) loginScreen().catch(notifyError);
});
(async () => {
  await api('auth/csrf');
  try {
    user = await api('auth/me');
    await shell();
  } catch {
    await loginScreen();
  }
})().catch((e) => {
  root.replaceChildren(
    el('p', (e as Error).message, 'error'),
    button('Tentar novamente', () => location.reload()),
  );
});
