"""Gera os slides de um post do Handoff.

Uso:
    python3 scripts/render.py <pasta-com-html> <pasta-de-saida>

Cada arquivo .html da pasta de entrada (em ordem alfabética) vira
slide-1.jpg, slide-2.jpg, ... em 1080x1350, no formato que o Instagram aceita.
As fontes ficam em fontes/ e as imagens fixas em assets/, então os HTMLs
devem referenciá-las por caminho relativo (../../fontes, ../../assets).
"""
import asyncio
import sys
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright


async def render(src: Path, dst: Path) -> list[Path]:
    dst.mkdir(parents=True, exist_ok=True)
    pages = sorted(src.glob("*.html"))
    if not pages:
        raise SystemExit(f"Nenhum .html em {src}")
    out = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1080, "height": 1350})
        for i, html in enumerate(pages, start=1):
            await page.goto(html.resolve().as_uri())
            await page.evaluate("document.fonts.ready")
            await page.wait_for_timeout(300)
            png = dst / f"slide-{i}.png"
            await page.screenshot(path=str(png), clip={"x": 0, "y": 0, "width": 1080, "height": 1350})
            jpg = dst / f"slide-{i}.jpg"
            Image.open(png).convert("RGB").save(jpg, quality=92, optimize=True)
            png.unlink()
            out.append(jpg)
        await browser.close()
    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    files = asyncio.run(render(Path(sys.argv[1]), Path(sys.argv[2])))
    for f in files:
        print(f)
