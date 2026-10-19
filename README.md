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

## Artes automáticas dos eventos

- `modelos/_evento/` : modelo genérico de evento (capa, detalhes e story da véspera), preenchido sozinho
- `scripts/gerar_eventos.py` : lê a coluna "Textos da arte" da aba Publicação da planilha e gera `posts/auto/<ID>/`
  (`slide-1.jpg` capa, `slide-2.jpg` detalhes, `story.jpg` lembrete, `textos.json` os textos usados)
- `.github/workflows/gerar-artes.yml` : roda o script duas vezes por hora (ou em Actions → Gerar artes dos eventos → Run workflow)
  e salva as imagens aqui; o Apps Script publica usando os links públicos delas

Para corrigir o texto de uma arte: edite o JSON da coluna "Textos da arte" na aba Publicação. Na rodada seguinte
a arte é refeita e o post usa a versão nova (se ainda não tiver sido publicado).

## Carrossel diário de cursos gratuitos

- `modelos/_cursos/` : capa ("Cursos gratuitos de <tema>"), um slide por curso (card do curso) e o fechamento
  ("Comenta EU QUERO"). Formato inspirado no post de cursos gratuitos da @fisioeliza, com a identidade do Handoff
- `scripts/gerar_cursos.py` : lê a aba "Cursos — Carrosséis" da planilha e gera `posts/cursos/<ID>/slide-N.jpg`
- `apps-script/Cursos.gs` : catálogo da UNA-SUS (aba "Cursos"), tema e cursos do dia, publicação às 19h e
  resposta por direct a quem comenta "eu quero" (aba "Cursos — Direct")
