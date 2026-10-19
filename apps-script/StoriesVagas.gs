// Story das 21:00 — divulgação do buscador de vagas (yarisdd.github.io/handoff-vagas).
//
// Lê a aba "Vagas do site" (a mesma do vagas.gs) e monta os textos do story. Quem cria a linha "V<dia>"
// na aba Stories é o storiesPrepararPub_ de StoriesAbertas.gs, a partir das 19:30 (STORIES_DIA.VAGAS_PREPARAR);
// a arte sai do scripts/gerar_stories.py do handoff-midia (tipo "vagas", modelo modelos/_story/vagas.html)
// e o storiesDiariosPub_ de Publicações.gs publica às 21:00 (STORIES_DIA.VAGAS).
//
// Cada linha de "vagas" nos textos é
//     categoria|título|instituição · local|rótulo|data|urgente
//     ex.: Eletiva clínica|Visiting Student Electives|UCL Medical School · Londres, Reino Unido|até|30/10|
// rótulo: "até" (inscrição aberta) ou "abre" (abre em breve); urgente: "1" quando fecha em até 3 dias.
// O 1º cartão é sempre a vaga que fecha primeiro; os outros dois mudam a cada dia, para o story não repetir.
// Sem nenhuma vaga aberta ou abrindo em 30 dias, não sai story de vagas no dia.

const VAGAS_STORY = {
  ABA: 'Vagas do site',
  URL: 'yarisdd.github.io/handoff-vagas',
  CARTOES: 3,
  DIAS_EM_BREVE: 30,
  URGENTE_DIAS: 3,
};

/** Textos do story de vagas de hoje, ou null se não houver vaga para mostrar. */
function textosVagasStoryPub_(ss, agora) {
  const sh = ss.getSheetByName(VAGAS_STORY.ABA);
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getDataRange().getValues();
  const cab = v[0].map(function (c) { return String(c).trim(); });
  const ix = {};
  cab.forEach(function (c, i) { ix[c] = i; });
  if (ix.titulo == null || ix.inscricao_fecha == null) return null;

  const hoje = inicioDoDiaPub_(agora);
  const dia = 86400000;
  const limpa = function (s) { return String(s || '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  const col = function (r, nome) { return ix[nome] == null ? '' : r[ix[nome]]; };
  const dm = function (d) { return Utilities.formatDate(d, PUB.FUSO, 'dd/MM'); };

  let total = 0;
  const abertas = [], breve = [];
  v.slice(1).forEach(function (r) {
    const titulo = limpa(col(r, 'titulo'));
    if (!titulo) return;
    if (/^n/i.test(String(col(r, 'publicar') || 'sim').trim())) return;
    total++;
    const abre = dataPub_(col(r, 'inscricao_abre'));
    const fecha = dataPub_(col(r, 'inscricao_fecha'));
    const item = { cat: limpa(col(r, 'categoria')), titulo: titulo, quem: quemVagaStoryPub_(r, col, limpa) };
    if (abre && abre > hoje) {
      if ((abre - hoje) / dia <= VAGAS_STORY.DIAS_EM_BREVE) {
        breve.push(Object.assign(item, { ref: abre, rotulo: 'abre', data: dm(abre), urgente: '' }));
      }
      return;
    }
    if (fecha && fecha >= hoje) {
      const d = Math.round((fecha - hoje) / dia);
      abertas.push(Object.assign(item, { ref: fecha, rotulo: 'até', data: d === 0 ? 'hoje' : dm(fecha),
        urgente: d <= VAGAS_STORY.URGENTE_DIAS ? '1' : '' }));
    }
  });
  const porData = function (a, b) { return a.ref - b.ref || a.titulo.localeCompare(b.titulo); };
  abertas.sort(porData);
  breve.sort(porData);
  const pool = abertas.concat(breve);
  if (!pool.length) return null;

  // 1º cartão fixo (prazo mais perto); os outros em rodízio diário pelo resto da lista.
  const n = Math.floor(hoje.getTime() / dia + 0.5);
  const escolha = [pool[0]];
  const resto = pool.slice(1);
  const quer = Math.min(VAGAS_STORY.CARTOES - 1, resto.length);
  const inicio = resto.length ? (n * quer) % resto.length : 0;
  for (let i = 0; i < quer; i++) escolha.push(resto[(inicio + i) % resto.length]);

  return {
    tipo: 'vagas',
    tag: 'BUSCADOR DE VAGAS',
    titulo: abertas.length >= 2 ? 'Vagas abertas' : 'Vagas de medicina',
    vagas: escolha.map(function (e) { return [e.cat, e.titulo, e.quem, e.rotulo, e.data, e.urgente].join('|'); }).join('\n'),
    total: String(total),
    url: VAGAS_STORY.URL,
  };
}

/** "Instituição · local", curto o bastante para uma linha do cartão. */
function quemVagaStoryPub_(r, col, limpa) {
  const inst = limpa(col(r, 'instituicao')).split(/ \(| – | - /)[0];
  const cidade = limpa(col(r, 'cidade'));
  const pais = limpa(col(r, 'pais'));
  let local = '';
  if (pais === 'Brasil') local = cidade;
  else if (cidade && cidade !== pais && !/^online$/i.test(cidade)) local = cidade + (pais && !/^online/i.test(pais) ? ', ' + pais : '');
  else local = pais;
  return [inst, local].filter(Boolean).join(' · ');
}
