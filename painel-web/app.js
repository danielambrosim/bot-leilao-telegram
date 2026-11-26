'use strict';
// Painel do leiloeiro. Dados do servidor entram sempre via textContent (nunca innerHTML) para evitar XSS.

const $ = (s) => document.querySelector(s);
const API = '/painel/api';
const STATUS = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado', revogado: 'Revogado' };
const MOTIVOS = [
  'Documento ilegível. Envie uma foto nítida do documento com foto.',
  'Comprovante de residência com mais de 90 dias. Envie um recente.',
  'Nome no documento diferente do cadastro.',
  'Endereço do comprovante diferente do informado.',
];
const PAGINAS = {
  'visao-geral': { grupo: 'Visualização', titulo: 'Visão geral', render: paginaVisaoGeral },
  habilitacoes: { grupo: 'Visualização', titulo: 'Habilitações', render: paginaHabilitacoes },
  arrematantes: { grupo: 'Visualização', titulo: 'Arrematantes', render: paginaArrematantes },
  editais: { grupo: 'Visualização', titulo: 'Editais e notícias', render: paginaEditais },
  exportacoes: { grupo: 'Visualização', titulo: 'Exportações', render: paginaExportacoes },
  auditoria: { grupo: 'Visualização', titulo: 'Auditoria', render: paginaAuditoria },
  'config-dados': { grupo: 'Configuração', titulo: 'Dados do leiloeiro', render: paginaConfigDados },
  'config-termo': { grupo: 'Configuração', titulo: 'Termo de aceite', render: paginaConfigTermo },
  'config-equipe': { grupo: 'Configuração', titulo: 'Equipe e acessos', render: paginaConfigEquipe },
  'config-notificacoes': { grupo: 'Configuração', titulo: 'Notificações', render: paginaConfigNotificacoes },
  'config-privacidade': { grupo: 'Configuração', titulo: 'Privacidade (LGPD)', render: paginaConfigPrivacidade },
  'config-integracoes': { grupo: 'Configuração', titulo: 'Integrações', render: paginaConfigIntegracoes },
};

let operador = null;
let estado = { filtro: 'pendente', selecionado: null, secao: 'dados', busca: '' };
let tt;

// ---------- Utilitários ----------
function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v; // via CSSOM: permitido pela CSP (atributo style seria bloqueado)
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat(Infinity)) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : String(f));
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
  if (!res.ok) throw Object.assign(new Error(corpo.mensagem || corpo.erro || `Erro ${res.status}`), { status: res.status, codigo: corpo.erro });
  return corpo;
}
const enviar = (rota, metodo, corpo) => api(rota, { method: metodo, body: JSON.stringify(corpo ?? {}) });
const fmtData = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDia = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const fmtCpf = (c) => (c || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const fmtCnpj = (c) => (c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtCel = (c) => (c ? c.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '—');
function rel(d) {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 60 ? `há ${Math.max(m, 1)} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
}
const atrasado = (d) => Date.now() - new Date(d) > 24 * 3600 * 1000;
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(tt); tt = setTimeout(() => (e.hidden = true), 4000); }
function copiar(texto, rotulo = 'Copiado') {
  navigator.clipboard?.writeText(texto).then(() => toast(rotulo)).catch(() => toast('Não foi possível copiar. Selecione e copie manualmente.'));
}
const etiqueta = (status) => el('span', { class: `etiqueta ${status}` }, STATUS[status] || status);
const cartao = (titulo, acoes, ...corpo) => el('section', { class: 'cartao' },
  titulo ? el('div', { class: 'cartao-topo' }, el('h2', {}, titulo), acoes || null) : null, ...corpo);
const ehDono = () => operador?.papel === 'dono';

function descreverAtividade(a) {
  const quem = a.operador || 'Sistema';
  const arr = a.arrematante || 'Arrematante';
  const d = a.detalhes || {};
  const mapa = {
    'arrematante.criado': [`Novo cadastro: ${arr}`, 'azul'],
    'arrematante.complementado': [`${arr} completou dados do cadastro`, 'azul'],
    'habilitacao.solicitada': [`${arr} solicitou habilitação`, 'azul'],
    'habilitacao.aprovado': [`${arr} aprovado(a) por ${quem}`, 'ok'],
    'habilitacao.recusado': [`${arr} recusado(a) por ${quem}${d.motivo ? `: ${d.motivo}` : ''}`, 'erro'],
    'habilitacao.revogado': [`Habilitação de ${arr} revogada por ${quem}`, 'erro'],
    'exportacao.pacote': [`Exportação ZIP (${d.quantidade ?? '?'} cadastros, ${d.documentos ?? 0} documentos) por ${quem}`, ''],
    'exportacao.habilitados': [`Exportação CSV (${d.quantidade ?? '?'} cadastros) por ${quem}`, ''],
    'config.termo_publicado': [`Termo de aceite publicado (versão ${d.versao}) por ${quem}`, ''],
    'config.dados_alterados': [`Dados do leiloeiro alterados por ${quem}`, ''],
    'config.privacidade_alterada': [`Privacidade (encarregado) alterada por ${quem}`, ''],
    'equipe.convidado': [`${quem} deu acesso a ${d.email} (${d.papel === 'dono' ? 'responsável' : 'operador'})`, ''],
    'equipe.alterado': [`${quem} alterou o acesso de um membro da equipe`, ''],
    'painel.login': [`${quem} entrou no painel`, ''],
    'painel.login_falhou': [`Tentativa de login com senha errada${d.bloqueou ? ' (acesso bloqueado 15 min)' : ''}: ${quem}`, 'erro'],
    'painel.ficha_visualizada': [`${quem} abriu a ficha #${d.habilitacao}`, ''],
    'painel.documento_aberto': [`${quem} abriu um documento da habilitação #${d.habilitacao}`, ''],
  };
  return mapa[a.acao] || [a.acao, ''];
}

// ---------- Sessão ----------
function mostrarLogin() { $('#tela-app').hidden = true; $('#tela-login').hidden = false; $('#login-email').focus(); }

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('#login-erro');
  erro.hidden = true;
  try {
    await enviar('/login', 'POST', { email: $('#login-email').value, senha: $('#login-senha').value });
    $('#login-senha').value = '';
    await iniciar();
  } catch (e) {
    erro.textContent = e.codigo === 'bloqueado' ? 'Muitas tentativas. Acesso bloqueado por 15 minutos.'
      : e.codigo === 'invalido' ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar. Tente novamente.';
    erro.hidden = false;
  }
});
$('#btn-sair').addEventListener('click', async () => { await enviar('/logout', 'POST').catch(() => undefined); operador = null; mostrarLogin(); });

function atualizarBadge(n) { const b = $('#badge-pendentes'); b.textContent = n || 0; b.hidden = !n; }

// ---------- Roteamento ----------
async function navegar() {
  const [rota, param] = (location.hash.replace(/^#/, '') || 'visao-geral').split('/');
  const pagina = PAGINAS[rota] || PAGINAS['visao-geral'];
  document.querySelectorAll('.grupo a').forEach((a) => a.setAttribute('aria-current', a.dataset.rota === rota ? 'page' : 'false'));
  $('#trilha').textContent = `${pagina.grupo} / ${pagina.titulo}`;
  $('#titulo').textContent = pagina.titulo;
  document.title = `${pagina.titulo} · Painel do leiloeiro`;
  $('#topo-acoes').replaceChildren();
  const alvo = $('#pagina');
  alvo.replaceChildren(el('p', { class: 'vazio' }, 'Carregando…'));
  try {
    await pagina.render(alvo, param);
  } catch (e) {
    alvo.replaceChildren(el('p', { class: 'alerta erro' }, `Não foi possível carregar: ${e.message}`));
  }
}
window.addEventListener('hashchange', () => { if (operador) navegar(); });

// ---------- Visão geral ----------
async function paginaVisaoGeral(alvo) {
  const r = await api('/resumo');
  const k = r.indicadores;
  atualizarBadge(k.pendentes);
  const tempo = k.tempoMedioMin == null ? '—' : k.tempoMedioMin < 60 ? `${k.tempoMedioMin} min` : `${Math.floor(k.tempoMedioMin / 60)}h${String(k.tempoMedioMin % 60).padStart(2, '0')}`;

  const kpis = el('section', { class: 'kpis', 'aria-label': 'Indicadores' },
    el('div', { class: 'kpi' }, el('small', {}, 'Aguardando análise'), el('strong', { class: k.pendentes ? 'alerta' : '' }, k.pendentes), el('span', {}, k.atrasados ? `${k.atrasados} há mais de 24 h` : 'Nenhuma atrasada')),
    el('div', { class: 'kpi' }, el('small', {}, 'Aprovados · 30 dias'), el('strong', {}, k.aprovados30), el('span', {}, 'Decisões dos últimos 30 dias')),
    el('div', { class: 'kpi' }, el('small', {}, 'Tempo médio de análise'), el('strong', {}, tempo), el('span', {}, 'Do envio à decisão, 30 dias')),
    el('div', { class: 'kpi' }, el('small', {}, 'Taxa de recusa'), el('strong', {}, k.taxaRecusa == null ? '—' : `${k.taxaRecusa}%`), el('span', {}, 'Recusadas sobre decididas, 30 dias')),
  );

  const fila = cartao('Aguardando análise', el('a', { href: '#habilitacoes' }, 'Ver fila completa →'),
    r.fila.length ? el('div', { class: 'tabela-caixa' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Arrematante'), el('th', { scope: 'col' }, 'Tipo'), el('th', { scope: 'col' }, 'Cidade'), el('th', { scope: 'col' }, 'Recebido'), el('th', { scope: 'col' }, ''))),
      el('tbody', {}, r.fila.map((f) => el('tr', {},
        el('td', {}, el('strong', {}, f.nome)),
        el('td', {}, el('span', { class: 'etiqueta neutro' }, f.pj ? 'PJ' : 'PF')),
        el('td', {}, f.cidade ? `${f.cidade}/${f.uf}` : '—'),
        el('td', { class: atrasado(f.consentido_em) ? 'atrasado' : '' }, rel(f.consentido_em)),
        el('td', { style: 'text-align:right' }, el('a', { class: 'btn primario pequeno', href: `#habilitacoes/${f.id}` }, 'Analisar')))))))
      : el('p', { class: 'vazio' }, 'Nenhuma habilitação aguardando análise.'));

  const atividade = cartao('Atividade recente', null, r.atividade.length
    ? el('ol', { class: 'atividade' }, r.atividade.map((a) => { const [t, c] = descreverAtividade(a); return el('li', {}, el('span', { class: `ponto ${c}` }), el('div', {}, el('span', {}, t), el('small', {}, fmtData(a.em)))); }))
    : el('p', { class: 'vazio' }, 'Sem atividade ainda.'));

  const exp = r.ultimaExportacao;
  const exportar = cartao('Exportar para a plataforma de leilão', null, el('div', { class: 'cartao-corpo', style: 'display:flex;flex-direction:column;gap:12px' },
    el('p', { style: 'margin:0' }, 'Pacote ZIP com a planilha de habilitados e os documentos de cada arrematante, pronto para importar.'),
    el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px' },
      el('a', { class: 'btn primario', href: `${API}/exportar-pacote?status=aprovado` }, 'Baixar aprovados (ZIP)'),
      el('a', { class: 'btn secundario', href: `${API}/exportar?status=aprovado` }, 'Só planilha (CSV)')),
    el('small', { class: 'suave' }, exp ? `Última exportação: ${fmtData(exp.em)} · ${exp.detalhes?.quantidade ?? '?'} cadastros · ${exp.operador || ''}` : 'Nenhuma exportação feita ainda.')));

  const pubs = cartao('Jornal Imprensa Leilões', el('a', { href: '#editais' }, 'Ver tudo →'), el('div', { class: 'cartao-corpo' },
    r.publicacoes.length ? el('ul', { class: 'publicacoes' }, r.publicacoes.map((p) => el('li', {},
      el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.titulo),
      el('small', { class: 'suave' }, p.tipo === 'edicao' ? 'PDF' : fmtDia(p.publicado_em || p.coletado_em)))))
      : el('p', { class: 'suave', style: 'margin:0' }, 'Nenhuma notícia coletada ainda.')));

  alvo.replaceChildren(kpis,
    el('div', { class: 'grade-3' }, el('div', { class: 'ocupa-2' }, fila), atividade),
    el('div', { class: 'grade-2' }, exportar, pubs));
}

// ---------- Habilitações ----------
async function paginaHabilitacoes(alvo, param) {
  if (param) { estado.selecionado = Number(param); }
  $('#topo-acoes').append(el('a', { class: 'btn secundario', href: `${API}/exportar-pacote?status=aprovado` }, 'Exportar aprovados (ZIP)'));
  const listaBox = el('div', { class: 'lista-itens' });
  const fichaBox = el('section', { class: 'cartao ficha', 'aria-label': 'Ficha do arrematante' }, el('p', { class: 'vazio' }, 'Selecione uma habilitação.'));
  const abas = el('div', { class: 'abas', role: 'tablist', 'aria-label': 'Filtrar por status' });
  const busca = el('input', { type: 'search', id: 'busca-hab', placeholder: 'Nome, CPF ou e-mail', value: estado.busca });
  let timer;
  busca.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { estado.busca = busca.value; carregar(); }, 300); });

  async function carregar() {
    const { itens, contagem } = await api(`/habilitacoes?status=${estado.filtro}&q=${encodeURIComponent(estado.busca.trim())}`);
    atualizarBadge(contagem.pendente || 0);
    const total = Object.values(contagem).reduce((a, b) => a + b, 0);
    abas.replaceChildren(...[['pendente', 'Pendentes', contagem.pendente || 0], ['aprovado', 'Aprovados', contagem.aprovado || 0], ['recusado', 'Recusados', (contagem.recusado || 0) + (contagem.revogado || 0)], ['todos', 'Todos', total]]
      .map(([id, rotulo, n]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(estado.filtro === id), onclick: () => { estado.filtro = id; carregar(); } }, rotulo, el('span', { class: 'contador' }, n))));
    listaBox.replaceChildren(...(itens.length ? itens.map((i) => el('button', {
      type: 'button', class: 'item', 'aria-current': String(i.id === estado.selecionado),
      onclick: () => { location.hash = `#habilitacoes/${i.id}`; },
    }, el('span', { class: 'nome' }, i.nome), etiqueta(i.status),
      el('span', { class: 'meta' }, `${i.cnpj ? 'PJ' : 'PF'} · CPF final ${i.cpf_final}${i.cidade ? ` · ${i.cidade}/${i.uf}` : ''}`),
      el('span', { class: `quando ${i.status === 'pendente' && atrasado(i.consentido_em) ? 'atrasado' : ''}` }, rel(i.consentido_em))))
      : [el('p', { class: 'vazio' }, 'Nenhuma habilitação nesta aba.')]));
  }

  async function abrirFicha(id) {
    fichaBox.replaceChildren(el('p', { class: 'vazio' }, 'Carregando…'));
    let f;
    try { f = await api(`/habilitacoes/${id}`); } catch (e) { fichaBox.replaceChildren(el('p', { class: 'vazio' }, e.message)); return; }
    const a = f.arrematante;
    const pend = (v) => (v ? v : el('span', { class: 'pendente-texto' }, '— pendente'));
    const campos = [
      ['E-mail', [a.email, ' ', a.email_verificado_em ? el('span', { class: 'etiqueta ok' }, 'confirmado') : null]],
      ['CPF', el('span', { class: 'mono' }, fmtCpf(a.cpf))],
      ...(a.cnpj
        ? [['CNPJ', el('span', { class: 'mono' }, fmtCnpj(a.cnpj))], ['Razão social', pend(a.razao_social)], ['Representante legal', `${a.nome} · CPF ${fmtCpf(a.cpf)}`], ['Inscrição estadual', a.rg_ie || '—']]
        : [['RG', el('span', { class: 'mono' }, a.rg_ie || '—')], ['Nascimento', pend(a.data_nascimento)], ['Estado civil', pend(a.estado_civil)], ['Profissão', pend(a.profissao)]]),
      ['Celular', el('span', { class: 'mono' }, fmtCel(a.celular))],
      ['Endereço', a.endereco],
      ['Termo', `Versão ${f.termo_versao}, aceito em ${fmtData(f.consentido_em)}`],
    ];
    const docNome = { identidade: a.cnpj ? 'Documento do representante' : 'RG / CNH', comprovante_residencia: 'Comprovante de residência' };
    const secoes = {
      dados: () => el('div', { class: 'campos' }, campos.map(([r, v]) => el('div', { class: 'campo' }, el('small', {}, r), el('span', {}, v)))),
      docs: () => el('div', {}, el('div', { class: 'docs' }, f.documentos.length ? f.documentos.map((d) => el('div', { class: 'doc' },
        el('div', {}, el('strong', {}, docNome[d.tipo] || d.tipo), el('small', { class: 'suave' }, `${d.mime === 'application/pdf' ? 'PDF' : 'Imagem'} · ${Math.max(1, Math.round(d.tamanho_bytes / 1024))} KB`)),
        el('a', { class: 'btn secundario pequeno', target: '_blank', rel: 'noopener', href: `${API}/habilitacoes/${f.id}/documentos/${d.tipo}` }, 'Abrir')))
        : el('p', { class: 'suave' }, 'Nenhum documento disponível (pode ter vencido o prazo de guarda).')),
        el('p', { class: 'suave', style: 'margin:0 24px 16px;font-size:12px' }, 'Documentos guardados criptografados. Cada abertura fica registrada no histórico.')),
      hist: () => el('ol', { class: 'historico' }, f.historico.map((h) => { const [t] = descreverAtividade({ ...h, operador: h.quem, arrematante: a.nome }); return el('li', {}, el('span', { class: 'mono suave' }, fmtData(h.em)), el('span', {}, t)); })),
    };
    const corpo = el('div', {});
    const abasFicha = el('div', { class: 'abas', role: 'tablist', 'aria-label': 'Seções da ficha' });
    const desenharSecao = () => {
      abasFicha.replaceChildren(...[['dados', 'Dados cadastrais'], ['docs', `Documentos (${f.documentos.length})`], ['hist', 'Histórico']].map(([id, r]) =>
        el('button', { type: 'button', role: 'tab', 'aria-selected': String(estado.secao === id), onclick: () => { estado.secao = id; desenharSecao(); } }, r)));
      corpo.replaceChildren(secoes[estado.secao]());
    };
    desenharSecao();

    const decisao = el('div', { class: 'decisao' });
    if (f.status === 'pendente') montarDecisaoPendente(decisao, f);
    else {
      decisao.append(el('p', { style: 'margin:0' }, `${STATUS[f.status]} por ${f.decidido_por || '—'} em ${fmtData(f.decidido_em)}.`, f.motivo ? ` Motivo: ${f.motivo}` : ''));
      if (f.status === 'aprovado') montarMotivo(decisao, f, 'revogado', 'Revogar habilitação');
    }
    fichaBox.replaceChildren(
      el('div', { class: 'ficha-cabeca' },
        el('div', {}, el('h2', {}, a.cnpj && a.razao_social ? a.razao_social : a.nome),
          el('span', { class: 'suave' }, `Habilitação #${f.id} · ${a.cnpj ? 'Pessoa jurídica' : 'Pessoa física'}${a.cidade ? ` · ${a.cidade}/${a.uf}` : ''}`)),
        etiqueta(f.status)),
      abasFicha, corpo, decisao);
  }

  function montarDecisaoPendente(box, f) {
    const c1 = el('input', { type: 'checkbox', id: `c1-${f.id}` });
    const c2 = el('input', { type: 'checkbox', id: `c2-${f.id}` });
    const aprovar = el('button', { type: 'button', class: 'btn aprovar', disabled: true }, 'Aprovar habilitação');
    const dica = el('span', { class: 'suave' }, 'Marque as duas conferências para liberar a aprovação.');
    const upd = () => { aprovar.disabled = !(c1.checked && c2.checked); dica.textContent = aprovar.disabled ? 'Marque as duas conferências para liberar a aprovação.' : 'O arrematante recebe a decisão no Telegram na hora.'; };
    c1.addEventListener('change', upd); c2.addEventListener('change', upd);
    aprovar.addEventListener('click', () => decidir(f.id, 'aprovado', null, aprovar));
    box.append(
      el('div', { class: 'checks' },
        el('label', { class: 'check', for: c1.id }, c1, 'Documento legível e nome confere com o cadastro'),
        el('label', { class: 'check', for: c2.id }, c2, 'Comprovante recente e endereço confere')),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;align-items:center' }, aprovar, dica));
    montarMotivo(box, f, 'recusado', 'Recusar…');
  }

  function montarMotivo(box, f, decisao, rotulo) {
    const abrir = el('button', { type: 'button', class: 'btn perigo' }, rotulo);
    const sel = el('select', { id: `motivo-${f.id}` }, el('option', { value: '' }, 'Escolha um motivo…'), MOTIVOS.map((m) => el('option', {}, m)), el('option', { value: 'outro' }, 'Outro motivo…'));
    const txt = el('textarea', { rows: 2, maxlength: 500, placeholder: 'Descreva o motivo (o arrematante recebe no Telegram)', hidden: true });
    const confirmar = el('button', { type: 'button', class: 'btn perigo', disabled: true }, 'Confirmar');
    const voltar = el('button', { type: 'button', class: 'btn secundario' }, 'Voltar');
    const caixa = el('div', { class: 'motivo', hidden: true }, el('label', { for: sel.id }, 'Motivo (enviado ao arrematante)'), sel, txt, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, confirmar, voltar));
    const motivo = () => (sel.value === 'outro' ? txt.value.trim() : sel.value);
    const upd = () => { txt.hidden = sel.value !== 'outro'; confirmar.disabled = motivo().length < 10; };
    sel.addEventListener('change', upd); txt.addEventListener('input', upd);
    abrir.addEventListener('click', () => { caixa.hidden = false; abrir.hidden = true; sel.focus(); });
    voltar.addEventListener('click', () => { caixa.hidden = true; abrir.hidden = false; });
    confirmar.addEventListener('click', () => decidir(f.id, decisao, motivo(), confirmar));
    box.append(el('div', {}, abrir), caixa);
  }

  async function decidir(id, decisao, motivo, botao) {
    botao.disabled = true;
    try {
      const r = await enviar(`/habilitacoes/${id}/decisao`, 'POST', { decisao, motivo });
      toast(`${STATUS[decisao]}. ${r.avisado ? 'Arrematante avisado no Telegram.' : 'Não foi possível avisar no Telegram.'}`);
    } catch (e) {
      toast(e.codigo === 'status_mudou_ou_nao_encontrado' ? 'Outra pessoa já decidiu esta habilitação.' : `Erro: ${e.message}`);
    }
    await Promise.all([carregar(), abrirFicha(id)]);
  }

  alvo.replaceChildren(
    el('div', { class: 'cartao' }, abas),
    el('div', { class: 'mesa' },
      el('section', { class: 'cartao lista', 'aria-label': 'Lista de habilitações' },
        el('div', { class: 'lista-busca' }, el('label', { for: 'busca-hab', class: 'so-leitor' }, 'Buscar'), busca), listaBox),
      fichaBox));
  await carregar();
  if (estado.selecionado) { estado.secao = 'dados'; await abrirFicha(estado.selecionado); }
}

// ---------- Arrematantes ----------
async function paginaArrematantes(alvo) {
  const busca = el('input', { type: 'search', id: 'busca-arr', placeholder: 'Buscar por nome, CPF ou e-mail', style: 'max-width:420px' });
  const corpo = el('div', { class: 'tabela-caixa' });
  let timer;
  const carregar = async () => {
    const { itens } = await api(`/habilitacoes?status=todos&q=${encodeURIComponent(busca.value.trim())}`);
    corpo.replaceChildren(itens.length ? el('table', {},
      el('thead', {}, el('tr', {}, ['Nome', 'Tipo', 'CPF', 'Cidade', 'Situação', 'Cadastro'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, itens.map((i) => el('tr', { class: 'clicavel', tabindex: 0, onclick: () => (location.hash = `#habilitacoes/${i.id}`), onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#habilitacoes/${i.id}`; } },
        el('td', {}, el('strong', {}, i.nome)), el('td', {}, el('span', { class: 'etiqueta neutro' }, i.cnpj ? 'PJ' : 'PF')),
        el('td', { class: 'mono' }, `***.***.*${i.cpf_final.slice(0, 2)}-${i.cpf_final.slice(2)}`), el('td', {}, i.cidade ? `${i.cidade}/${i.uf}` : '—'),
        el('td', {}, etiqueta(i.status)), el('td', {}, fmtData(i.consentido_em))))))
      : el('p', { class: 'vazio' }, 'Nenhum arrematante encontrado.'));
  };
  busca.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(carregar, 300); });
  estado.filtro = 'todos';
  alvo.replaceChildren(cartao('Arrematantes habilitados neste leiloeiro', el('div', {}, el('label', { for: 'busca-arr', class: 'so-leitor' }, 'Buscar'), busca), corpo));
  await carregar();
}

// ---------- Editais e notícias ----------
async function paginaEditais(alvo) {
  const { itens } = await api('/publicacoes');
  const edicoes = itens.filter((p) => p.tipo === 'edicao');
  const noticias = itens.filter((p) => p.tipo === 'noticia');
  alvo.replaceChildren(
    el('p', { class: 'alerta info' }, 'Coletado automaticamente do Jornal Imprensa Leilões duas vezes ao dia. Os links abrem no site do jornal.'),
    el('div', { class: 'grade-3' },
      cartao('Edições do jornal', null, el('div', { class: 'cartao-corpo' }, edicoes.length ? el('ul', { class: 'publicacoes' }, edicoes.map((p) =>
        el('li', {}, el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.titulo), el('small', { class: 'suave' }, 'PDF'))))
        : el('p', { class: 'suave', style: 'margin:0' }, 'Nenhuma edição coletada.'))),
      el('div', { class: 'ocupa-2' }, cartao('Notícias', null, noticias.length ? el('div', { class: 'tabela-caixa' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Notícia'), el('th', { scope: 'col' }, 'Publicada'))),
        el('tbody', {}, noticias.map((p) => el('tr', {},
          el('td', {}, el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.titulo), p.resumo ? el('div', { class: 'suave', style: 'font-size:13px' }, p.resumo) : null),
          el('td', { class: 'mono', style: 'white-space:nowrap' }, fmtData(p.publicado_em || p.coletado_em)))))))
        : el('p', { class: 'vazio' }, 'Nenhuma notícia coletada ainda.')))));
}

// ---------- Exportações ----------
async function paginaExportacoes(alvo) {
  const sel = el('select', { id: 'exp-status', style: 'max-width:260px' },
    el('option', { value: 'aprovado' }, 'Aprovados'), el('option', { value: 'pendente' }, 'Pendentes'), el('option', { value: 'todos' }, 'Todos'));
  const zip = el('a', { class: 'btn primario' }, 'Baixar pacote ZIP');
  const csv = el('a', { class: 'btn secundario' }, 'Só planilha (CSV)');
  const atualizarLinks = () => { zip.href = `${API}/exportar-pacote?status=${sel.value}`; csv.href = `${API}/exportar?status=${sel.value}`; };
  sel.addEventListener('change', atualizarLinks); atualizarLinks();
  const { itens } = await api('/exportacoes');
  alvo.replaceChildren(
    cartao('Nova exportação', null, el('div', { class: 'cartao-corpo', style: 'display:flex;flex-direction:column;gap:14px' },
      el('div', { class: 'form-campo', style: 'max-width:260px' }, el('label', { for: 'exp-status' }, 'Situação dos cadastros'), sel),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px' }, zip, csv),
      el('p', { class: 'alerta aviso' }, 'O pacote contém dados pessoais e documentos (LGPD). Guarde em local restrito e apague depois de importar na plataforma.'))),
    cartao('Histórico de exportações', null, itens.length ? el('div', { class: 'tabela-caixa' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Quando', 'Formato', 'Situação', 'Cadastros', 'Documentos', 'Por'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, itens.map((x) => el('tr', {},
        el('td', { class: 'mono' }, fmtData(x.em)), el('td', {}, x.acao === 'exportacao.pacote' ? 'ZIP' : 'CSV'),
        el('td', {}, STATUS[x.detalhes?.status] || x.detalhes?.status || '—'), el('td', {}, x.detalhes?.quantidade ?? '—'),
        el('td', {}, x.detalhes?.documentos ?? '—'), el('td', {}, x.operador || (x.detalhes?.via === 'cli' ? 'Linha de comando' : '—')))))))
      : el('p', { class: 'vazio' }, 'Nenhuma exportação feita ainda.')));
}

// ---------- Auditoria ----------
async function paginaAuditoria(alvo) {
  const { itens } = await api('/auditoria');
  alvo.replaceChildren(
    el('p', { class: 'alerta info' }, 'Registro de tudo que acontece neste leiloeiro: cadastros, aberturas de ficha e documento, decisões, exportações, configurações e acessos. Não pode ser editado.'),
    cartao(null, null, itens.length ? el('div', { class: 'tabela-caixa' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Quando'), el('th', { scope: 'col' }, 'Evento'))),
      el('tbody', {}, itens.map((a) => { const [t, c] = descreverAtividade(a); return el('tr', {}, el('td', { class: 'mono', style: 'white-space:nowrap' }, fmtData(a.em)), el('td', {}, el('span', { class: `ponto ${c}`, style: 'display:inline-block;margin:0 8px 0 0' }), t)); }))))
      : el('p', { class: 'vazio' }, 'Nenhum evento registrado.')));
}

// ---------- Configuração ----------
let cacheConfig = null;
async function carregarConfig() { cacheConfig = await api('/config'); return cacheConfig; }
const avisoSomenteLeitura = () => (ehDono() ? null : el('p', { class: 'alerta info' }, 'Somente o responsável pode alterar estas configurações. Você está vendo em modo leitura.'));

function campo(id, rotulo, valor, { tipo = 'text', ajuda, max = 200, largura } = {}) {
  return el('div', { class: 'form-campo', style: largura ? `grid-column:${largura}` : null },
    el('label', { for: id }, rotulo),
    el('input', { id, type: tipo, value: valor ?? '', maxlength: max, disabled: !ehDono() }),
    ajuda ? el('small', {}, ajuda) : null);
}

async function paginaConfigDados(alvo) {
  const { dados, link } = await carregarConfig();
  const salvar = el('button', { type: 'button', class: 'btn primario', disabled: !ehDono() }, 'Salvar alterações');
  salvar.addEventListener('click', async () => {
    salvar.disabled = true;
    try {
      await enviar('/config/dados', 'PUT', { nome: $('#c-nome').value, site_url: $('#c-site').value, email_contato: $('#c-email').value, matricula: $('#c-matricula').value });
      toast('Alterações salvas.');
      $('#nome-leiloeiro').textContent = $('#c-nome').value;
    } catch (e) { toast(e.message); }
    salvar.disabled = false;
  });
  if (ehDono()) $('#topo-acoes').append(salvar);
  alvo.replaceChildren(avisoSomenteLeitura() || '',
    cartao('Link de habilitação', null, el('div', { class: 'cartao-corpo', style: 'display:flex;flex-direction:column;gap:10px' },
      link ? el('div', { class: 'link-caixa' }, el('code', {}, link), el('button', { type: 'button', class: 'btn secundario pequeno', onclick: () => copiar(link, 'Link copiado') }, 'Copiar link'))
        : el('p', { class: 'suave', style: 'margin:0' }, 'Link indisponível no momento.'),
      el('small', { class: 'suave' }, 'Divulgue nos editais, no site e no WhatsApp. Quem abre o link cai direto no termo deste leiloeiro.'))),
    cartao('Identificação', null, el('div', { class: 'cartao-corpo' }, el('div', { class: 'form' },
      campo('c-nome', 'Nome de exibição', dados.nome, { max: 80, ajuda: 'Aparece para o arrematante no Telegram.' }),
      campo('c-matricula', 'Matrícula na Junta Comercial', dados.matricula, { max: 60 }),
      campo('c-site', 'Site', dados.site_url, { tipo: 'url' }),
      campo('c-email', 'E-mail de contato', dados.email_contato, { tipo: 'email' })))));
}

async function paginaConfigTermo(alvo) {
  const [{ dados }, { versoes }] = await Promise.all([carregarConfig(), api('/config/termo')]);
  const texto = el('textarea', { id: 'c-termo', rows: 8, maxlength: 5000, disabled: !ehDono() });
  texto.value = dados.termo_texto;
  const publicar = el('button', { type: 'button', class: 'btn primario', disabled: !ehDono() }, `Publicar como versão ${dados.termo_versao + 1}`);
  publicar.addEventListener('click', async () => {
    if (texto.value.trim() === dados.termo_texto.trim()) { toast('O texto não mudou.'); return; }
    if (!window.confirm(`Publicar a versão ${dados.termo_versao + 1}? Novos cadastros passam a aceitar este texto.`)) return;
    publicar.disabled = true;
    try { const r = await enviar('/config/termo', 'POST', { texto: texto.value }); toast(`Versão ${r.versao} publicada.`); await navegar(); }
    catch (e) { toast(e.message); publicar.disabled = false; }
  });
  alvo.replaceChildren(avisoSomenteLeitura() || '',
    cartao(`Texto em vigor · versão ${dados.termo_versao}`, null, el('div', { class: 'cartao-corpo', style: 'display:flex;flex-direction:column;gap:12px' },
      el('label', { for: 'c-termo', class: 'so-leitor' }, 'Texto do termo'), texto,
      el('small', { class: 'suave' }, 'Mínimo 50 caracteres. Quem já aceitou uma versão anterior mantém o registro daquela versão.'),
      ehDono() ? el('div', {}, publicar) : null)),
    cartao('Versões publicadas', null, el('div', { class: 'tabela-caixa' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Versão', 'Publicada em', 'Por', 'Aceites'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, versoes.map((v) => el('tr', {}, el('td', { class: 'mono' }, `v${v.versao}`), el('td', {}, fmtData(v.publicado_em)), el('td', {}, v.publicado_por || '—'), el('td', {}, v.aceites))))))));
}

async function paginaConfigEquipe(alvo) {
  const { itens, eu } = await api('/equipe');
  const linhas = itens.map((p) => {
    const acoes = [];
    if (ehDono() && p.id !== eu) {
      acoes.push(el('button', { type: 'button', class: 'btn secundario pequeno', onclick: () => alterar(p.id, { ativo: !p.ativo }, p.ativo ? 'Acesso desativado.' : 'Acesso reativado.') }, p.ativo ? 'Desativar' : 'Reativar'));
      if (p.ativo) {
        acoes.push(el('button', { type: 'button', class: 'btn secundario pequeno', onclick: () => alterar(p.id, { papel: p.papel === 'dono' ? 'operador' : 'dono' }, 'Papel alterado.') }, p.papel === 'dono' ? 'Tornar operador' : 'Tornar responsável'));
        acoes.push(el('button', { type: 'button', class: 'btn secundario pequeno', onclick: () => alterar(p.id, { redefinirSenha: true }, null, p.email) }, 'Nova senha'));
      }
    }
    return el('tr', {},
      el('td', {}, el('strong', {}, p.nome || p.email), el('div', { class: 'suave', style: 'font-size:12px' }, p.email), p.id === eu ? el('span', { class: 'etiqueta neutro' }, 'você') : null),
      el('td', {}, p.papel === 'dono' ? 'Responsável' : 'Operador'),
      el('td', { class: 'mono' }, p.ultimo_acesso ? fmtData(p.ultimo_acesso) : 'nunca'),
      el('td', {}, !p.ativo ? el('span', { class: 'etiqueta erro' }, 'Desativado') : p.bloqueado ? el('span', { class: 'etiqueta alerta' }, 'Bloqueado 15 min') : el('span', { class: 'etiqueta ok' }, 'Ativo')),
      el('td', {}, el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, acoes)));
  });

  async function alterar(id, corpo, msg, email) {
    try {
      const r = await enviar(`/equipe/${id}`, 'PATCH', corpo);
      if (r.senha) { await navegar(); mostrarSenhaDepois(email, r.senha); return; }
      toast(msg); await navegar();
    } catch (e) { toast(e.message); }
  }

  const form = el('form', { class: 'form', onsubmit: async (ev) => {
    ev.preventDefault();
    try {
      const email = $('#n-email').value;
      const r = await enviar('/equipe', 'POST', { nome: $('#n-nome').value, email, papel: $('#n-papel').value });
      await navegar(); mostrarSenhaDepois(email, r.senha);
    } catch (e) { toast(e.message); }
  } },
    el('div', { class: 'form-campo' }, el('label', { for: 'n-nome' }, 'Nome'), el('input', { id: 'n-nome', type: 'text', required: true, maxlength: 120 })),
    el('div', { class: 'form-campo' }, el('label', { for: 'n-email' }, 'E-mail'), el('input', { id: 'n-email', type: 'email', required: true, maxlength: 254 })),
    el('div', { class: 'form-campo' }, el('label', { for: 'n-papel' }, 'Papel'), el('select', { id: 'n-papel' }, el('option', { value: 'operador' }, 'Operador'), el('option', { value: 'dono' }, 'Responsável'))),
    el('div', { class: 'form-campo', style: 'justify-content:flex-end' }, el('button', { type: 'submit', class: 'btn primario' }, 'Dar acesso')));

  alvo.replaceChildren(avisoSomenteLeitura() || '',
    cartao('Pessoas com acesso', null, el('div', { class: 'tabela-caixa' }, el('table', {},
      el('thead', {}, el('tr', {}, ['Pessoa', 'Papel', 'Último acesso', 'Situação', ''].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, linhas))),
      el('p', { class: 'suave', style: 'margin:0;padding:14px 20px;font-size:12px;border-top:1px solid var(--linha-2)' },
        'Responsável: altera configurações, termo e equipe. Operador: analisa, aprova, recusa e exporta. Cada pessoa tem login próprio; o acesso bloqueia por 15 min após 5 senhas erradas.')),
    ehDono() ? cartao('Dar acesso a uma pessoa', null, el('div', { class: 'cartao-corpo' }, form)) : '');
}
let senhaPendente = null;
function mostrarSenhaDepois(email, senha) { senhaPendente = { email, senha }; renderSenhaPendente(); }
function renderSenhaPendente() {
  if (!senhaPendente) return;
  const aviso = el('div', { class: 'senha-gerada', role: 'status' },
    el('span', {}, `Senha temporária de ${senhaPendente.email}:`), el('code', {}, senhaPendente.senha),
    el('button', { type: 'button', class: 'btn secundario pequeno', onclick: ((s) => () => copiar(s, 'Senha copiada'))(senhaPendente.senha) }, 'Copiar'),
    el('small', { class: 'suave', style: 'flex-basis:100%' }, 'Ela aparece só agora. Entregue por um canal seguro; você pode gerar outra a qualquer momento.'));
  $('#pagina').prepend(aviso);
  senhaPendente = null;
}

async function paginaConfigNotificacoes(alvo) {
  alvo.replaceChildren(cartao('Em breve', null, el('div', { class: 'cartao-corpo', style: 'display:flex;flex-direction:column;gap:10px' },
    el('p', { style: 'margin:0' }, 'Avisos por e-mail para a equipe (nova habilitação, fila parada há mais de 24 h, resumo semanal) ainda não estão disponíveis.'),
    el('p', { class: 'suave', style: 'margin:0' }, 'Enquanto isso, o contador dourado no menu mostra quantas habilitações aguardam análise, e os arrematantes já são avisados no Telegram a cada decisão.'))));
}

async function paginaConfigPrivacidade(alvo) {
  const { dados } = await carregarConfig();
  const salvar = el('button', { type: 'button', class: 'btn primario', disabled: !ehDono() }, 'Salvar encarregado');
  salvar.addEventListener('click', async () => {
    salvar.disabled = true;
    try { await enviar('/config/privacidade', 'PUT', { dpo_nome: $('#c-dpo-nome').value, dpo_email: $('#c-dpo-email').value }); toast('Alterações salvas.'); }
    catch (e) { toast(e.message); }
    salvar.disabled = false;
  });
  alvo.replaceChildren(avisoSomenteLeitura() || '',
    el('div', { class: 'grade-3' },
      el('div', { class: 'kpi' }, el('small', {}, 'Criptografia'), el('strong', { style: 'font-size:18px' }, 'AES-256-GCM'), el('span', {}, 'Todos os documentos, antes de sair do servidor')),
      el('div', { class: 'kpi' }, el('small', {}, 'Guarda de documentos'), el('strong', { style: 'font-size:18px' }, '180 dias'), el('span', {}, 'Depois disso os arquivos são apagados automaticamente')),
      el('div', { class: 'kpi' }, el('small', {}, 'Direito de exclusão'), el('strong', { style: 'font-size:18px' }, '/excluirmeusdados'), el('span', {}, 'O titular apaga os próprios dados pelo bot'))),
    cartao('Encarregado pelo tratamento de dados (DPO)', ehDono() ? salvar : null, el('div', { class: 'cartao-corpo' }, el('div', { class: 'form' },
      campo('c-dpo-nome', 'Nome', dados.dpo_nome, { max: 120 }),
      campo('c-dpo-email', 'E-mail', dados.dpo_email, { tipo: 'email', ajuda: 'Canal para o titular exercer direitos da LGPD.' })))));
}

async function paginaConfigIntegracoes(alvo) {
  const { integracoes: i } = await carregarConfig();
  const item = (nome, situacao, classe, detalhe) => el('section', { class: 'cartao' }, el('div', { class: 'cartao-corpo', style: 'display:flex;flex-direction:column;gap:8px' },
    el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' }, el('h2', { style: 'font-size:15px' }, nome), el('span', { class: `etiqueta ${classe}` }, situacao)),
    el('span', { class: 'suave' }, detalhe)));
  alvo.replaceChildren(el('div', { class: 'grade-2' },
    item('Bot do Telegram', i.bot ? 'Conectado' : 'Indisponível', i.bot ? 'ok' : 'erro', i.bot ? `${i.bot} recebendo cadastros pelo link deste leiloeiro.` : 'Não foi possível identificar o bot.'),
    item('E-mail de confirmação', i.emailDominioProprio ? 'Domínio próprio' : 'Domínio pendente', i.emailDominioProprio ? 'ok' : 'alerta',
      i.emailDominioProprio ? 'Códigos de confirmação saem do domínio do leiloeiro.' : 'Sem domínio verificado, o código só chega no e-mail do dono da conta de envio. Verifique um domínio (ex.: mail.colodeteleiloes.com.br).'),
    item('Jornal Imprensa Leilões', i.ultimaColeta ? 'Coletando' : 'Sem coleta', i.ultimaColeta ? 'ok' : 'alerta', i.ultimaColeta ? `Última coleta: ${fmtData(i.ultimaColeta)}.` : 'Nenhuma coleta registrada ainda.'),
    item('Plataforma de leilão', 'Exportação ZIP', 'neutro', 'Planilha + documentos de cada habilitado, prontos para importar. Integração direta: a definir.')));
}

// ---------- Início ----------
async function iniciar() {
  try {
    ({ operador } = await api('/me'));
    $('#nome-leiloeiro').textContent = operador.leiloeiro_nome;
    $('#usuario-nome').textContent = operador.nome || operador.email;
    $('#usuario-detalhe').textContent = `${operador.papel === 'dono' ? 'Responsável' : 'Operador'} · ${operador.email}`;
    $('#tela-login').hidden = true;
    $('#tela-app').hidden = false;
    await navegar();
  } catch {
    mostrarLogin();
  }
}
iniciar();
