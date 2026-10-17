# handoff-midia

Mídia e motor de geração dos posts do @handoff.med, agendados no Metricool.

- `modelos/<post>/` : slides do post em HTML (1080x1350), um arquivo por slide, em ordem alfabética
- `posts/AAAA-MM-DD-slug/` : JPGs prontos de cada post (é daqui que o Metricool puxa as imagens)
- `fontes/` : Montserrat Italic (títulos) e Figtree (texto)
- `assets/` : fotos fixas (ex.: CIS Unisul Pedra Branca, crédito: Unisul)
- `scripts/render.py` : `python3 scripts/render.py modelos/<post> posts/<data-slug>`

Estilo: fundos chapados por slide (azul royal #1D3FC4, azul céu #3FA0F0, lilás #8C86E6, verde #3FB67A, amarelo #FFC93C),
títulos em Montserrat Black Italic com contorno azul-marinho #0A2472 e sombra 3D, adesivos com borda e sombra dura,
textura de pontinhos e granulado, estrelinhas e rabiscos. Destaque verde-limão #C6F24E. Pouco texto, centralizado.
