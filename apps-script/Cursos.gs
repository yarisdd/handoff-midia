/**
 * Handoff — Carrossel diário de cursos gratuitos (formato do post "cursos gratuitos" da @fisioeliza,
 * com a identidade visual do Handoff).
 *
 * Arquivo próprio no Apps Script da Handoff — Base: usa as funções de Publicações.gs (PUB, containerPub_,
 * jsonPub_, lockPub_, dispararGeradorPub_...) e não muda nada nelas.
 *
 * Fluxo (gatilho próprio a cada 10 min, ligado por cursosLigar()):
 *  1. Catálogo: 1x por dia lê os cursos com oferta aberta do portal UNA-SUS (gratuitos, EAD, com certificado)
 *     e guarda na aba "Cursos", com o público-alvo de cada um. Só entra no carrossel o que serve para
 *     estudante de medicina (ver CURSOS_FORA).
 *  2. Carrossel: a partir das 9h (e para o dia seguinte, depois das 18h) escolhe o tema do dia, os cursos
 *     (sem repetir curso já divulgado) e escreve textos, legenda e links na aba "Cursos — Carrosséis".
 *     A arte sai do scripts/gerar_cursos.py do handoff-midia (modelos/_cursos) em posts/cursos/<ID>/.
 *  3. Publicação: às 19h, pela mesma API do Instagram dos outros posts.
 *  4. "EU QUERO": por 7 dias depois de publicado, quem comentar "eu quero" recebe os links por direct
 *     (resposta privada ao comentário) e uma resposta curta no próprio comentário. Fica tudo na aba
 *     "Cursos — Direct".
 *
 * Rodar no editor: cursosLigar() (uma vez), cursosRodada() (rodada manual), cursosTestarComentarios().
 */

const CURSOS = {
  ATIVO: true,
  ABA_CATALOGO: 'Cursos',
  ABA_CARROSSEIS: 'Cursos — Carrosséis',
  ABA_DIRECT: 'Cursos — Direct',
  HORARIO: '19:00',            // publicação do carrossel, todo dia
  DIAS: [0, 1, 2, 3, 4, 5, 6], // 0=dom ... 6=sáb (nesta semana: todos os dias)
  PREPARAR: '09:00',           // a partir daqui o carrossel do dia ganha textos (e às 18h o do dia seguinte)
  PREPARAR_AMANHA: '18:00',
  TOLERANCIA_MIN: 180,         // arte que ficou pronta atrasada ainda sai até 3h depois do horário
  POR_CARROSSEL: 5,
  MINIMO: 3,                   // tema com menos cursos novos que isso fica de fora no dia
  API: 'https://www.unasus.gov.br/cursos/rest/busca',
  CURSO_URL: 'https://www.unasus.gov.br/cursos/curso/',
  IMAGEM_URL: 'https://arouca.unasus.gov.br/app/imagem/curso/{id}/360.jpg',
  ARTE_URL: 'https://raw.githubusercontent.com/yarisdd/handoff-midia/main/posts/cursos/',
  DETALHES_POR_RODADA: 60,     // páginas de curso lidas por rodada (público-alvo)
  JANELA_COMENTARIOS_DIAS: 7,  // a Meta só deixa responder em privado até 7 dias depois do comentário
  RESPOSTAS_POR_RODADA: 25,
  GATILHO: /\beu\s*quero\b|\bquero\s*(?:os\s*)?links?\b/i,
  RESPOSTA_PUBLICA: true,
  PROP_CATALOGO: 'CURSOS_CATALOGO_EM',
};

// Temas do carrossel, em rodízio (um por dia). A ordem da semana é esta; a regex olha o nome do curso.
const CURSOS_TEMAS = [
  { tema: 'Infectologia', paleta: 'azul', tag: 'infectologia',
    re: /dengue|zika|chikungunya|influenza|sarampo|tuberculose|\bhiv\b|filariose|esquistossomose|hansen|covid|surtos|micobacter|infecc/i },
  { tema: 'Saúde da Mulher e Materno-Infantil', paleta: 'lilas', tag: 'saudedamulher',
    re: /puerp|gestant|gesta[çc][ãa]o|pr[ée].?natal|matern|menstrua|amamenta|lactente|\bparto\b|obst[ée]tr|ginec|\bmulher/i },
  { tema: 'Pediatria', paleta: 'ceu', tag: 'pediatria',
    re: /crian[çc]a|adolescen|inf[âa]ncia|neuropsicomotor|pedi[áa]tr/i },
  { tema: 'Geriatria', paleta: 'verde', tag: 'geriatria',
    re: /idos[ao]|envelhec|geri[áa]tr|paliativ/i },
  { tema: 'Pesquisa Clínica', paleta: 'laranja', tag: 'pesquisaclinica',
    re: /ensaio cl[íi]nico|epidemiologia cl[íi]nica|evid[êe]ncias cient|dados de pesquisa|implementa[çc][ãa]o e acompanhamento do estudo|conclus[ãa]o do estudo|t[óo]picos regulat[óo]rios/i },
  { tema: 'Medicina de Família', paleta: 'azul', tag: 'medicinadefamilia',
    re: /abordagem cl[íi]nica|ferramentas de abordagem|gest[ãa]o da cl[íi]nica|longitudinalidade|atributos da aten|obesidade|sobrepeso|doen[çc]as cr[ôo]nicas|onco|abordagem familiar|comunit[áa]ria/i },
  { tema: 'Saúde Mental', paleta: 'lilas', tag: 'saudemental',
    re: /sa[úu]de mental|suic[íi]d|viol[êe]ncia/i },
  { tema: 'Saúde do Homem', paleta: 'ceu', tag: 'saudedohomem',
    re: /\bhom(?:em|ens)\b|paternidade|masculin/i },
  { tema: 'Saúde Digital', paleta: 'verde', tag: 'saudedigital',
    re: /sa[úu]de digital|registros eletr[ôo]nicos/i },
];

// Fora do carrossel (não é para estudante de medicina, ou a matrícula é restrita a outro público).
const CURSOS_FORA = {
  nome: /enfermagem|farmac[êe]utic|bucal|\bSEI!?|\bCEPs?\b|Plataforma Brasil|Consentimento Livre|Princ[íi]pios Metodol[óo]gicos B[áa]sicos|controle vetorial|ouvidoria|EducaSUS|Bolsa Fam[íi]lia|malacol[óo]gica|Trilha Trabalhadores da Justi|vigilancia gen[óo]mica|genomic surveillance|Direitos Humanos da Pessoa Idosa/i,
  publico: /farmac[êe]utic|sa[úu]de bucal|Sistema CEP|Conep|Minist[ée]rio da Sa[úu]de que atuam em fun[çc][õo]es administrativas|Agente de Combate|justi[çc]a e da seguran[çc]a|lideran[çc]as e representa[çc][õo]es|ouvidores|preceptores|^gestores do sus\.?$|Priorit[áa]rio: Profissionais de sa[úu]de de n[íi]vel m[ée]dio|gerentes e demais|lideran[çc]as comunit[áa]rias, conselheiros/i,
};

const CURSOS_COLS_CAT = ['ID curso', 'Curso', 'Carga horária', 'Instituição', 'Sigla', 'Modalidade', 'Público-alvo',
  'Link', 'Imagem', 'Status', 'Medicina', 'Usado em', 'Atualizado em'];
const CURSOS_COLS_CAR = ['ID', 'Dia', 'Tema', 'Textos', 'Legenda', 'Links', 'Publicar em', 'Status', 'ID post',
  'Directs', 'Erro', 'Criado em'];
const CURSOS_COLS_DM = ['Data', 'Carrossel', 'Comentário', 'Usuário', 'Texto', 'Direct', 'Resposta pública', 'Erro'];

/* ============================== Gatilho ============================== */

/** Liga a rodada automática (a cada 10 min). Rode uma vez no editor. */
function cursosLigar() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'cursosRodada'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cursosRodada').timeBased().everyMinutes(10).create();
  Logger.log('Carrossel de cursos ligado: rodada a cada 10 min, publicação às ' + CURSOS.HORARIO + '.');
}

function cursosDesligar() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'cursosRodada'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Carrossel de cursos desligado.');
}

/** Rodada manual sem publicar: atualiza o catálogo, prepara os carrosséis e manda gerar as artes. */
function cursosPrepararAgora() {
  const ss = planilhaPub_();
  const agora = new Date();
  const lidos = cursosAtualizarCatalogo_(ss, agora, true);
  // Público-alvo de todos os cursos de uma vez (a rodada automática lê aos poucos).
  for (let i = 0; i < 4 && cursosAtualizarCatalogo_(ss, agora) > 0; i++) { /* continua lendo */ }
  const criados = cursosPreparar_(ss, agora);
  const d = criados ? dispararGeradorPub_() : { ok: null };
  Logger.log('Catálogo atualizado (' + lidos + ' detalhes lidos), ' + criados + ' carrossel(éis) novo(s)' +
    (d.ok ? ', gerador de artes disparado.' : '.'));
}

function cursosRodada() {
  if (!CURSOS.ATIVO) return;
  const lock = lockPub_();
  if (!lock) return; // a publicação dos eventos está rodando: tenta na próxima
  const agora = new Date();
  const ss = planilhaPub_();
  let disparar = false;
  try {
    try { cursosAtualizarCatalogo_(ss, agora); } catch (e) { Logger.log('Catálogo de cursos: ' + e.message); }
    try { disparar = cursosPreparar_(ss, agora) > 0; } catch (e) { Logger.log('Carrossel de cursos (preparar): ' + e.message); }
    try { cursosPublicar_(ss, agora); } catch (e) { Logger.log('Carrossel de cursos (publicar): ' + e.message); }
    try { cursosResponderComentarios_(ss, agora); } catch (e) { Logger.log('Carrossel de cursos (comentários): ' + e.message); }
  } finally {
    lock.releaseLock();
  }
  if (disparar) dispararGeradorPub_();
}

/* ============================== Catálogo ============================== */

/** Lê os cursos com oferta aberta da UNA-SUS e atualiza a aba "Cursos" (1x por dia, ou se a aba estiver vazia). */
function cursosAtualizarCatalogo_(ss, agora, forcar) {
  const props = PropertiesService.getScriptProperties();
  const sh = abaCursosPub_(ss, CURSOS.ABA_CATALOGO, CURSOS_COLS_CAT);
  const ultimo = Number(props.getProperty(CURSOS.PROP_CATALOGO) || 0);
  const linhas = lerAbaCursos_(sh, CURSOS_COLS_CAT);
  const faltaDetalhe = linhas.some(function (r) { return r['Status'] === 'aberto' && !r['Público-alvo']; });
  if (!forcar && linhas.length && agora.getTime() - ultimo < 20 * 3600000 && !faltaDetalhe) return 0;

  let abertos = null;
  if (forcar || !linhas.length || agora.getTime() - ultimo >= 20 * 3600000) {
    abertos = cursosDaApi_();
    props.setProperty(CURSOS.PROP_CATALOGO, String(agora.getTime()));
  }
  const porId = {};
  linhas.forEach(function (r) { porId[String(r['ID curso'])] = r; });

  if (abertos) {
    const vistos = new Set();
    abertos.forEach(function (c) {
      const id = String(c.co_seq_curso);
      vistos.add(id);
      const r = porId[id];
      const campos = {
        'Curso': limparCurso_(c.no_curso), 'Carga horária': Number(c.qt_carga_horaria_total) || '',
        'Instituição': limparCurso_(c.no_orgao), 'Sigla': limparCurso_(c.sg_orgao), 'Modalidade': limparCurso_(c.no_modalidade),
        'Link': CURSOS.CURSO_URL + id, 'Imagem': CURSOS.IMAGEM_URL.replace('{id}', id), 'Status': 'aberto',
      };
      if (r) {
        const mudou = {};
        Object.keys(campos).forEach(function (k) { if (String(r[k]) !== String(campos[k])) mudou[k] = campos[k]; });
        if (Object.keys(mudou).length) { mudou['Atualizado em'] = agora; escreverAbaCursos_(sh, CURSOS_COLS_CAT, r._linha, mudou); Object.assign(r, mudou); }
      } else {
        const nova = Object.assign({ 'ID curso': id, 'Público-alvo': '', 'Medicina': '', 'Usado em': '', 'Atualizado em': agora }, campos);
        sh.appendRow(CURSOS_COLS_CAT.map(function (k) { return nova[k] === undefined ? '' : nova[k]; }));
        nova._linha = sh.getLastRow();
        linhas.push(nova);
        porId[id] = nova;
      }
    });
    linhas.forEach(function (r) {
      if (r['Status'] === 'aberto' && !vistos.has(String(r['ID curso']))) {
        escreverAbaCursos_(sh, CURSOS_COLS_CAT, r._linha, { 'Status': 'encerrado', 'Atualizado em': agora });
        r['Status'] = 'encerrado';
      }
    });
  }

  // Público-alvo (página de cada curso) e a decisão "serve para medicina".
  let lidos = 0;
  linhas.forEach(function (r) {
    if (r['Status'] !== 'aberto' || r['Público-alvo'] || lidos >= CURSOS.DETALHES_POR_RODADA) return;
    lidos++;
    let publico = '';
    try { publico = publicoDoCurso_(String(r['ID curso'])); } catch (e) { return; }
    const med = cursoParaMedicina_(String(r['Curso']), publico) ? 'sim' : 'não';
    escreverAbaCursos_(sh, CURSOS_COLS_CAT, r._linha, { 'Público-alvo': publico || '—', 'Medicina': med });
  });
  return lidos;
}

function cursosDaApi_() {
  const todos = [];
  let proximo = 0;
  for (let i = 0; i < 30; i++) {
    const resp = UrlFetchApp.fetch(CURSOS.API, {
      method: 'post', muteHttpExceptions: true,
      payload: { busca: '', ordenacao: 'Relevância na busca', status: 'com oferta aberta', proximo: String(proximo) },
    });
    if (resp.getResponseCode() !== 200) throw new Error('UNA-SUS respondeu ' + resp.getResponseCode());
    const r = (JSON.parse(resp.getContentText()) || {}).results || {};
    const itens = r.itens || [];
    itens.forEach(function (c) { if (c.status === 'com oferta aberta') todos.push(c); });
    if (!itens.length || !r.proximo || r.proximo <= proximo) break;
    proximo = r.proximo;
  }
  if (!todos.length) throw new Error('UNA-SUS não devolveu nenhum curso aberto.');
  return todos;
}

/** Público-alvo escrito na página do curso ("Público-alvo: ... Formato:"). */
function publicoDoCurso_(id) {
  const resp = UrlFetchApp.fetch(CURSOS.CURSO_URL + id, { muteHttpExceptions: true, followRedirects: true });
  if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());
  const texto = htmlParaTextoCursos_(resp.getContentText());
  const m = texto.match(/P[úu]blico-alvo:\s*([\s\S]*?)\s*(?:Formato:|N[íi]vel:|Modalidade:)/i);
  return m ? limparCurso_(m[1]).slice(0, 400) : '';
}

function cursoParaMedicina_(nome, publico) {
  if (CURSOS_FORA.nome.test(nome)) return false;
  if (CURSOS_FORA.publico.test(String(publico || '').trim())) return false;
  return true;
}

/* ============================== Carrossel ============================== */

/** Cria as linhas do carrossel de hoje (a partir das 9h) e de amanhã (a partir das 18h). Devolve quantas criou. */
function cursosPreparar_(ss, agora) {
  const car = abaCursosPub_(ss, CURSOS.ABA_CARROSSEIS, CURSOS_COLS_CAR);
  const linhas = lerAbaCursos_(car, CURSOS_COLS_CAR);
  const ids = new Set(linhas.map(function (r) { return String(r['ID']); }));
  const dias = [];
  if (agora >= horarioPub_(agora, CURSOS.PREPARAR) && agora < horarioPub_(agora, CURSOS.HORARIO)) dias.push(agora);
  if (agora >= horarioPub_(agora, CURSOS.PREPARAR_AMANHA)) dias.push(somaDiasPub_(agora, 1));
  let criadas = 0;
  dias.forEach(function (d) {
    if (CURSOS.DIAS.indexOf(d.getDay()) < 0) return;
    const id = 'C' + diaStoriesPub_(d);
    if (ids.has(id)) return;
    const linha = cursosMontarCarrossel_(ss, d, linhas);
    if (!linha) return;
    car.appendRow(CURSOS_COLS_CAR.map(function (k) { return linha[k] === undefined ? '' : linha[k]; }));
    linha._linha = car.getLastRow();
    linhas.push(linha);
    ids.add(id);
    criadas++;
  });
  return criadas;
}

/** Escolhe tema e cursos do dia, marca os cursos como usados e devolve a linha da aba de carrosséis (ou null). */
function cursosMontarCarrossel_(ss, dia, carrosseis) {
  const cat = abaCursosPub_(ss, CURSOS.ABA_CATALOGO, CURSOS_COLS_CAT);
  const cursos = lerAbaCursos_(cat, CURSOS_COLS_CAT).filter(function (r) {
    return r['Status'] === 'aberto' && r['Medicina'] === 'sim' && !String(r['Usado em']).trim();
  });
  // Rodízio: o próximo tema depois do último que saiu; pula tema sem cursos novos suficientes.
  const usados = carrosseis.slice().sort(function (a, b) { return String(a['ID']).localeCompare(String(b['ID'])); })
    .map(function (r) { return String(r['Tema']); });
  const ultimo = usados.length ? CURSOS_TEMAS.findIndex(function (t) { return t.tema === usados[usados.length - 1]; }) : -1;
  let escolha = null, lista = [];
  for (let k = 1; k <= CURSOS_TEMAS.length && !escolha; k++) {
    const t = CURSOS_TEMAS[(ultimo + k) % CURSOS_TEMAS.length];
    const doTema = cursos.filter(function (r) { return t.re.test(String(r['Curso'])); });
    if (doTema.length >= CURSOS.MINIMO) { escolha = t; lista = doTema; }
  }
  if (!escolha) { Logger.log('Carrossel de cursos: nenhum tema com ' + CURSOS.MINIMO + ' cursos novos.'); return null; }

  const nota = function (r) {
    const p = String(r['Público-alvo']).toLowerCase();
    let n = 0;
    if (/m[ée]dic/.test(p)) n += 3;
    if (/n[íi]vel superior/.test(p)) n += 2;
    if (/estudante/.test(p)) n += 2;
    if (/profissionais (da|de) (área da )?sa[úu]de|demais interessados|livre demanda/.test(p)) n += 1;
    const h = Number(r['Carga horária']) || 0;
    if (h >= 10 && h <= 60) n += 1;
    return n;
  };
  lista.sort(function (a, b) { return nota(b) - nota(a) || (Number(b['Carga horária']) || 0) - (Number(a['Carga horária']) || 0); });
  const sel = lista.slice(0, CURSOS.POR_CARROSSEL);
  const id = 'C' + diaStoriesPub_(dia);

  const textos = {
    tipo: 'cursos', versao: 1, tema: escolha.tema, paleta: escolha.paleta,
    cursos: sel.map(function (r) {
      return {
        titulo: String(r['Curso']).slice(0, 140), instituicao: String(r['Sigla'] || r['Instituição']).slice(0, 40),
        horas: String(r['Carga horária'] || ''), area: (String(r['Modalidade'] || 'Curso') + ' · Online').slice(0, 40),
        imagem: String(r['Imagem'] || ''),
      };
    }),
  };
  const links = sel.map(function (r) { return { titulo: String(r['Curso']), url: String(r['Link']) }; });
  sel.forEach(function (r) { escreverAbaCursos_(cat, CURSOS_COLS_CAT, r._linha, { 'Usado em': id }); });

  return {
    'ID': id, 'Dia': diaStoriesPub_(dia), 'Tema': escolha.tema, 'Textos': JSON.stringify(textos),
    'Legenda': legendaCursos_(escolha, sel), 'Links': JSON.stringify(links),
    'Publicar em': horarioPub_(dia, CURSOS.HORARIO), 'Status': 'aguardando_arte', 'ID post': '', 'Directs': 0,
    'Erro': '', 'Criado em': new Date(),
  };
}

function legendaCursos_(t, sel) {
  const linhas = [
    'Cursos gratuitos de ' + t.tema + ' que todo estudante de medicina deveria fazer 👇',
    '(online e com certificado)',
    '',
  ];
  sel.forEach(function (r, i) {
    const h = Number(r['Carga horária']) || 0;
    linhas.push((i + 1) + '. ' + String(r['Curso']) + ' (' + String(r['Sigla'] || r['Instituição']) + (h ? ' · ' + h + 'h' : '') + ')');
  });
  linhas.push('',
    '💬 Comenta EU QUERO que a gente te manda os links dos cursos no direct!',
    '',
    '🎓 Todos são da UNA-SUS: gratuitos, a distância e com certificado. Antes de contar como hora complementar, confira as regras do Manual do Aluno.',
    '📌 Salva o post pra não perder.',
    '',
    '#medicina #estudantedemedicina #cursosgratuitos #unasus #' + t.tag);
  return linhas.join('\n').slice(0, 2100);
}

/* ============================== Publicar ============================== */

function cursosPublicar_(ss, agora) {
  if (PUB.PAUSADO) return 0;
  const car = ss.getSheetByName(CURSOS.ABA_CARROSSEIS);
  if (!car) return 0;
  const linhas = lerAbaCursos_(car, CURSOS_COLS_CAR);
  let feitos = 0;
  linhas.forEach(function (r) {
    const st = statusPub_(r['Status']);
    const quando = r['Publicar em'] instanceof Date ? r['Publicar em'] : null;
    if (!quando || (st !== 'aguardando_arte' && st !== 'agendado')) return;
    if (agora - quando > CURSOS.TOLERANCIA_MIN * 60000) {
      escreverAbaCursos_(car, CURSOS_COLS_CAR, r._linha, { 'Status': 'expirado', 'Erro': 'A arte não ficou pronta a tempo.' });
      return;
    }
    let urls = null;
    if (st === 'aguardando_arte') {
      urls = arteCursosPronta_(String(r['ID']), String(r['Textos']));
      if (!urls) return;
      escreverAbaCursos_(car, CURSOS_COLS_CAR, r._linha, { 'Status': 'agendado', 'Erro': '' });
    }
    if (quando > agora || feitos >= 1) return;
    urls = urls || arteCursosPronta_(String(r['ID']), String(r['Textos']));
    if (!urls) { escreverAbaCursos_(car, CURSOS_COLS_CAR, r._linha, { 'Status': 'aguardando_arte' }); return; }
    // Marca antes de publicar: uma falha no meio não vira post duplicado.
    escreverAbaCursos_(car, CURSOS_COLS_CAR, r._linha, { 'Status': 'publicando' });
    try {
      const token = propPub_('IG_PUBLICAR_TOKEN', 'Use Handoff — Publicação → Definir token de publicação do Instagram.');
      const igId = igIdPub_();
      const criacao = containersPub_(igId, token, urls, String(r['Legenda']), null);
      const pub = jsonPub_(PUB.IG_API + '/' + igId + '/media_publish', { method: 'post', payload: { creation_id: criacao, access_token: token } });
      escreverAbaCursos_(car, CURSOS_COLS_CAR, r._linha, { 'Status': 'publicado', 'ID post': String(pub.id), 'Erro': '' });
      feitos++;
    } catch (e) {
      escreverAbaCursos_(car, CURSOS_COLS_CAR, r._linha, { 'Status': 'erro', 'Erro': String(e.message || e).slice(0, 400) });
    }
  });
  return feitos;
}

/** Links das imagens do carrossel se o GitHub já gerou com os textos atuais; senão null. */
function arteCursosPronta_(id, textosJson) {
  let textos;
  try { textos = JSON.parse(textosJson); } catch (e) { return null; }
  const pasta = CURSOS.ARTE_URL + encodeURIComponent(id) + '/';
  const resp = UrlFetchApp.fetch(pasta + 'textos.json?t=' + Date.now(), { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  let noRepo;
  try { noRepo = JSON.parse(resp.getContentText()); } catch (e) { return null; }
  if (canonCursos_(noRepo) !== canonCursos_(textos)) return null;
  const v = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, canonCursos_(textos)))
    .replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const n = Math.min((textos.cursos || []).length, 7) + 2; // capa + cursos + "comenta EU QUERO"
  const urls = [];
  for (let i = 1; i <= n; i++) urls.push(pasta + 'slide-' + i + '.jpg?v=' + v);
  return urls;
}

function canonCursos_(o) {
  const ord = function (x) {
    if (Array.isArray(x)) return x.map(ord);
    if (x && typeof x === 'object') {
      const r = {};
      Object.keys(x).sort().forEach(function (k) { r[k] = ord(x[k]); });
      return r;
    }
    return x === null || x === undefined ? '' : String(x);
  };
  return JSON.stringify(ord(o));
}

/* ============================== "EU QUERO" ============================== */

function cursosResponderComentarios_(ss, agora) {
  const car = ss.getSheetByName(CURSOS.ABA_CARROSSEIS);
  if (!car) return 0;
  const posts = lerAbaCursos_(car, CURSOS_COLS_CAR).filter(function (r) {
    return statusPub_(r['Status']) === 'publicado' && String(r['ID post']).trim() && r['Publicar em'] instanceof Date &&
      agora - r['Publicar em'] <= (CURSOS.JANELA_COMENTARIOS_DIAS + 1) * 86400000;
  });
  if (!posts.length) return 0;
  const dm = abaCursosPub_(ss, CURSOS.ABA_DIRECT, CURSOS_COLS_DM);
  const feitos = new Set(lerAbaCursos_(dm, CURSOS_COLS_DM).map(function (r) { return String(r['Comentário']); }));
  const token = propPub_('IG_PUBLICAR_TOKEN', 'Sem token de publicação.');
  const igId = igIdPub_();
  let enviados = 0;

  for (const p of posts) {
    let comentarios;
    try { comentarios = comentariosDoPost_(String(p['ID post']), token); } catch (e) {
      escreverAbaCursos_(car, CURSOS_COLS_CAR, p._linha, { 'Erro': 'Comentários: ' + String(e.message || e).slice(0, 300) });
      continue;
    }
    let links = [];
    try { links = JSON.parse(String(p['Links'] || '[]')) || []; } catch (e) { links = []; }
    let novos = 0;
    for (const c of comentarios) {
      if (enviados >= CURSOS.RESPOSTAS_POR_RODADA) break;
      const user = String(c.username || (c.from || {}).username || '').toLowerCase();
      if (!c.id || feitos.has(String(c.id)) || user === 'handoff.med' || !CURSOS.GATILHO.test(String(c.text || ''))) continue;
      if (c.timestamp && agora - new Date(c.timestamp) > CURSOS.JANELA_COMENTARIOS_DIAS * 86400000) continue;
      feitos.add(String(c.id));
      const reg = { 'Data': new Date(), 'Carrossel': String(p['ID']), 'Comentário': String(c.id), 'Usuário': user ? '@' + user : '',
        'Texto': String(c.text || '').slice(0, 200), 'Direct': '', 'Resposta pública': '', 'Erro': '' };
      try {
        jsonPub_(PUB.IG_API + '/' + igId + '/messages', {
          method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
          payload: JSON.stringify({ recipient: { comment_id: String(c.id) }, message: { text: textoDirectCursos_(String(p['Tema']), links) } }),
        });
        reg['Direct'] = 'enviado';
        novos++;
      } catch (e) {
        reg['Direct'] = 'erro';
        reg['Erro'] = String(e.message || e).slice(0, 300);
      }
      if (CURSOS.RESPOSTA_PUBLICA) {
        try {
          jsonPub_(PUB.IG_API + '/' + encodeURIComponent(String(c.id)) + '/replies', {
            method: 'post', payload: { message: respostaPublicaCursos_(reg['Direct'] === 'enviado', enviados), access_token: token },
          });
          reg['Resposta pública'] = 'ok';
        } catch (e) {
          reg['Resposta pública'] = 'erro';
          reg['Erro'] = (reg['Erro'] ? reg['Erro'] + ' | ' : '') + 'Resposta: ' + String(e.message || e).slice(0, 200);
        }
      }
      dm.appendRow(CURSOS_COLS_DM.map(function (k) { return reg[k]; }));
      enviados++;
    }
    if (novos) escreverAbaCursos_(car, CURSOS_COLS_CAR, p._linha, { 'Directs': (Number(p['Directs']) || 0) + novos });
  }
  return enviados;
}

function comentariosDoPost_(mediaId, token) {
  const todos = [];
  let url = PUB.IG_API + '/' + encodeURIComponent(mediaId) + '/comments?fields=id,text,username,timestamp,from&limit=50&access_token=' + encodeURIComponent(token);
  for (let i = 0; i < 10 && url; i++) {
    const r = jsonPub_(url);
    (r.data || []).forEach(function (c) { todos.push(c); });
    url = ((r.paging || {}).next) || '';
  }
  return todos;
}

/** Texto do direct: cabe no limite de 1000 caracteres de uma mensagem (títulos encurtados se precisar). */
function textoDirectCursos_(tema, links) {
  const montar = function (max) {
    const corpo = links.map(function (l, i) {
      let t = String(l.titulo || '').trim();
      if (t.length > max) t = t.slice(0, max - 1).trim() + '…';
      return (i + 1) + '. ' + t + '\n' + l.url;
    }).join('\n\n');
    return 'Oi! Aqui estão os links dos cursos gratuitos de ' + tema + ' 👇\n\n' + corpo +
      '\n\nTodos são da UNA-SUS: é só entrar, fazer o cadastro e se matricular. Bons estudos! 💙 Handoff';
  };
  for (const max of [120, 80, 55, 35]) {
    const s = montar(max);
    if (s.length <= 990) return s;
  }
  return montar(25).slice(0, 990);
}

function respostaPublicaCursos_(enviado, n) {
  const ok = ['Te mandei no direct! 💌', 'Enviado no direct 📩 Bons estudos!', 'Já tá no seu direct 🙌', 'Mandei os links no direct! 💙'];
  return enviado ? ok[n % ok.length] : 'Me chama no direct que eu te mando os links! 📩';
}

/** Rode no editor: mostra os comentários do último carrossel publicado e se o token consegue lê-los. */
function cursosTestarComentarios() {
  const token = propPub_('IG_PUBLICAR_TOKEN', 'Sem token de publicação.');
  const igId = igIdPub_();
  const m = jsonPub_(PUB.IG_API + '/' + igId + '/media?fields=id,caption,timestamp,comments_count&limit=3&access_token=' + encodeURIComponent(token));
  const linhas = (m.data || []).map(function (x) {
    let c = '';
    try { c = comentariosDoPost_(x.id, token).length + ' comentário(s) lidos'; } catch (e) { c = 'ERRO ao ler comentários: ' + e.message; }
    return x.id + ' · ' + String(x.caption || '').slice(0, 40).replace(/\n/g, ' ') + ' · ' + (x.comments_count || 0) + ' no total · ' + c;
  });
  Logger.log(linhas.join('\n'));
  return linhas;
}

/* ============================== Planilha ============================== */

function abaCursosPub_(ss, nome, cols) {
  let sh = ss.getSheetByName(nome);
  if (sh) return sh;
  sh = ss.insertSheet(nome);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0f3d3e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  const n = sh.getMaxRows() - 1;
  if (nome === CURSOS.ABA_CARROSSEIS) {
    sh.getRange(2, 1, n, 3).setNumberFormat('@'); // ID, Dia, Tema como texto
    sh.getRange(2, cols.indexOf('Publicar em') + 1, n, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sh.getRange(2, cols.indexOf('Criado em') + 1, n, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sh.setColumnWidth(cols.indexOf('Textos') + 1, 300);
    sh.setColumnWidth(cols.indexOf('Legenda') + 1, 380);
  } else if (nome === CURSOS.ABA_CATALOGO) {
    sh.getRange(2, 1, n, 1).setNumberFormat('@');
    sh.getRange(2, cols.indexOf('Atualizado em') + 1, n, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sh.setColumnWidth(2, 380);
    sh.setColumnWidth(cols.indexOf('Público-alvo') + 1, 320);
  } else {
    sh.getRange(2, 1, n, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    sh.getRange(2, 3, n, 1).setNumberFormat('@');
  }
  return sh;
}

function lerAbaCursos_(sh, cols) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues().map(function (v, i) {
    const r = { _linha: i + 2 };
    cols.forEach(function (c, j) { r[c] = v[j] instanceof Date ? v[j] : (typeof v[j] === 'string' ? v[j].trim() : v[j]); });
    return r;
  }).filter(function (r) { return String(r[cols[0]]).trim() !== '' || cols[0] === 'Data'; });
}

function escreverAbaCursos_(sh, cols, linha, campos) {
  Object.keys(campos).forEach(function (k) {
    const c = cols.indexOf(k);
    if (c >= 0) sh.getRange(linha, c + 1).setValue(campos[k]);
  });
}

function limparCurso_(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function htmlParaTextoCursos_(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&([a-z]+);/gi, function (m, n) {
      const mapa = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ', ccedil: 'ç',
        acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ccedil: 'Ç' };
      return mapa[n] || m;
    })
    .replace(/\s+/g, ' ');
}
