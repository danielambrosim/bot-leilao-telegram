'use strict';
// Painel do leiloeiro. Todo dado do servidor entra via textContent (nunca innerHTML) para evitar XSS.

const $ = (s) => document.querySelector(s);
const API = '/painel/api';
const LABEL = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado', revogado: 'Revogado' };
const ACOES = {
  'arrematante.criado': 'Cadastro criado pelo Telegram',
  'habilitacao.solicitada': 'Aceitou o termo e solicitou habilitação',
  'painel.ficha_visualizada': 'Ficha aberta no painel',
  'painel.documento_aberto': 'Documento aberto no painel',
  'habilitacao.aprovado': 'Habilitação aprovada',
  'habilitacao.recusado': 'Habilitação recusada',
  'habilitacao.revogado': 'Habilitação revogada',
};
const MOTIVOS = [
  'Documento ilegível. Envie uma foto nítida do documento com foto.',
  'Comprovante de residência com mais de 90 dias. Envie um recente.',
  'Nome no documento diferente do cadastro.',
  'Endereço do comprovante diferente do informado.',
];

let filtro = 'pendente';
let selecionado = null;
let timerBusca;

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
}

async function api(rota, opcoes = {}) {
  const res = await fetch(API + rota, {
    credentials: 'same-origin',
    ...opcoes,
    headers: { 'Content-Type': 'application/json', 'X-SBL-Painel': '1', ...(opcoes.headers || {}) },
  });
  if (res.status === 401 && rota !== '/login') { mostrarLogin(); throw new Error('Sessão expirada. Entre novamente.'); }
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(corpo.erro || `Erro ${res.status}`), { status: res.status, codigo: corpo.erro });
  return corpo;
}

const fmtData = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtCpf = (c) => (c || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const fmtCnpj = (c) => (c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtCel = (c) => (c ? c.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '—');
function rel(d) {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
}

let tt;
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(tt); tt = setTimeout(() => (e.hidden = true), 3800); }

// ---------- Login ----------
function mostrarLogin() { $('#tela-painel').hidden = true; $('#tela-login').hidden = false; $('#login-email').focus(); }

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#login-erro');
  erro.hidden = true;
  try {
    await api('/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, senha: $('#login-senha').value }) });
    $('#login-senha').value = '';
    await iniciar();
  } catch (e) {
    erro.textContent = e.codigo === 'bloqueado'
      ? 'Muitas tentativas. Acesso bloqueado por 15 minutos.'
      : e.codigo === 'invalido' ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar. Tente novamente.';
    erro.hidden = false;
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => undefined);
  selecionado = null;
  mostrarLogin();
});

// ---------- Painel ----------
function atualizarContagem(c) {
  for (const s of ['pendente', 'aprovado', 'recusado', 'revogado']) $('#k-' + s).textContent = c[s] || 0;
}

async function carregarLista() {
  const q = encodeURIComponent($('#busca').value.trim());
  const { itens, contagem } = await api(`/habilitacoes?status=${filtro}&q=${q}`);
  atualizarContagem(contagem);
  const lista = $('#lista');
  lista.replaceChildren();
  if (!itens.length) { lista.append(el('p', { class: 'empty' }, 'Nenhuma habilitação neste filtro.')); return; }
  for (const i of itens) {
    lista.append(el('button', {
      class: 'row', type: 'button', 'aria-current': String(i.id === selecionado),
      onclick: () => { selecionado = i.id; carregarLista(); abrirFicha(i.id); },
    },
      el('span', { class: 'nome' }, i.nome),
      el('span', { class: `pill ${i.status}` }, LABEL[i.status]),
      el('span', { class: 'meta' }, `${i.cnpj ? 'PJ' : 'PF'} · CPF final ${i.cpf_final}${i.cidade ? ` · ${i.cidade}/${i.uf}` : ''}`),
      el('span', { class: 'when' }, rel(i.consentido_em)),
    ));
  }
}

async function abrirFicha(id) {
  const box = $('#ficha');
  box.replaceChildren(el('p', { class: 'empty' }, 'Carregando…'));
  let f;
  try { f = await api(`/habilitacoes/${id}`); } catch (e) { box.replaceChildren(el('p', { class: 'empty' }, e.message)); return; }
  const a = f.arrematante;
  const docLabel = { identidade: 'Documento de identidade', comprovante_residencia: 'Comprovante de residência' };

  const dados = el('dl', { class: 'dl' },
    el('dt', {}, 'E-mail'), el('dd', {}, a.email, ' ', a.email_verificado_em ? el('span', { class: 'pill aprovado' }, 'confirmado') : null),
    el('dt', {}, 'CPF'), el('dd', { class: 'mono' }, fmtCpf(a.cpf)),
    a.cnpj ? [el('dt', {}, 'CNPJ'), el('dd', { class: 'mono' }, fmtCnpj(a.cnpj))] : null,
    a.cnpj
      ? [el('dt', {}, 'Razão social'), el('dd', {}, a.razao_social || '— (pendente)'),
         el('dt', {}, 'Representante'), el('dd', {}, `${a.nome} · CPF ${fmtCpf(a.cpf)}`)]
      : [el('dt', {}, 'Nascimento'), el('dd', { class: 'mono' }, a.data_nascimento || '— (pendente)'),
         el('dt', {}, 'Estado civil'), el('dd', {}, a.estado_civil || '— (pendente)'),
         el('dt', {}, 'Profissão'), el('dd', {}, a.profissao || '— (pendente)')],
    el('dt', {}, a.cnpj ? 'IE' : 'RG'), el('dd', { class: 'mono' }, a.rg_ie || '—'),
    el('dt', {}, 'Celular'), el('dd', { class: 'mono' }, fmtCel(a.celular)),
    el('dt', {}, 'Endereço'), el('dd', {}, a.endereco),
    el('dt', {}, 'Termo'), el('dd', {}, `Versão ${f.termo_versao}, aceito em ${fmtData(f.consentido_em)}`),
  );

  const docs = el('div', { class: 'docs' }, f.documentos.length
    ? f.documentos.map((d) => el('a', {
        class: 'btn ghost', target: '_blank', rel: 'noopener',
        href: `${API}/habilitacoes/${f.id}/documentos/${d.tipo}`,
      }, `📄 ${docLabel[d.tipo] || d.tipo} (${d.mime === 'application/pdf' ? 'PDF' : 'imagem'}, ${Math.max(1, Math.round(d.tamanho_bytes / 1024))} KB)`))
    : el('p', { class: 'hint' }, 'Nenhum documento disponível (pode ter expirado pela retenção).'));

  const acoes = el('div', { class: 'actions' });
  if (f.status === 'pendente') montarAcoesPendente(acoes, f);
  else {
    acoes.append(el('p', { class: 'hint' },
      `${LABEL[f.status]} por ${f.decidido_por || '—'} em ${fmtData(f.decidido_em)}.`, f.motivo ? ` Motivo: ${f.motivo}` : ''));
    if (f.status === 'aprovado') montarMotivo(acoes, f, 'revogado', 'Revogar habilitação');
  }

  const historico = el('ul', { class: 'audit' }, f.historico.map((h) =>
    el('li', {}, el('time', {}, fmtData(h.em)), el('span', {}, (ACOES[h.acao] || h.acao) + (h.quem ? ` — ${h.quem}` : '')))));

  box.replaceChildren(el('div', { class: 'ficha' },
    el('div', { class: 'ficha-top' },
      el('div', {}, el('h2', {}, a.nome), el('p', {}, `Habilitação #${f.id} · ${a.cidade ? `${a.cidade}/${a.uf}` : ''}`)),
      el('span', { class: `pill ${f.status}` }, LABEL[f.status])),
    el('div', {}, el('div', { class: 'sec-title' }, 'Dados informados'), dados),
    el('div', {}, el('div', { class: 'sec-title' }, 'Documentos (abrem em nova aba; abertura fica registrada)'), docs),
    acoes,
    el('div', {}, el('div', { class: 'sec-title' }, 'Histórico'), historico),
  ));
}

function montarAcoesPendente(box, f) {
  const c1 = el('input', { type: 'checkbox', id: `chk-doc-${f.id}` });
  const c2 = el('input', { type: 'checkbox', id: `chk-end-${f.id}` });
  const aprovar = el('button', { class: 'btn approve', type: 'button', disabled: true }, 'Aprovar habilitação');
  const dica = el('p', { class: 'hint' }, 'Marque as duas conferências para liberar a aprovação.');
  const upd = () => { aprovar.disabled = !(c1.checked && c2.checked); dica.textContent = aprovar.disabled ? 'Marque as duas conferências para liberar a aprovação.' : 'O arrematante será avisado no Telegram na hora.'; };
  c1.addEventListener('change', upd); c2.addEventListener('change', upd);
  aprovar.addEventListener('click', () => decidir(f.id, 'aprovado', null, aprovar));
  box.append(
    el('div', {}, el('div', { class: 'sec-title' }, 'Conferência'), el('div', { class: 'checks' },
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: true, disabled: true }), 'CPF válido (dígito verificador)', el('span', { class: 'auto' }, 'automático')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!f.arrematante.email_verificado_em, disabled: true }), 'E-mail confirmado por código', el('span', { class: 'auto' }, 'automático')),
      el('label', { class: 'check', for: c1.id }, c1, 'Documento legível e nome confere com o cadastro'),
      el('label', { class: 'check', for: c2.id }, c2, 'Comprovante recente e endereço confere'))),
    el('div', { class: 'btns' }, aprovar),
    dica,
  );
  montarMotivo(box, f, 'recusado', 'Recusar');
}

function montarMotivo(box, f, decisao, rotulo) {
  const abrir = el('button', { class: 'btn reject', type: 'button' }, rotulo);
  const sel = el('select', { id: `motivo-${f.id}` }, el('option', { value: '' }, 'Escolha um motivo…'),
    MOTIVOS.map((m) => el('option', {}, m)), el('option', { value: 'outro' }, 'Outro motivo…'));
  const txt = el('textarea', { rows: 2, maxlength: 500, placeholder: 'Descreva o motivo (enviado ao arrematante)', hidden: true });
  const confirmar = el('button', { class: 'btn reject', type: 'button', disabled: true }, `Confirmar: ${rotulo.toLowerCase()}`);
  const voltar = el('button', { class: 'btn ghost', type: 'button' }, 'Voltar');
  const caixa = el('div', { class: 'motivo-box', hidden: true },
    el('label', { for: sel.id }, 'Motivo (o arrematante recebe no Telegram)'), sel, txt, el('div', { class: 'btns' }, confirmar, voltar));
  const motivo = () => (sel.value === 'outro' ? txt.value.trim() : sel.value);
  const upd = () => { txt.hidden = sel.value !== 'outro'; confirmar.disabled = motivo().length < 10; };
  sel.addEventListener('change', upd); txt.addEventListener('input', upd);
  abrir.addEventListener('click', () => { caixa.hidden = false; abrir.hidden = true; sel.focus(); });
  voltar.addEventListener('click', () => { caixa.hidden = true; abrir.hidden = false; });
  confirmar.addEventListener('click', () => decidir(f.id, decisao, motivo(), confirmar));
  box.append(el('div', { class: 'btns' }, abrir), caixa);
}

async function decidir(id, decisao, motivo, botao) {
  botao.disabled = true;
  try {
    const r = await api(`/habilitacoes/${id}/decisao`, { method: 'POST', body: JSON.stringify({ decisao, motivo }) });
    toast(`${LABEL[decisao]}. ${r.avisado ? 'Arrematante avisado no Telegram.' : 'Não foi possível avisar no Telegram.'}`);
    await Promise.all([carregarLista(), abrirFicha(id)]);
  } catch (e) {
    toast(e.codigo === 'status_mudou_ou_nao_encontrado' ? 'Outra pessoa já decidiu esta habilitação. Atualizando…' : `Erro: ${e.message}`);
    botao.disabled = false;
    await Promise.all([carregarLista(), abrirFicha(id)]);
  }
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  filtro = b.dataset.f;
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  carregarLista().catch((e) => toast(e.message));
}));
$('#busca').addEventListener('input', () => { clearTimeout(timerBusca); timerBusca = setTimeout(() => carregarLista().catch((e) => toast(e.message)), 300); });

async function iniciar() {
  try {
    const { operador } = await api('/me');
    $('#nome-leiloeiro').textContent = operador.leiloeiro_nome;
    $('#email-operador').textContent = operador.email;
    document.title = `Painel · ${operador.leiloeiro_nome}`;
    $('#tela-login').hidden = true;
    $('#tela-painel').hidden = false;
    await carregarLista();
  } catch {
    mostrarLogin();
  }
}

iniciar();
