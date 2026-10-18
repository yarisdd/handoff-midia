// Story das 18:30 — "Inscrições abertas" (substitui o antigo "Nas ligas hoje").
//
// Este arquivo REDEFINE storiesPrepararPub_ de Publicações.gs. No Apps Script, quando duas funções têm
// o mesmo nome, vale a do arquivo que vem por último na lista; por isso este arquivo fica abaixo de
// Publicações.gs. Quem mexer em storiesPrepararPub_ daqui pra frente deve editar ESTA versão.
//
// O que muda: a linha "L<dia>" da aba Stories deixa de listar as ligas que postaram no dia e passa a
// listar até 5 eventos com inscrição aberta (da aba Base), pelo prazo mais perto. O evento que entrou
// hoje ganha o selo NOVO. O tipo continua 'ligas', então a publicação e a marcação dos perfis
// (tagsLigasPub_, que lê o 1º campo de cada linha) seguem iguais. Cada linha é:
//     usuario|organização|evento|prazo|novo        ex.: laa.unisul|LAA|Workshop de IOT|até 28/10|
// Prazo: "Prazo de inscrição" da Base; sem ele, a data do evento. A arte é desenhada pelo
// scripts/gerar_stories.py do repo handoff-midia (modo "abertas", modelo modelos/_story/abertas.html).

const ABERTAS_STORY = { ABA: 'Base', TITULO: 'Inscrições abertas' };

/** dd/MM/yyyy (em qualquer lugar do texto) → número yyyyMMdd; 0 se não achar data. */
function chaveDiaAbertas_(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? Number(m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2)) : 0;
}

/** Eventos da Base com inscrição aberta hoje, do prazo mais perto para o mais longe. */
function eventosAbertosPub_(ss, agora) {
  const sh = ss.getSheetByName(ABERTAS_STORY.ABA);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getDisplayValues();
  const cab = v[0].map(function (c) { return String(c).trim(); });
  const c = { origem: cab.indexOf('Origem'), org: cab.indexOf('Organização'), titulo: cab.indexOf('Título'),
    prazo: cab.indexOf('Prazo de inscrição'), data: cab.indexOf('Data do evento'), recebido: cab.indexOf('Recebido em') };
  if (c.titulo < 0 || c.data < 0) throw new Error('Base sem as colunas "Título" e "Data do evento"');
  const hoje = Number(Utilities.formatDate(agora, PUB.FUSO, 'yyyyMMdd'));
  const amanha = Number(Utilities.formatDate(somaDiasPub_(agora, 1), PUB.FUSO, 'yyyyMMdd'));
  const limpa = function (s) { return String(s || '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  const lista = [];
  v.slice(1).forEach(function (r) {
    const titulo = limpa(r[c.titulo]);
    if (!titulo) return;
    const prazo = (c.prazo >= 0 ? chaveDiaAbertas_(r[c.prazo]) : 0) || chaveDiaAbertas_(r[c.data]);
    if (!prazo || prazo < hoje) return;
    const arroba = String(c.origem >= 0 ? r[c.origem] : '').match(/@([A-Za-z0-9._]+)/);
    const s = String(prazo);
    lista.push({
      user: arroba ? arroba[1].toLowerCase() : '',
      org: limpa(c.org >= 0 ? r[c.org] : ''),
      titulo: titulo,
      prazo: prazo,
      quando: prazo === hoje ? 'até hoje' : prazo === amanha ? 'até amanhã' : 'até ' + s.slice(6) + '/' + s.slice(4, 6),
      novo: c.recebido >= 0 && chaveDiaAbertas_(r[c.recebido]) === hoje,
    });
  });
  lista.sort(function (a, b) { return a.prazo - b.prazo || (b.novo - a.novo) || a.titulo.localeCompare(b.titulo); });
  return lista;
}

/** Garante as linhas da aba Stories (pergunta de hoje e de amanhã; inscrições abertas no fim da tarde). */
function storiesPrepararPub_(ss, agora) {
  if (!STORIES_DIA.ATIVO) return 0;
  const sh = abaStoriesPub_(ss);
  const linhas = lerStoriesPub_(sh);
  const ids = new Set(linhas.map(function (r) { return r.id; }));
  const novas = [];
  [agora, somaDiasPub_(agora, 1)].forEach(function (d) {
    const id = 'P' + diaStoriesPub_(d);
    if (!ids.has(id)) novas.push([id, 'pergunta', diaStoriesPub_(d), JSON.stringify(textosPerguntaPub_(d)), '', 'aguardando', '', '']);
  });
  const idLigas = 'L' + diaStoriesPub_(agora);
  if (agora >= horarioPub_(agora, STORIES_DIA.LIGAS_PREPARAR) && !ids.has(idLigas)) {
    const abertos = eventosAbertosPub_(ss, agora);
    if (abertos.length) {
      const max = STORIES_LIGAS_POS.max;
      const textos = { tipo: 'ligas', modo: 'abertas', titulo: ABERTAS_STORY.TITULO,
        ligas: abertos.slice(0, max).map(function (e) {
          return [e.user, e.org, e.titulo, e.quando, e.novo ? '1' : ''].join('|');
        }).join('\n') };
      if (abertos.length > max) textos.mais = String(abertos.length - max);
      novas.push([idLigas, 'ligas', diaStoriesPub_(agora), JSON.stringify(textos), '', 'aguardando', '', '']);
    }
  }
  if (novas.length) sh.getRange(sh.getLastRow() + 1, 1, novas.length, STORIES_COLS.length).setValues(novas);
  return novas.length;
}
