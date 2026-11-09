import { invoiceUi } from './invoices';
import './style.css';
import { api } from './api';
import { productMatchReview } from './product-matches';
import { quantity, positive, eventDay, label, locationSummary } from './format';
import {
  historyFilterKeys,
  readHistoryState,
  historySearch,
  historyApiSearch,
  type HistoryState,
} from './history-state';
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
      input.step = '1';
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
  onSaved?: () => Promise<unknown>,
  submitLabel = 'Salvar',
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
    save = el('button', submitLabel, 'primary');
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
      await onSaved?.();
    } catch (e) {
      error.hidden = false;
      error.textContent = (e as Error).message;
    } finally {
      save.disabled = false;
    }
  });
  return d;
}

function brandMark(dark = false) {
  const picture = el('picture');
  if (dark) {
    const source = el('source');
    source.media = '(max-width: 640px)';
    source.srcset = '/brand/simbolo-escuro.svg';
    picture.append(source);
  }
  const img = el('img');
  img.src =
    '/brand/' + (dark ? 'logo-horizontal-escuro.svg' : 'logo-horizontal.svg');
  img.alt = 'Graal Solutions';
  img.width = 200;
  img.height = 46;
  img.className = 'brand-logo';
  picture.append(img);
  return picture;
}
const routes: Record<string, string> = {
  overview: 'Visão geral',
  products: 'Produtos',
  history: 'Histórico',
  locations: 'Armários',
  invoices: 'Notas fiscais',
  imports: 'Importação',
  catalog: 'Cadastros',
  employees: 'Funcionários',
};
function routeFromUrl() {
  return (
    routes[new URLSearchParams(location.search).get('view') ?? ''] ??
    'Visão geral'
  );
}
function writeHistory(state: HistoryState) {
  const search = historySearch(state);
  if (location.search.slice(1) !== search)
    window.history.pushState(null, '', location.pathname + '?' + search);
}
function productHistory(p: Row, flow = 'entrada', regime = 'todos') {
  writeHistory({ ...readHistoryState(''), productId: p.id, flow, regime });
  return navigate('Histórico', false);
}
async function loginScreen() {
  user = null;
  root.replaceChildren();
  const wrap = el('section', '', 'login');
  wrap.append(
    brandMark(),
    el('h1', 'Dashboard Graal Empresa'),
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
      'Instalação nova? Conclua o primeiro acesso antes da exposição pública. Demais usuários: solicite sua conta ao responsável.',
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
async function firstAccessScreen(required = true){
  const heading = required ? 'Primeiro acesso' : 'Alterar minha senha';
  ++navigationVersion;current=heading;root.replaceChildren();
  const wrap=el('section','','login');
  wrap.append(brandMark(),el('h1',heading),el('p',required
    ? 'Troque a senha antes de utilizar o dashboard. Depois, entre novamente com a nova senha.'
    : 'Confirme a senha atual. Depois da troca, entre novamente com a nova senha.','muted'));
  const form=el('form'),password=control({key:'newPassword',label:'Nova senha',type:'password'}),confirmation=control({key:'confirmPassword',label:'Confirme a nova senha',type:'password'});
  const existing = control({key:'currentPassword',label:'Senha atual',type:'password'});
  (existing.input as HTMLInputElement).autocomplete = 'current-password';
  (existing.input as HTMLInputElement).maxLength = 128;
  if (!required) form.append(existing.label);
  for(const field of [password,confirmation]){const input=field.input as HTMLInputElement;input.minLength=12;input.maxLength=128;input.autocomplete='new-password';}
  const error=el('p','','error'),recovery=el('div');error.role='alert';const save=el('button','Alterar senha','primary');save.type='submit';let busy=false;
  const logout=required
    ? button('Sair',async()=>{await api('auth/logout',{});user=null;await loginScreen();})
    : button('Cancelar', () => shell());
  form.append(password.label,confirmation.label,el('p','Use pelo menos 12 caracteres.','subtle'),error,recovery,save);wrap.append(form,logout);root.append(wrap);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    if(password.input.value!==confirmation.input.value){error.textContent='A confirmação da senha está diferente.';return;}
    busy=true;save.disabled=true;logout.disabled=true;error.textContent='';recovery.replaceChildren();
    try{await api('auth/change-password',{password:password.input.value,confirmPassword:confirmation.input.value,...(!required ? {currentPassword:existing.input.value} : {})});user=null;await loginScreen();message('Senha alterada. Entre novamente com a nova senha.');}
    catch(e){error.textContent=(e as Error).message+' Se houve falha de comunicação, tente entrar com a nova senha antes de repetir.';recovery.replaceChildren(button('Ir para o login',async()=>{user=null;await loginScreen();}));}
    finally{busy=false;save.disabled=false;logout.disabled=false;}
  });
}
async function shell() {
  if(user?.must_change_password){await firstAccessScreen();return;}
  root.replaceChildren();
  const header = el('header'),
    brand = el('div', '', 'brand');
  brand.append(
    brandMark(true),
    el('span', 'Dashboard Graal Empresa', 'product-name'),
  );
  const account = el('div', '', 'user');
  account.append(
    el('span', user!.name),
    button('Alterar minha senha', () => firstAccessScreen(false)),
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
    'Armários',
    'Notas fiscais',
    'Importação',
    'Cadastros',
    ...(user!.manages_accounts ? ['Funcionários'] : []),
  ])
    nav.append(button(item, () => navigate(item)));
  layout.append(nav, main);
  root.append(header, layout);
  await navigate(routeFromUrl(), false);
}
async function navigate(page: string, push = true) {
  if(user?.must_change_password){await firstAccessScreen();return;}
  if (push) {
    if (page === 'Histórico') {
      if (new URLSearchParams(location.search).get('view') !== 'history')
        writeHistory(readHistoryState(''));
    } else {
      const view =
        Object.entries(routes).find(([, name]) => name === page)?.[0] ??
        'overview';
      window.history.pushState(null, '', location.pathname + '?view=' + view);
    }
  }
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
    else if (page === 'Armários') await locationsPage();
    else if (page === 'Notas fiscais') await invoiceUi({el,button,dialog,table,message}).page(main,()=>revision===navigationVersion);
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
    ['Saldo em unidades', quantity(d.totals.unidade ?? '0.000')],
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
    ...(p.opening_date
      ? [
          {
            key: 'locationId',
            label: 'Armário (move todo o saldo para ele)',
            options: [
              { value: '', label: 'Manter como está' },
              ...catalog.locations
                .filter((l: Row) => l.active)
                .map((l: Row) => ({ value: l.id, label: locationName(l) })),
            ],
            value: p.location_ids?.length === 1 ? p.location_ids[0] : '',
            required: false,
          },
        ]
      : []),
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
  let review:(()=>Promise<unknown>)|undefined;
  const popup=formDialog(
    p.id ? 'Editar produto' : 'Cadastrar produto',
    productFields(p),
    async (d) => {
      await api('products', {
        ...(p.id ? { id: p.id } : {}),
        ...(review?{duplicateConfirmation:await review()}:{}),
        description: d.description,
        categoryId: d.categoryId || null,
        subcategoryId: d.subcategoryId || null,
        locationId: d.locationId || null,
        active: d.active === 'true',
      });
    },
    p.source
      ? 'A descrição original e o código serão preservados.'
      : undefined,
  );
  if(!p.id)review=productMatchReview(popup,async candidate=>{await balances(candidate);});
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
      label: 'Buscar por descrição ou código',
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
    category.label,
    location.label,
    filter,
    button('Novo produto', () => editProduct(), true),
  );
  toolbar.addEventListener('submit', (e) => {
    e.preventDefault();
    productQuery = search.input.value;
    productStatus = status.input.value;
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
  if (productCategory) query.set('categoryId', productCategory);
  if (productLocation) query.set('locationId', productLocation);
  const result = await api('products?' + query);
  if (current !== 'Produtos' || revision !== productsVersion) return;
  main.append(
    table(
      ['Produto', 'Categoria', 'Disponível', 'Armário', 'Abertura', 'Ações'],
      result.items,
      (p) => {
        const name = el(
          'div',
          p.description || 'Descrição pendente de validação',
        );
        if (p.legacy_id)
          name.append(el('div', 'Código ' + p.legacy_id, 'subtle'), el('span', 'Importado', 'badge'));
        const actions = el('div', '', 'actions');
        actions.append(
          button('Armários', () => balances(p)),
          button('Editar', () => editProduct(p)),
          button('Histórico', () => productHistory(p)),
          button('Excluir definitivamente', () => {
            formDialog(
              'Excluir definitivamente · ' + (p.description || 'Descrição pendente de validação'),
              [{ key: 'justification', label: 'Justificativa' }],
              (d) => api('products/' + p.id + '/remove', { justification: d.justification }),
              'O produto sairá do catálogo. Se houver saldo, o sistema dará baixa por armário. O histórico será preservado.',
              undefined,
              'Excluir definitivamente',
            );
          }),
        );
        if (p.active)
          actions.append(
            p.opening_date
              ? (() => {
                  const actions = el('span');
                  actions.append(
                    button('Registrar entrada', () => movement(p, 'entrada')),
                    button('Registrar saída', () => movement(p, 'saida')),
                    button('Mover entre armários', () =>
                      movement(p, 'realocacao'),
                    ),
                  );
                  return actions;
                })()
              : button('Contagem', () => opening(p)),
          );
        return [
          name,
          p.category ?? 'Não classificada',
          p.opening_date ? quantity(p.quantity) : 'Pendente',
          p.location_ids
            .map((id: string) =>
              locationName(catalog.locations.find((l: Row) => l.id === id)),
            )
            .join(', ') || '—',
          p.opening_date ? eventDay(p.opening_date) : 'Pendente',
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
        ? `Saldo operacional: ${quantity(result.total)} ${p.unit}`
        : 'Abertura pendente de contagem física.',
      'notice',
    ),
    table(['Armário', 'Saldo'], result.locations, (r) => [
      r.name,
      quantity(r.quantity),
    ]),
    button('Fechar', () => d.close()),
  );
  invoiceUi({el,button,dialog,table,message}).productSection(d,p,()=>{d.close();window.history.pushState(null,'',location.pathname+'?view=invoices&productId='+encodeURIComponent(p.id));void navigate('Notas fiscais',false);});
}

function locationName(l: Row) {
  return l.code === 'NAO_INFORMADA'
    ? 'Localização não informada'
    : l.code + ' · ' + l.name;
}
function editLocation(row: Row = {}, onSaved?: () => Promise<void>) {
  return formDialog(
    row.id ? 'Editar armário' : 'Cadastrar armário',
    [
      { key: 'code', label: 'Código', value: row.code },
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
    ],
    async (d) => {
      await api('locations', {
        ...(row.id ? { id: row.id } : {}),
        code: d.code,
        name: d.name,
        active: d.active === 'true',
      });
      catalog = await api('catalog');
      await onSaved?.();
    },
  );
}
async function movement(
  p: Row,
  initialKind = 'saida',
  onSaved?: () => Promise<unknown>,
) {
  let [fresh, balance] = await Promise.all([
    api('catalog'),
    api('products/' + p.id + '/balances'),
  ]);
  const d = formDialog(
    'Movimentar · ' + (p.description || 'Descrição pendente'),
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
        ].map((v) => ({ value: v, label: label(v) })),
        value: initialKind,
      },
      { key: 'quantity', label: 'Quantidade em ' + p.unit },
      {
        key: 'locationId',
        label: 'Armário',
        options: [{ value: '', label: 'Selecione um armário' }],
      },
      {
        key: 'destinationId',
        label: 'Armário de destino',
        options: [{ value: '', label: 'Selecione um destino' }],
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
          { value: '', label: 'Selecione o motivo' },
          ...[
            'uso_interno',
            'chamado',
            'recebimento',
            'rma',
            'correcao_estoque',
            'outro',
          ].map((v) => ({ value: v, label: label(v) })),
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
    async (values) => {
      if (
        !confirm(
          'Confirmar lançamento? Correções exigem estorno e novo lançamento.',
        )
      )
        throw new Error('Confirmação cancelada');
      const data: Row = { ...values, productId: p.id };
      if (data.kind !== 'realocacao') delete data.destinationId;
      await api('movements', data);
    },
    'Entrada: todos os armários ativos. Saída e origem de realocação: somente locais com saldo disponível. Escolha a localização explicitamente.',
    onSaved,
  );
  const kind = d.querySelector<HTMLSelectElement>('[name=kind]')!,
    origin = d.querySelector<HTMLSelectElement>('[name=locationId]')!,
    destination = d.querySelector<HTMLSelectElement>('[name=destinationId]')!;
  const preview = el('p', '', 'movement-preview');
  preview.role = 'status';
  const replace = (
    select: HTMLSelectElement,
    choices: Choice[],
    placeholder: string,
  ) => {
    const selected = select.value;
    select.replaceChildren();
    for (const c of [{ value: '', label: placeholder }, ...choices]) {
      const option = el('option', c.label);
      option.value = c.value;
      select.append(option);
    }
    select.value = choices.some((x) => x.value === selected) ? selected : '';
  };
  const balancesById = () =>
    new Map<string, Row>(balance.locations.map((l: Row) => [l.id, l]));
  const updateDestination = () => {
    const transferring = kind.value === 'realocacao';
    destination.disabled = !transferring;
    destination.required = transferring;
    destination.closest('label')!.hidden = !transferring;
    replace(
      destination,
      fresh.locations
        .filter((l: Row) => l.active && l.id !== origin.value)
        .map((l: Row) => ({ value: l.id, label: locationName(l) })),
      'Selecione um destino',
    );
    const b = balancesById().get(origin.value);
    preview.textContent = origin.value
      ? b
        ? 'Saldo disponível no armário: ' + quantity(b.quantity) + ' ' + p.unit
        : 'Armário sem saldo anterior: uma entrada criará os lançamentos dessa localização.'
      : 'Nenhum armário selecionado.';
  };
  const update = () => {
    const receiving = ['entrada', 'ajuste_entrada'].includes(kind.value);
    const balances = balancesById();
    const eligible = fresh.locations.filter(
      (l: Row) =>
        l.active && (receiving || positive(balances.get(l.id)?.quantity)),
    );
    replace(
      origin,
      eligible.map((l: Row) => ({
        value: l.id,
        label:
          locationName(l) +
          (receiving
            ? ''
            : ' — ' + quantity(balances.get(l.id)?.quantity) + ' ' + p.unit),
      })),
      eligible.length
        ? 'Selecione um armário'
        : 'Nenhum armário com saldo disponível',
    );
    origin.closest('label')!.firstChild!.textContent = receiving
      ? 'Armário de entrada'
      : 'Armário de origem';
    updateDestination();
  };
  const refresh = async () => {
    [fresh, balance] = await Promise.all([
      api('catalog'),
      api('products/' + p.id + '/balances'),
    ]);
    if (d.isConnected) update();
  };
  kind.addEventListener('change', update);
  origin.addEventListener('change', updateDestination);
  const actions = el('div', '', 'toolbar');
  actions.append(
    button('Atualizar armários e saldos', refresh),
    button('Cadastrar armário', () => editLocation({}, refresh)),
  );
  d.querySelector('form')!.append(preview, actions);
  update();
}
let locationPage = 1,
  locationQuery = '',
  locationStatus = 'todos';
async function locationsPage() {
  title(
    'Armários',
    'Localizações internas de um único estoque.',
  );
  const form = el('form', '', 'toolbar'),
    search = control({
      key: 'q',
      label: 'Buscar código ou nome',
      value: locationQuery,
      required: false,
    }),
    status = control({
      key: 'status',
      label: 'Situação',
      options: [
        { value: 'todos', label: 'Todos' },
        { value: 'ativo', label: 'Ativos' },
        { value: 'inativo', label: 'Inativos' },
      ],
      value: locationStatus,
    });
  const submit = el('button', 'Filtrar');
  submit.type = 'submit';
  form.append(
    search.label,
    status.label,
    submit,
    button('Cadastrar armário', () => editLocation(), true),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    locationQuery = search.input.value;
    locationStatus = status.input.value;
    locationPage = 1;
    locationsPage().catch(notifyError);
  });
  main.append(form);
  const content = el('section');
  content.append(el('p', 'Carregando armários…', 'muted'));
  main.append(content);
  const result = await api(
    'locations?' +
      new URLSearchParams({
        q: locationQuery,
        status: locationStatus,
        page: String(locationPage),
        limit: '30',
      }),
  );
  if (current !== 'Armários') return;
  content.replaceChildren(
    table(
      ['Código / nome', 'Situação', 'Unidades', 'Ações'],
      result.items,
      (r) => {
        const actions = el('div', '', 'actions');
        actions.append(button('Produtos e saldos', () => locationProducts(r)));
        if (r.code !== 'NAO_INFORMADA')
          actions.append(button('Editar', () => editLocation(r)));
        return [
          locationName(r),
          r.active ? 'Ativo' : 'Inativo',
          quantity(r.totals.unidade ?? '0.000'),
          actions,
        ];
      },
    ),
  );
  const paging = el('div', '', 'pagination'),
    prev = button('Anterior', () => {
      locationPage--;
      return locationsPage();
    }),
    next = button('Próxima', () => {
      locationPage++;
      return locationsPage();
    });
  prev.disabled = locationPage === 1;
  next.disabled = locationPage * 30 >= result.total;
  paging.append(
    prev,
    el('span', `Página ${locationPage} · ${result.total} armários`),
    next,
  );
  content.append(paging);
}
async function locationProducts(
  location: Row,
  page = 1,
  previous?: HTMLDialogElement,
) {
  const d = previous ?? dialog('Produtos e saldos · ' + locationName(location));
  if (previous)
    d.replaceChildren(
      el('h2', 'Produtos e saldos · ' + locationName(location)),
    );
  const content = el('section');
  content.append(el('p', 'Carregando saldos…', 'muted'));
  d.append(
    el(
      'p',
      'Somente saldo operacional positivo. Para colocar um produto neste armário, use Editar produto ou Mover entre armários.',
      'notice',
    ),
    content,
  );
  try {
    const rows = await api(
      `locations/${location.id}/products?page=${page}&limit=30`,
    );
    if (!d.isConnected) return;
    content.replaceChildren(
      table(['Produto', 'Saldo', 'Unidade', 'Ações'], rows, (p) => {
        const actions = el('div', '', 'actions');
        actions.append(
          button('Histórico', () => {
            d.close();
            return productHistory(p);
          }),
        );
        if (p.active)
          actions.append(
            button('Registrar entrada', () => {
              d.close();
              return movement(p, 'entrada', () =>
                locationProducts(location, page),
              );
            }),
            button('Registrar saída', () => {
              d.close();
              return movement(p, 'saida', () =>
                locationProducts(location, page),
              );
            }),
            button('Mover entre armários', () => {
              d.close();
              return movement(p, 'realocacao', () =>
                locationProducts(location, page),
              );
            }),
          );
        return [p.description, quantity(p.quantity), p.unit, actions];
      }),
    );
    const paging = el('div', '', 'pagination'),
      prev = button('Anterior', () => locationProducts(location, page - 1, d)),
      next = button('Próxima', () => locationProducts(location, page + 1, d));
    prev.disabled = page === 1;
    next.disabled = rows.length < 30;
    paging.append(prev, el('span', 'Página ' + page), next);
    content.append(paging);
  } catch (e) {
    content.replaceChildren(el('p', (e as Error).message, 'error'));
  }
  d.append(
    button('Atualizar saldos', () => locationProducts(location, page, d)),
    button('Fechar', () => d.close()),
  );
}
async function opening(p: Row) {
  catalog = await api('catalog');
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
        options: [
          { value: '', label: 'Selecione um armário' },
          ...catalog.locations
            .filter((l: Row) => l.active)
            .map((l: Row) => ({ value: l.id, label: locationName(l) })),
        ],
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

async function history(
  state: HistoryState = readHistoryState(location.search),
) {
  const revision = ++historyVersion;
  title(
    'Histórico',
    'Entradas e saídas do estoque global. O período considera a data do evento, não o instante de registro.',
  );
  const tabs = el('div', '', 'history-tabs');
  tabs.setAttribute('role', 'group');
  tabs.ariaLabel = 'Tipo de movimentação';
  const apply = (changes: Partial<HistoryState>, reset = true) => {
    const next = { ...state, ...changes, ...(reset ? { page: 1 } : {}) };
    writeHistory(next);
    return history(next);
  };
  for (const flow of ['entrada', 'saida', 'realocacao', 'abertura']) {
    const names: Row = {
      entrada: '↓ Entradas',
      saida: '↑ Saídas',
      realocacao: '↔ Realocações',
      abertura: 'Aberturas',
    };
    const b = button(names[flow], () => apply({ flow }));
    b.setAttribute('aria-pressed', String(state.flow === flow));
    tabs.append(b);
  }
  main.append(tabs);
  const form = el('form', '', 'history-filters');
  form.ariaLabel = 'Filtros do histórico';
  const fields: Field[] = [
    { key: 'q', label: 'Produto: nome, código ou ID', value: state.q },
    {
      key: 'categoryId',
      label: 'Categoria',
      options: [{ value: '', label: 'Todas' }, ...options(catalog.categories)],
      value: state.categoryId,
    },
    {
      key: 'subcategoryId',
      label: 'Subcategoria',
      options: [
        { value: '', label: 'Todas' },
        ...options(
          catalog.subcategories.filter(
            (x: Row) => !state.categoryId || x.category_id === state.categoryId,
          ),
        ),
      ],
      value: state.subcategoryId,
    },
    {
      key: 'locationId',
      label: 'Armário',
      options: [
        { value: '', label: 'Todos' },
        ...catalog.locations.map((l: Row) => ({
          value: l.id,
          label:
            l.code === 'NAO_INFORMADA'
              ? 'Localização não informada'
              : l.code + ' · ' + l.name + (l.active ? '' : ' (inativo)'),
        })),
      ],
      value: state.locationId,
    },
    {
      key: 'dateFrom',
      label: 'De — data do evento',
      type: 'date',
      value: state.dateFrom,
    },
    {
      key: 'dateTo',
      label: 'Até — data do evento',
      type: 'date',
      value: state.dateTo,
    },
    {
      key: 'reason',
      label: 'Motivo',
      options: [
        { value: '', label: 'Todos' },
        ...[
          'chamado',
          'uso_interno',
          'recebimento',
          'rma',
          'correcao_estoque',
          'outro',
          'contagem_fisica',
          'saldo_legado',
          'legado_nao_informado',
        ].map((v) => ({ value: v, label: label(v) })),
      ],
      value: state.reason,
    },
    {
      key: 'employeeId',
      label: 'Responsável',
      options: [{ value: '', label: 'Todos os responsáveis' }],
      value: state.employeeId,
    },
    { key: 'ticket', label: 'Chamado', value: state.ticket },
    {
      key: 'regime',
      label: 'Origem',
      options: ['operacional', 'legado', 'todos'].map((v) => ({
        value: v,
        label: label(v),
      })),
      value: state.regime,
    },
  ];
  const controls: Record<
    string,
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  > = {};
  for (const f of fields) {
    const c = control({ ...f, required: false });
    controls[f.key] = c.input;
    form.append(c.label);
  }
  controls.categoryId.addEventListener('change', () => {
    const select = controls.subcategoryId as HTMLSelectElement;
    select.replaceChildren();
    for (const c of [
      { value: '', label: 'Todas' },
      ...options(
        catalog.subcategories.filter(
          (x: Row) =>
            !controls.categoryId.value ||
            x.category_id === controls.categoryId.value,
        ),
      ),
    ]) {
      const o = el('option', c.label);
      o.value = c.value;
      select.append(o);
    }
  });
  const submit = el('button', 'Aplicar filtros', 'primary');
  submit.type = 'submit';
  form.append(
    submit,
    button('Limpar filtros', () => {
      const next = readHistoryState('');
      next.flow = state.flow;
      writeHistory(next);
      return history(next);
    }),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    apply(values as Partial<HistoryState>).catch(notifyError);
  });
  main.append(form);
  const chips = el('div', '', 'active-filters');
  chips.ariaLabel = 'Filtros ativos';
  for (const f of fields)
    if (state[f.key as keyof HistoryState] && f.key !== 'regime') {
      const value = String(state[f.key as keyof HistoryState]);
      chips.append(
        el(
          'span',
          f.label +
            ': ' +
            (f.options?.find((o) => o.value === value)?.label ?? value),
          'badge',
        ),
      );
    }
  if (state.productId) chips.append(el('span', 'Produto selecionado', 'badge'));
  chips.append(el('span', 'Origem: ' + label(state.regime), 'badge'));
  main.append(chips);
  if (state.regime !== 'operacional')
    main.append(
      el(
        'p',
        'Registros legados não compõem o saldo operacional. Datas antigas sem horário não comprovam a ordem entre eventos do mesmo dia; o desempate serve apenas à paginação.',
        'notice',
      ),
    );
  const content = el('section');
  content.ariaLabel = 'Resultados do histórico';
  const loading = el('p', 'Carregando movimentações…', 'muted');
  loading.role = 'status';
  content.append(loading);
  main.append(content);
  try {
    const [result, metadata] = await Promise.all([
      api('history?' + historyApiSearch(state)),
      api('history/filters'),
    ]);
    if (current !== 'Histórico' || revision !== historyVersion) return;
    const responsible = controls.employeeId as HTMLSelectElement;
    for (const person of metadata.employees) {
      const o = el('option', person.name + (person.active ? '' : ' (inativo)'));
      o.value = person.id;
      responsible.append(o);
    }
    responsible.value = state.employeeId;
    if (state.employeeId) {
      const person = metadata.employees.find(
        (p: Row) => p.id === state.employeeId,
      );
      for (const chip of chips.children)
        if (chip.textContent?.startsWith('Responsável: '))
          chip.textContent =
            'Responsável: ' + (person?.name ?? 'Não encontrado');
    }
    content.replaceChildren();
    if (!result.items.length) {
      const filtered = historyFilterKeys.some((k) => !!state[k]);
      content.append(
        empty(
          filtered
            ? 'Nenhum resultado para os filtros escolhidos. Ajuste ou limpe os filtros.'
            : 'Nenhuma movimentação registrada nesta aba e origem.',
        ),
      );
    } else
      content.append(
        table(
          [
            'Data do evento',
            'Produto',
            'Quantidade / unidade',
            'Armário',
            'Motivo',
            'Chamado',
            'Responsável',
            'Detalhes',
          ],
          result.items,
          (r) => {
            const name = el('div', r.description || 'Descrição pendente');
            if (r.product_code)
              name.append(
                el('div', 'Código ' + r.product_code, 'subtle'),
              );
            name.append(el('span', label(r.regime), 'badge'));
            if (r.zero_evidence)
              name.append(
                el('span', 'Evidência segregada: quantidade zero', 'badge'),
              );
            const details = button('Ver detalhes', () => movementDetails(r));
            return [
              eventDay(r.event_date),
              name,
              quantity(r.quantity) + ' ' + r.unit,
              locationSummary(r.locations, r.flow),
              label(r.reason),
              r.ticket ?? '—',
              r.author,
              details,
            ];
          },
        ),
      );
    const paging = el('div', '', 'pagination'),
      prev = button('Anterior', () => apply({ page: state.page - 1 }, false)),
      next = button('Próxima', () => apply({ page: state.page + 1 }, false));
    prev.disabled = state.page === 1;
    next.disabled = state.page * state.limit >= result.total;
    paging.append(
      prev,
      el('span', `Página ${state.page} · ${result.total} movimentações`),
      next,
    );
    content.append(paging);
  } catch (e) {
    if (current === 'Histórico' && revision === historyVersion)
      content.replaceChildren(
        el('p', (e as Error).message, 'error'),
        button('Tentar novamente', () => history(state)),
      );
  }
}
function movementDetails(r: Row) {
  const d = dialog(
    label(r.kind) + ' · ' + (r.description || 'Descrição pendente'),
  );
  const list = el('dl', '', 'movement-details');
  const values: Row = {
    'Data do evento': eventDay(r.event_date),
    Quantidade: quantity(r.quantity) + ' ' + r.unit,
    Operação:
      label(r.kind) +
      (r.original_kind ? ' de ' + label(r.original_kind).toLowerCase() : ''),
    Motivo: label(r.reason),
    Chamado: r.ticket ?? 'Não informado',
    Responsável: r.author,
    Registro: r.recorded_at
      ? new Date(r.recorded_at).toLocaleString('pt-BR')
      : 'Horário não disponível no legado',
    'Observação / justificativa': r.observation ?? 'Não informada',
    Origem: r.origin ?? label(r.regime),
    'Código da movimentação': r.legacy_id ?? 'Não se aplica',
    'Data estimada':
      r.regime === 'legado'
        ? r.date_estimated
          ? 'Sim — requer validação'
          : 'Não marcada; ainda requer validação'
        : 'Não se aplica',
    'Data original': r.date_original ?? 'Não disponível',
    'Regra de conversão': r.conversion_rule ?? 'Não disponível',
    'Situação de validação': r.validation_status,
    'Evidência de quantidade zero': r.zero_evidence
      ? 'Sim — preservada e segregada; sem saldo operacional'
      : 'Não',
    'Estorno do movimento': r.reversal_of ?? 'Não se aplica',
    'Estornado pelo movimento': r.reversed_by ?? 'Não se aplica',
  };
  for (const [name, value] of Object.entries(values))
    list.append(el('dt', name), el('dd', String(value)));
  d.append(list);
  for (const l of r.locations)
    d.append(
      el(
        'p',
        (l.code === 'NAO_INFORMADA'
          ? 'Localização não informada'
          : l.code + ' · ' + l.name) +
          (l.delta === null ? '' : ' · ' + quantity(l.delta) + ' ' + r.unit),
      ),
    );
  if (r.zero_evidence)
    d.append(
      el('p', 'Quantidade zero preservada como evidência legada.', 'notice'),
    );
  if (
    r.regime === 'operacional' &&
    !r.product_deleted &&
    !r.reversed_by &&
    !['abertura', 'estorno'].includes(r.kind)
  )
    d.append(
      button('Estornar', () => {
        d.close();
        formDialog(
          'Estornar movimentação',
          [
            {
              key: 'eventDate',
              label: 'Data do estorno',
              type: 'date',
              value: today(),
            },
            { key: 'justification', label: 'Justificativa', type: 'textarea' },
          ],
          async (data) => {
            if (!confirm('Confirmar estorno vinculado?'))
              throw new Error('Cancelado');
            await api('movements/' + r.id + '/reverse', data);
          },
        );
      }),
    );
  d.append(
    button('Histórico deste produto', () => {
      d.close();
      return productHistory({ id: r.product_id }, r.flow, r.regime);
    }),
    button('Fechar', () => d.close()),
  );
}
async function imports() {
  title(
    'Importação legada',
    'Valide o arquivo, revise a prévia e confirme em uma etapa separada.',
  );
  main.append(
    el(
      'p',
      'Preserve o arquivo original em armazenamento protegido. Ao confirmar, cada produto abre com o saldo do histórico (entradas − saídas) em localização não informada; saldos negativos abrem zerados e ficam nas pendências.',
      'notice',
    ),
    button('Abrir saldos pendentes pelo histórico já importado', async () => {
      if (
        !confirm('Abrir os produtos legados pendentes com o saldo do histórico?')
      )
        return;
      const r = await api('imports/open-legacy-balances', {});
      message(
        `${r.products} produtos abertos; ${r.withBalance} com saldo; ${r.negativeOpenedAtZero} negativos abertos zerados.`,
      );
    }),
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
            (batch.confirmed_at ? 'Importado' : 'Prévia'),
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
      `${c.products} produtos processados · ${c.categories} categorias · ${c.movements} movimentos lidos: ${c.entries} entradas e ${c.exits} saídas · ${c.zeroEvidence} registros zerados`,
    ),
    el('p', 'Checksum SHA-256: ' + batch.checksum, 'subtle'),
    el(
      'p',
      `${p.pending.length} pendências.`,
      'notice',
    ),
    el(
      'p',
      `Saldo histórico líquido: ${quantity(p.unitTotals.unidade ?? '0.000')} unidades.`,
    ),
  );
  const report = batch.confirmed_at ? (p.result ?? p.report) : p.report;
  if (report) {
    if (batch.confirmed_at && !p.result)
      container.append(
        el(
          'p',
          'Situação atual dos registros: este lote não possui relatório histórico da confirmação.',
          'notice',
        ),
      );
    const products = report.products,
      movements = report.movements;
    container.append(
      el(
        'p',
        `${products.processed} produtos processados: ${products.imported} importados, ${products.existing} já existentes${batch.confirmed_at ? '' : `, ${products.planned} previstos`}.`,
      ),
      el(
        'p',
        `${movements.imported} movimentos efetivamente importados; ${movements.existing} já existentes${batch.confirmed_at ? '' : `; ${movements.planned} previstos`}. ${movements.conflicting + products.conflicting} conflitos bloqueiam a confirmação integral.`,
      ),
      table(
        ['Entidade', 'Código', 'Motivo da segregação / rejeição'],
        report.issues,
        (r) => [r.entity, String(r.legacyId), r.reason],
      ),
    );
  } else if (batch.confirmed_at) {
    container.append(
      el(
        'p',
        'Lote anterior ao relatório detalhado: contagens de novos/já existentes na confirmação não foram registradas. Gere novamente a prévia para conferir os registros existentes.',
        'notice',
      ),
    );
  }
  container.append(
    el(
      'p',
      `${c.zeroEvidence} registros de quantidade zero são preservados no histórico como evidência segregada. ${c.movements - c.zeroEvidence} movimentos têm quantidade positiva. O saldo de abertura vem da soma líquida do histórico. Arquivos inválidos são rejeitados integralmente com o motivo, sem importação parcial.`,
      'notice',
    ),
  );
  if (batch.confirmed_at) {
    for (const flow of ['entrada', 'saida'])
      container.append(
        button(
          flow === 'entrada'
            ? 'Ver entradas importadas'
            : 'Ver saídas importadas',
          () => {
            writeHistory({ ...readHistoryState(''), flow, regime: 'legado' });
            return navigate('Histórico', false);
          },
        ),
      );
  }
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
      ['Código', 'Descrição', 'Saldo histórico', 'Unidade'],
      p.balances,
      (r) => [String(r.legacyId), r.description, quantity(r.quantity), r.unit],
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
        'Estou ciente das pendências. Importar o histórico e abrir os saldos por ele.',
      ),
    );
    const b = button(
      'Confirmar importação legada',
      async () => {
        if (!checkbox.checked)
          throw new Error('Confirme ciência das pendências');
        if (
          !confirm(
            'Importar o histórico e abrir o saldo de cada produto por ele?',
          )
        )
          return;
        b.disabled = true;
        try {
          await api('imports/' + batch.id + '/confirm', {
            acknowledgePending: true,
          });
          message('Histórico importado e saldos abertos.');
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
  main.append(button('Gerenciar armários', () => navigate('Armários')));
  for (const [key, name] of [
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
      'Todas as quantidades são em unidades inteiras.',
      'muted',
    ),
    table(['Nome', 'Precisão', 'Ação'], catalog.units, (r) => [
      r.name,
      'Inteiros',
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
          key: 'mustChangePassword',
          label: 'Alterar senha após login?',
          options: [
            { value: 'false', label: 'Não' },
            { value: 'true', label: 'Sim' },
          ],
          value: String(row.must_change_password ?? false),
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
          mustChangePassword: d.mustChangePassword === 'true',
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
window.addEventListener('popstate', () => {
  if (user) navigate(routeFromUrl(), false).catch(notifyError);
});
window.addEventListener('password-change-required',()=>{if(user){user.must_change_password=true;void firstAccessScreen();}});
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
