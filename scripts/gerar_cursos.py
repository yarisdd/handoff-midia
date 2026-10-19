"""Gera os carrosséis diários de cursos gratuitos do Handoff a partir da aba "Cursos — Carrosséis" da planilha.

A aba é escrita pelo Apps Script (Cursos.gs): cada linha é um carrossel (ID "C<yyyyMMdd>") com a coluna
"Textos" em JSON:
    {"tipo": "cursos", "versao": 1, "tema": "Infectologia", "paleta": "azul",
     "cursos": [{"titulo": "...", "instituicao": "FIOCRUZ - BRASÍLIA", "horas": "45", "area": "Atualização · EAD",
                 "imagem": "https://arouca.unasus.gov.br/app/imagem/curso/47003/360.jpg"}, ...]}

Saída em posts/cursos/<ID>/:
    slide-1.jpg        capa ("Cursos gratuitos de <tema>")
    slide-2.jpg ...    um slide por curso (card do curso)
    slide-N.jpg        fechamento ("Comenta EU QUERO")
    textos.json        textos usados (se mudarem na planilha, as artes são refeitas)
    estilo.txt         versão do visual

Uso:
    python3 scripts/gerar_cursos.py                  # lê a planilha
    python3 scripts/gerar_cursos.py --csv cursos.csv
    python3 scripts/gerar_cursos.py --checar         # só escreve tem=1/tem=0
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
MODELOS = RAIZ / "modelos" / "_cursos"
SAIDA = RAIZ / "posts" / "cursos"
TEMP = RAIZ / ".gerar-cursos"

PLANILHA = os.environ.get("HANDOFF_PLANILHA", "1CKy25A_WejA8AvJMhS4jfxIJnngdGHLKK7fP7tgpKgA")
ABA = os.environ.get("HANDOFF_ABA_CURSOS", "Cursos — Carrosséis")
ESTILO = "cursos-1"
MAX_POR_RODADA = 4
MAX_CURSOS = 7  # capa + 7 cursos + fechamento = 9 imagens (o Instagram aceita até 10)

# (fundo, faixa do listrado, cor das estrelas): cores do Handoff, uma por tema.
PALETAS = {
    "azul": ("#1D3FC4", "#2E52D6", "#FFC93C"),
    "verde": ("#2FA96B", "#3FB67A", "#FFC93C"),
    "lilas": ("#7C76DE", "#8C86E6", "#FFC93C"),
    "ceu": ("#2F92E6", "#3FA0F0", "#FFC93C"),
    "laranja": ("#EE8410", "#F7941D", "#1D3FC4"),
}


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
        if not re.fullmatch(r"C\d{8}[A-Za-z0-9_-]{0,8}", id_):
            continue
        try:
            textos = json.loads(linha.get("Textos") or "{}")
        except json.JSONDecodeError:
            print(f"{id_}: 'Textos' não é JSON válido", file=sys.stderr)
            continue
        if not textos.get("cursos"):
            continue
        yield id_, textos


def preencher(modelo: str, campos: dict) -> str:
    texto = (MODELOS / modelo).read_text(encoding="utf-8")
    # A página é salva numa pasta temporária: o CSS comum vai embutido.
    css = (MODELOS / "base.css").read_text(encoding="utf-8")
    texto = texto.replace('<link rel="stylesheet" href="base.css">', "<style>\n" + css + "\n</style>")
    for chave, valor in campos.items():
        texto = texto.replace("{{" + chave + "}}", valor)
    return texto


def horas_txt(h) -> str:
    m = re.search(r"\d+(?:[.,]\d+)?", str(h or ""))
    return (m.group().replace(".", ",") + "H") if m else "EAD"


def montar_htmls(t: dict) -> list:
    cor, faixa, estrela = PALETAS.get(str(t.get("paleta") or "azul"), PALETAS["azul"])
    base = {"COR": cor, "FAIXA": faixa, "COR_ESTRELA": estrela}
    cursos = list(t.get("cursos") or [])[:MAX_CURSOS]
    total = str(len(cursos))
    paginas = [preencher("capa.html", dict(base, TEMA=esc(t.get("tema")), TOTAL=total))]
    for i, c in enumerate(cursos, start=1):
        imagem = str(c.get("imagem") or "").strip()
        if not re.match(r"^https://[\w.-]+/", imagem):
            imagem = ""
        paginas.append(preencher("curso.html", dict(
            base, NUM=str(i), TOTAL=total, IMAGEM=esc(imagem), INSTITUICAO=esc(c.get("instituicao")),
            TITULO=esc(c.get("titulo")), AREA=esc(c.get("area")), HORAS=horas_txt(c.get("horas")), TAG_TOPO="900",
        )))
    paginas.append(preencher("final.html", dict(base, TOTAL=total)))
    return paginas


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
                if destino.exists():
                    shutil.rmtree(destino)  # carrossel refeito pode ter menos slides que o anterior
                destino.mkdir(parents=True, exist_ok=True)
                for n, conteudo in enumerate(montar_htmls(t), start=1):
                    arq = tmp / f"slide-{n}.html"
                    arq.write_text(conteudo, encoding="utf-8")
                    pagina = await navegador.new_page(viewport={"width": 1080, "height": 1350})
                    await pagina.goto(arq.resolve().as_uri(), wait_until="networkidle", timeout=45000)
                    await pagina.evaluate("document.fonts.ready")
                    await pagina.evaluate("window.ajustar && window.ajustar()")
                    await pagina.wait_for_timeout(300)
                    png = tmp / f"slide-{n}.png"
                    await pagina.screenshot(path=str(png), clip={"x": 0, "y": 0, "width": 1080, "height": 1350})
                    await pagina.close()
                    Image.open(png).convert("RGB").save(destino / f"slide-{n}.jpg", quality=90, optimize=True)
                (destino / "textos.json").write_text(canon(t), encoding="utf-8")
                (destino / "estilo.txt").write_text(ESTILO + "\n", encoding="utf-8")
                feitos.append(id_)
            except Exception as e:  # um carrossel com problema não trava os outros
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
        print(f"Sem aba de cursos: {e}", file=sys.stderr)
        texto = ""
    trabalhos = [(i, t) for i, t in itens(texto) if args.forcar or not em_dia(i, t)]
    if args.checar:
        print(f"tem={1 if trabalhos else 0}")
        return 0
    if not trabalhos:
        print("Nenhum carrossel de cursos novo para gerar.")
        return 0
    feitos, erros = asyncio.run(renderizar(trabalhos[:MAX_POR_RODADA]))
    shutil.rmtree(TEMP, ignore_errors=True)
    print(f"Carrosséis de cursos gerados: {len(feitos)} ({', '.join(feitos)})")
    for e in erros:
        print("ERRO", e)
    return 1 if erros and not feitos else 0


if __name__ == "__main__":
    sys.exit(main())
