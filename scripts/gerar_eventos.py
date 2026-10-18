"""Gera as artes dos eventos que estão esperando arte na aba "Publicação" da planilha do Handoff.

Para cada linha com a coluna "Textos da arte" preenchida, lê o JSON dela
(escrito pelo Apps Script), preenche os modelos de modelos/_evento/ e salva em posts/auto/<ID>/:
    slide-1.jpg  capa (1080x1350)
    slide-2.jpg  detalhes (1080x1350)
    story.jpg    lembrete da véspera (1080x1920)
    textos.json  os textos usados (se mudarem na planilha, a arte é refeita)
    estilo.txt   versão do visual (se ESTILO mudar aqui, a arte é refeita)

A cor e a etiqueta da arte saem da categoria do evento (Estágio, Workshop, Evento científico,
Palestra ou, se nada bater, a etiqueta original em laranja) — ver CATEGORIAS.

Uso:
    python3 scripts/gerar_eventos.py                 # lê a planilha (precisa estar com "qualquer pessoa com o link")
    python3 scripts/gerar_eventos.py --csv fila.csv  # lê de um CSV exportado da aba Publicação
    python3 scripts/gerar_eventos.py --forcar        # refaz todas, mesmo sem mudança

Roda sozinho pelo GitHub Actions (.github/workflows/gerar-artes.yml).
"""
import argparse
import asyncio
import csv
import html
import io
import json
import os
import re
import shutil
import sys
import unicodedata
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MODELOS = RAIZ / "modelos" / "_evento"
SAIDA = RAIZ / "posts" / "auto"
TEMP = RAIZ / ".gerar"

PLANILHA = os.environ.get("HANDOFF_PLANILHA", "1CKy25A_WejA8AvJMhS4jfxIJnngdGHLKK7fP7tgpKgA")
ABA_GID = os.environ.get("HANDOFF_ABA_GID", "251176273")  # aba "Publicação"
MAX_POR_RODADA = 20

# Cada tipo de oportunidade tem cor fixa, para o perfil ficar separado por categoria.
# (etiqueta da arte, fundo, detalhe do canto, palavras-chave sem acento). A primeira que bater vence,
# por isso "Aula prática" cai em WORKSHOP antes de PALESTRA.
CATEGORIAS = [
    ("ESTÁGIO", "#3FB67A", "#FFC93C", r"estagio|observership|vivencia|plantao"),
    ("WORKSHOP", "#1D3FC4", "#F7941D", r"workshop|oficina|hands.?on|pratic|treinamento|simulac|capacitac"),
    ("EVENTO CIENTÍFICO", "#3FA0F0", "#1D3FC4",
     r"jornada|simposio|congresso|semana academica|interligas|encontro|forum|\bmostra|conferencia|seminario|coloquio|cientific"),
    ("PALESTRA", "#8C86E6", "#FFC93C",
     r"palestra|\baula|\bcurso|minicurso|webinar|\blive\b|roda.?de.?conversa|mesa.?redonda|bate.?papo|discussao.?de.?caso|clube.?de.?revista"),
]
# O que não é nenhum dos quatro (processo seletivo de liga, bolsa, pesquisa...) mantém a etiqueta do Gemini.
OUTRA = ("OPORTUNIDADE", "#F7941D", "#1D3FC4")
# Mude este valor quando o visual mudar: o workflow refaz as artes de todos os eventos da fila.
ESTILO = "cores-por-categoria-1"

ICONES = {
    "data": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "horario": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "local": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    "valor": '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    "publico": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
}
ROTULOS = {"data": "Quando", "horario": "Horário", "local": "Onde", "valor": "Investimento", "publico": "Vale saber"}  # público, vagas, certificado...
CORES_ICONE = {"data": "#C6F24E", "horario": "#FFC93C", "local": "#3FA0F0", "valor": "#8C86E6", "publico": "#3FB67A"}


def esc(v) -> str:
    return html.escape(str(v or "").strip())


def sem_acento(v) -> str:
    texto = unicodedata.normalize("NFKD", str(v or ""))
    return "".join(c for c in texto if not unicodedata.combining(c)).lower()


def categoria(t: dict):
    """(etiqueta, fundo, detalhe) do evento, a partir da etiqueta que o Gemini escreveu.

    O título só é usado para achar estágio (ex.: etiqueta "Processo seletivo", título "Estágios HGCR"):
    nome de liga no título ("Liga de ... e Simulação") confundiria as outras categorias.
    """
    etiqueta = sem_acento(t.get("etiqueta"))
    for nome, fundo, detalhe, padrao in CATEGORIAS:
        if re.search(padrao, etiqueta):
            return nome, fundo, detalhe
    nome, fundo, detalhe, padrao = CATEGORIAS[0]
    if re.search(padrao, sem_acento(t.get("titulo"))):
        return nome, fundo, detalhe
    return (str(t.get("etiqueta") or "").strip().upper() or OUTRA[0]), OUTRA[1], OUTRA[2]


def baixar_fila() -> str:
    url = f"https://docs.google.com/spreadsheets/d/{PLANILHA}/export?format=csv&gid={ABA_GID}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")


def itens_pendentes(texto_csv: str, forcar: bool):
    linhas = list(csv.DictReader(io.StringIO(texto_csv)))
    for linha in linhas:
        # Toda linha com "Textos da arte" ganha arte; ela só é refeita quando os textos mudam.
        if not str(linha.get("Textos da arte") or "").strip():
            continue
        id_ = str(linha.get("ID", "")).strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,40}", id_):
            print(f"pulei ID inválido: {id_!r}", file=sys.stderr)
            continue
        try:
            textos = json.loads(linha.get("Textos da arte") or "{}")
        except json.JSONDecodeError:
            print(f"{id_}: 'Textos da arte' não é JSON válido", file=sys.stderr)
            continue
        # textos.json guarda exatamente o que veio da planilha: é com ele que o Apps Script confere se a arte está em dia.
        yield id_, textos


def preencher(modelo: str, campos: dict) -> str:
    texto = (MODELOS / modelo).read_text(encoding="utf-8")
    for chave, valor in campos.items():
        texto = texto.replace("{{" + chave + "}}", valor)
    return texto


def montar_htmls(id_: str, t: dict) -> dict:
    etiqueta, cor, detalhe = categoria(t)
    cor2 = cor  # capa, detalhes e story na mesma cor: a cor diz o tipo

    org = esc(t.get("organizacao"))
    arroba = esc(t.get("arroba"))
    org_pilula = org + (f' <span style="color:#1D3FC4">· {arroba}</span>' if arroba and arroba.lower() != org.lower() else "")
    data_txt = esc(t.get("data"))
    horario = esc(t.get("horario"))
    data_capa = data_txt + (f" · {horario}" if horario and len(data_txt) + len(horario) < 22 else "")
    prazo = esc(t.get("prazo"))
    inscricao = esc(t.get("inscricao")) or (f"Inscrições no perfil da {arroba}" if arroba else "Mais informações no perfil da organização")

    linhas = []
    for chave in ["data", "horario", "local", "valor", "publico"]:
        valor = esc(t.get(chave))
        if not valor:
            continue
        linhas.append(
            f'<div class="linha"><div class="icone" style="background:{CORES_ICONE[chave]}">'
            f'<svg viewBox="0 0 24 24" fill="none" stroke="#0A2472" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{ICONES[chave]}</svg></div>'
            f'<div><div class="rotulo">{ROTULOS[chave]}</div><div class="valor">{valor}</div></div></div>'
        )
    prazo_bloco = (
        '<div class="mont" style="transform:rotate(2deg);padding:14px 30px;background:#FFC93C;color:#0A2472;border:6px solid #FFFFFF;'
        f'border-radius:16px;box-shadow:0 0 0 5px #0A2472,8px 10px 0 5px #0A2472;font-size:36px;text-transform:uppercase">{prazo}</div>'
        if prazo else ""
    )
    pilulas = "".join(
        f'<div class="pilula"><svg viewBox="0 0 24 24" fill="none" stroke="#0A2472" stroke-width="2.4" '
        f'stroke-linecap="round" stroke-linejoin="round">{ICONES[icone]}</svg><span>{p}</span></div>'
        for icone, p in [("data", " · ".join(x for x in [data_txt, horario] if x)), ("local", esc(t.get("local")))] if p
    )
    chamada = esc(t.get("lembrete")) or ("Inscrições acabam amanhã" if prazo else "É amanhã!")

    return {
        "slide-1": (preencher("capa.html", {
            "COR": cor, "COR_DETALHE": detalhe, "ETIQUETA": esc(etiqueta),
            "TITULO": esc(t.get("titulo")), "ORGANIZACAO": org_pilula, "DATA": data_capa or "EM BREVE",
        }), 1080, 1350),
        "slide-2": (preencher("detalhes.html", {
            "COR": cor2, "LINHAS": "\n".join(linhas) or '<div class="valor">Detalhes no perfil da organização</div>',
            "PRAZO_BLOCO": prazo_bloco, "INSCRICAO": inscricao, "CREDITO": ("Fonte: " + (arroba or org)) if (arroba or org) else "",
        }), 1080, 1350),
        "story": (preencher("story.html", {
            "COR": cor, "COR_DETALHE": detalhe, "CHAMADA": chamada, "TITULO": esc(t.get("titulo")),
            "CHAMADA_ESTILO": "white-space:nowrap" if len(chamada) <= 14 else "",
            "ORGANIZACAO": org_pilula, "PILULAS": pilulas, "INSCRICAO": inscricao,
        }), 1080, 1920),
    }


async def renderizar(trabalhos):
    from PIL import Image
    from playwright.async_api import async_playwright

    feitos, erros = [], []
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        for id_, textos in trabalhos:
            try:
                pasta_tmp = TEMP / id_
                pasta_tmp.mkdir(parents=True, exist_ok=True)
                destino = SAIDA / id_
                destino.mkdir(parents=True, exist_ok=True)
                for nome, (conteudo, largura, altura) in montar_htmls(id_, textos).items():
                    arq = pasta_tmp / f"{nome}.html"
                    arq.write_text(conteudo, encoding="utf-8")
                    pagina = await navegador.new_page(viewport={"width": largura, "height": altura})
                    await pagina.goto(arq.resolve().as_uri())
                    await pagina.evaluate("document.fonts.ready")
                    await pagina.evaluate("window.ajustar && window.ajustar()")
                    await pagina.wait_for_timeout(250)
                    png = pasta_tmp / f"{nome}.png"
                    await pagina.screenshot(path=str(png), clip={"x": 0, "y": 0, "width": largura, "height": altura})
                    await pagina.close()
                    Image.open(png).convert("RGB").save(destino / f"{nome}.jpg", quality=90, optimize=True)
                (destino / "textos.json").write_text(json.dumps(textos, ensure_ascii=False, sort_keys=True, indent=1), encoding="utf-8")
                (destino / "estilo.txt").write_text(ESTILO + "\n", encoding="utf-8")
                feitos.append(id_)
            except Exception as e:  # um evento com problema não trava os outros
                erros.append(f"{id_}: {e}")
        await navegador.close()
    return feitos, erros


def arte_em_dia(id_: str, textos: dict) -> bool:
    """A arte está em dia se os textos não mudaram e ela foi feita com o visual atual (ESTILO)."""
    pasta = SAIDA / id_
    canonico = json.dumps(textos, ensure_ascii=False, sort_keys=True, indent=1)
    try:
        return ((pasta / "textos.json").read_text(encoding="utf-8") == canonico
                and (pasta / "estilo.txt").read_text(encoding="utf-8").strip() == ESTILO)
    except FileNotFoundError:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="CSV da aba Publicação (em vez de baixar da planilha)")
    ap.add_argument("--forcar", action="store_true", help="refaz mesmo sem mudança nos textos")
    ap.add_argument("--checar", action="store_true", help="só escreve tem=1 ou tem=0 (usado pelo workflow)")
    args = ap.parse_args()

    texto_csv = Path(args.csv).read_text(encoding="utf-8") if args.csv else baixar_fila()
    trabalhos = []
    for id_, textos in itens_pendentes(texto_csv, args.forcar):
        if not args.forcar and arte_em_dia(id_, textos):
            continue
        trabalhos.append((id_, textos))
    if args.checar:
        print(f"tem={1 if trabalhos else 0}")
        return 0
    trabalhos = trabalhos[:MAX_POR_RODADA]
    if not trabalhos:
        print("Nada novo para gerar.")
        return 0

    feitos, erros = asyncio.run(renderizar(trabalhos))
    shutil.rmtree(TEMP, ignore_errors=True)
    print(f"Artes geradas: {len(feitos)} ({', '.join(feitos)})")
    for e in erros:
        print("ERRO", e)
    return 1 if erros and not feitos else 0


if __name__ == "__main__":
    sys.exit(main())
