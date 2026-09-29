# Meu Mercado

Aplicativo **Meu Mercado — V48.3-GITHUB**, preparado para ser colocado diretamente em um repositório chamado **`meu-mercado`** e publicado pelo **GitHub Pages**.

## Publicar no GitHub Pages

1. No GitHub, crie um repositório com o nome exato **`meu-mercado`**.
2. Escolha **Public** (ou use um plano que permita Pages para repositórios privados).
3. Envie **o conteúdo desta pasta** para a raiz do repositório — não envie esta pasta como uma subpasta e não envie somente o ZIP.
4. Faça o commit na branch **`main`**.
5. Abra **Settings → Pages**.
6. Em **Build and deployment**, escolha **Deploy from a branch**.
7. Selecione **`main`** e **`/ (root)`**.
8. Clique em **Save**.
9. Aguarde o GitHub publicar o site. O endereço normalmente será:
   `https://SEU_USUARIO.github.io/meu-mercado/`

## Estrutura do repositório

- `index.html` — aplicativo principal.
- `firebase-config.js` — configuração do Firebase.
- `manifest.json` — configuração PWA.
- `sw.js` — Service Worker.
- `icon-192.png` e `icon-512.png` — ícones do aplicativo.
- `.nojekyll` — evita processamento do Jekyll.
- `cloudflare-backend/_worker.js` — código do backend de IA para publicação no Cloudflare Workers.

## IA por foto / nota fiscal

O GitHub Pages hospeda apenas a parte estática. Ele **não executa `_worker.js`**.

Nesta versão, a IA do aplicativo usa o Worker Cloudflare configurado no frontend:

`https://sparkling-bonus-95e4.amorim-aj23.workers.dev`

O backend possui as rotas:

- `/api/ai-status`
- `/api/identify-product`
- `/api/read-receipt`

O Worker da Cloudflare precisa continuar publicado e configurado com o binding `AI` ou com o Secret `GEMINI_API_KEY`.

## Firebase

Depois que o GitHub Pages estiver publicado, se o Firebase exigir domínio autorizado, adicione o domínio do Pages em **Firebase Console → Authentication → Settings → Authorized domains**.

## Importante

Este repositório foi preparado para **GitHub Pages + Firebase + IA via Cloudflare Worker**. O GitHub Pages não substitui o backend da Cloudflare.
