"""Gera as artes dos stories diários do Handoff a partir da aba "Stories" da planilha.

A aba é escrita pelo Apps Script (Publições.gs). Cada linha tem ID, Tipo e Textos (JSON). Tipos:
    pergunta  pergunta do dia (respostas pela barra de mensagem do story)
    ligas     story das 18:30, com o perfil da liga marcado em cada cartão. Dois formatos:
              - modo "abertas" (atual): "Inscrições abertas", até 5 eventos por prazo mais perto.
                Cada linha de "ligas" é  usuario|organização|evento|prazo|novo  (prazo: "até 23/10",
                "até hoje", "até amanhã"; novo: "1" se o evento entrou hoje); "mais" = quantos sobraram.
              - sem modo (antigo): "Nas ligas hoje", linhas  usuario|nome  das ligas que postaram no dia.
    vagas     story diário do buscador de vagas (aba "Vagas do site"), até 3 cartões. Cada linha de "vagas" é
              categoria|título|instituição · local|rótulo|data|urgente   (rótulo: "até" ou "abre";
              data: "25/10"; urgente: "1" se fecha em até 3 dias). "total" = vagas no site, "url" = endereço.

Saída em posts/stories/<ID>/:
    story.jpg    1080x1920
    textos.json  textos usados (se mudarem na planilha, a arte é refeita)
    estilo.txt   versão do visual

Uso:
    python3 scripts/gerar_stories.py                  # lê a planilha
    python3 scripts/gerar_stories.py --csv stories.csv
    python3 scripts/gerar_stories.py --checar         # só escreve tem=1/tem=0
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
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MODELOS = RAIZ / "modelos" / "_story"
SAIDA = RAIZ / "posts" / "stories"
TEMP = RAIZ / ".gerar-stories"

PLANILHA = os.environ.get("HANDOFF_PLANILHA", "1CKy25A_WejA8AvJMhS4jfxIJnngdGHLKK7fP7tgpKgA")
ABA = os.environ.get("HANDOFF_ABA_STORIES", "Stories")
ESTILO = "stories-1"
MAX_POR_RODADA = 10

# Cores do Handoff (as mesmas das categorias): a pergunta do dia troca de cor a cada dia.
CORES = [("#1D3FC4", "#F7941D"), ("#3FB67A", "#FFC93C"), ("#8C86E6", "#FFC93C"),
         ("#3FA0F0", "#1D3FC4"), ("#F7941D", "#1D3FC4")]

# Cartões das ligas: precisam bater com STORIES_LIGAS_POS no Apps Script (marcação dos perfis).
LIGAS_TOPO, LIGAS_PASSO, LIGAS_ALTURA, LIGAS_MAX = 640, 165, 140, 5


def esc(v) -> str:
    return html.escape(str(v or "").strip())


def baixar() -> str:
    url = (f"https://docs.google.com/spreadsheets/d/{PLANILHA}/gviz/tq?tqx=out:csv&headers=1&sheet="
           + urllib.parse.quote(ABA))
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")


def itens(texto_csv: str):
    for linha in csv.DictReader(io.StringIO(texto_csv)):
        id_ = str(linha.get("ID", "")).strip()
        tipo = str(linha.get("Tipo", "")).strip().lower()
        if not re.fullmatch(r"[A-Za-z0-9_-]{4,40}", id_) or tipo not in ("pergunta", "ligas", "vagas"):
            continue
        try:
            textos = json.loads(linha.get("Textos") or "{}")
        except json.JSONDecodeError:
            print(f"{id_}: 'Textos' não é JSON válido", file=sys.stderr)
            continue
        textos["tipo"] = tipo
        yield id_, textos


def cor_do_dia(id_: str):
    n = int(re.sub(r"\D", "", id_) or 0)
    return CORES[n % len(CORES)]


def preencher(modelo: str, campos: dict) -> str:
    texto = (MODELOS / modelo).read_text(encoding="utf-8")
    for chave, valor in campos.items():
        texto = texto.replace("{{" + chave + "}}", valor)
    return texto


def montar_html(id_: str, t: dict) -> str:
    cor, detalhe = cor_do_dia(id_)
    if t["tipo"] == "pergunta":
        opcoes = [o for o in str(t.get("opcoes") or "").split("\n") if o.strip()]
        bloco = "".join(f'<div class="opcao"><b>{i}</b><span>{esc(o)}</span></div>' for i, o in enumerate(opcoes[:4], 1))
        return preencher("pergunta.html", {
            "TITULO_PAGINA": "Pergunta do dia", "COR": cor, "COR_DETALHE": detalhe,
            "TAG": esc(t.get("tag") or "PERGUNTA DO DIA"), "PERGUNTA": esc(t.get("pergunta")),
            "OPCOES": bloco, "CTA": esc(t.get("cta") or "Responde aqui embaixo"),
        })
    if t["tipo"] == "vagas":
        return html_vagas(t)
    if t.get("modo") == "abertas":
        return html_abertas(t, cor, detalhe)
    linhas = [l.split("|", 1) for l in str(t.get("ligas") or "").split("\n") if l.strip()]
    cartoes = []
    for i, partes in enumerate(linhas[:LIGAS_MAX]):
        arroba = "@" + partes[0].strip().lstrip("@")
        nome = partes[1].strip() if len(partes) > 1 else ""
        topo = LIGAS_TOPO + i * LIGAS_PASSO
        rot = (-1.2, 1.0, -0.6, 1.3, -1.0)[i]
        cartoes.append(
            f'<div class="liga" style="top:{topo}px;height:{LIGAS_ALTURA}px;transform:rotate({rot}deg)">'
            f'<div class="arroba">{esc(arroba)}</div>' + (f'<div class="nome">{esc(nome)}</div>' if nome else "") + "</div>")
    resto = len(linhas) - LIGAS_MAX
    mais = (f'<div style="font-weight:800;font-size:34px">+ {resto} liga{"s" if resto > 1 else ""} postaram hoje</div>'
            if resto > 0 else "")
    return preencher("ligas.html", {
        "TITULO_PAGINA": "Hoje no feed das ligas", "COR": cor, "COR_DETALHE": detalhe,
        "TAG": esc(t.get("tag") or "POSTOU HOJE"), "TITULO": esc(t.get("titulo") or "Nas ligas hoje"),
        "LIGAS": "\n".join(cartoes), "MAIS": mais, "CTA": esc(t.get("cta") or "Toca no perfil e confere"),
    })


def html_abertas(t: dict, cor: str, detalhe: str) -> str:
    """Story "Inscrições abertas": cartões com evento, liga e prazo (mesma posição dos cartões das ligas)."""
    linhas = [(l.split("|") + [""] * 5)[:5] for l in str(t.get("ligas") or "").split("\n") if l.strip()]
    cartoes = []
    for i, (user, org, evento, prazo, novo) in enumerate(linhas[:LIGAS_MAX]):
        user, org, prazo = user.strip().lstrip("@"), org.strip(), prazo.strip()
        quem = f"@{user}" + (f" · {org}" if org else "") if user else org
        quando = re.sub(r"^até\s+", "", prazo, flags=re.I) or "—"
        urgente = quando.lower() in ("hoje", "amanhã")
        topo = LIGAS_TOPO + i * LIGAS_PASSO
        rot = (-1.2, 1.0, -0.6, 1.3, -1.0)[i]
        cartoes.append(
            f'<div class="ev" style="top:{topo}px;height:{LIGAS_ALTURA}px;transform:rotate({rot}deg)">'
            f'<div class="corpo"><div class="titulo">{esc(evento)}</div>'
            + (f'<div class="quem">{esc(quem)}</div>' if quem else "") + "</div>"
            f'<div class="prazo{" urgente" if urgente else ""}"><small>até</small><b>{esc(quando)}</b></div>'
            + ('<div class="novo">NOVO</div>' if str(novo).strip() == "1" else "") + "</div>")
    try:
        resto = int(t.get("mais") or 0)
    except ValueError:
        resto = 0
    mais = (f'<div style="font-weight:800;font-size:34px">+ {resto} evento{"s" if resto > 1 else ""} '
            f'com inscrição aberta no perfil</div>' if resto > 0 else "")
    return preencher("abertas.html", {
        "TITULO_PAGINA": "Inscrições abertas", "COR": cor, "COR_DETALHE": detalhe,
        "TAG": esc(t.get("tag") or "CORRE QUE DÁ TEMPO"), "TITULO": esc(t.get("titulo") or "Inscrições abertas"),
        "EVENTOS": "\n".join(cartoes), "MAIS": mais, "CTA": esc(t.get("cta") or "Toca na liga e garante a vaga"),
    })


# Story do buscador de vagas: 3 cartões grandes, cores das categorias do site.
VAGAS_TOPO, VAGAS_PASSO, VAGAS_ALTURA, VAGAS_MAX = 640, 270, 230, 3
CORES_CATEGORIA = {
    "eletiva clínica": "#8C86E6", "curso de verão/inverno": "#F7941D", "estágio/observership": "#3FB67A",
    "pesquisa": "#3FA0F0", "intercâmbio": "#FFFFFF", "evento científico": "#FFC93C", "bolsa": "#E8483B",
    "curso online": "#C6F24E",
}


def html_vagas(t: dict) -> str:
    linhas = [(l.split("|") + [""] * 6)[:6] for l in str(t.get("vagas") or "").split("\n") if l.strip()]
    cartoes = []
    for i, (cat, titulo, quem, rotulo, data, urgente) in enumerate(linhas[:VAGAS_MAX]):
        cor = CORES_CATEGORIA.get(cat.strip().lower(), "#C6F24E")
        rotulo = (rotulo.strip() or "até").lower()
        classe = " urgente" if urgente.strip() == "1" else (" breve" if rotulo == "abre" else "")
        topo = VAGAS_TOPO + i * VAGAS_PASSO
        rot = (-1.2, 1.0, -0.6)[i]
        cartoes.append(
            f'<div class="vg" style="top:{topo}px;height:{VAGAS_ALTURA}px;transform:rotate({rot}deg)">'
            f'<div class="corpo"><div class="cat"><i style="background:{cor}"></i>{esc(cat)}</div>'
            f'<div class="titulo">{esc(titulo)}</div>'
            + (f'<div class="quem">{esc(quem)}</div>' if quem.strip() else "") + "</div>"
            f'<div class="prazo{classe}"><small>{esc(rotulo)}</small><b>{esc(data) or "—"}</b></div></div>')
    try:
        total = int(t.get("total") or 0)
    except ValueError:
        total = 0
    resto = total - len(cartoes)
    bloco_total = (f'<div class="mont" style="font-size:46px;text-align:center;line-height:1.1">+ {resto} oportunidade{"s" if resto > 1 else ""}<br>'
                   f'no Brasil e no exterior</div>' if resto > 0 else "")
    return preencher("vagas.html", {
        "TITULO_PAGINA": "Vagas de medicina",
        "TAG": esc(t.get("tag") or "BUSCADOR DE VAGAS"), "TITULO": esc(t.get("titulo") or "Vagas abertas"),
        "VAGAS": "\n".join(cartoes), "TOTAL": bloco_total,
        "CTA": esc(t.get("cta") or "Todas no link da bio"), "URL": esc(t.get("url") or ""),
    })


def canon(t: dict) -> str:
    return json.dumps(t, ensure_ascii=False, sort_keys=True, indent=1)


def em_dia(id_: str, t: dict) -> bool:
    pasta = SAIDA / id_
    try:
        return ((pasta / "textos.json").read_text(encoding="utf-8") == canon(t)
                and (pasta / "estilo.txt").read_text(encoding="utf-8").strip() == ESTILO)
    except FileNotFoundError:
        return False


async def renderizar(trabalhos):
    from PIL import Image
    from playwright.async_api import async_playwright

    feitos, erros = [], []
    async with async_playwright() as p:
        navegador = await p.chromium.launch()
        for id_, t in trabalhos:
            try:
                tmp = TEMP / id_
                tmp.mkdir(parents=True, exist_ok=True)
                destino = SAIDA / id_
                destino.mkdir(parents=True, exist_ok=True)
                arq = tmp / "story.html"
                arq.write_text(montar_html(id_, t), encoding="utf-8")
                pagina = await navegador.new_page(viewport={"width": 1080, "height": 1920})
                await pagina.goto(arq.resolve().as_uri())
                await pagina.evaluate("document.fonts.ready")
                await pagina.evaluate("window.ajustar && window.ajustar()")
                await pagina.wait_for_timeout(250)
                png = tmp / "story.png"
                await pagina.screenshot(path=str(png), clip={"x": 0, "y": 0, "width": 1080, "height": 1920})
                await pagina.close()
                Image.open(png).convert("RGB").save(destino / "story.jpg", quality=90, optimize=True)
                (destino / "textos.json").write_text(canon(t), encoding="utf-8")
                (destino / "estilo.txt").write_text(ESTILO + "\n", encoding="utf-8")
                feitos.append(id_)
            except Exception as e:
                erros.append(f"{id_}: {e}")
        await navegador.close()
    return feitos, erros


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--forcar", action="store_true")
    ap.add_argument("--checar", action="store_true")
    args = ap.parse_args()
    try:
        texto = Path(args.csv).read_text(encoding="utf-8") if args.csv else baixar()
    except Exception as e:  # aba ainda não existe: nada a fazer
        print(f"Sem aba de stories: {e}", file=sys.stderr)
        texto = ""
    trabalhos = [(i, t) for i, t in itens(texto) if args.forcar or not em_dia(i, t)]
    if args.checar:
        print(f"tem={1 if trabalhos else 0}")
        return 0
    if not trabalhos:
        print("Nenhum story novo para gerar.")
        return 0
    feitos, erros = asyncio.run(renderizar(trabalhos[:MAX_POR_RODADA]))
    shutil.rmtree(TEMP, ignore_errors=True)
    print(f"Stories gerados: {len(feitos)} ({', '.join(feitos)})")
    for e in erros:
        print("ERRO", e)
    return 1 if erros and not feitos else 0


if __name__ == "__main__":
    sys.exit(main())
