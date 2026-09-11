@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  == Publicando o recebedor de notas na Cloudflare ==
echo.
echo  Sao 5 passos. O primeiro abre o navegador para voce autorizar.
echo.
pause

echo.
echo  [1/5] Entrando na sua conta Cloudflare...
call npx wrangler login

echo.
echo  [2/5] Criando o bucket heli-envios...
call npx wrangler r2 bucket create heli-envios

echo.
echo  [3/5] SEGREDO_ADMIN - invente uma senha longa e ANOTE.
echo        Voce vai precisar dela no envio-config.
echo.
call npx wrangler secret put SEGREDO_ADMIN

echo.
echo  [4/5] CODIGO - uma palavra curta, que vai no link divulgado.
echo.
call npx wrangler secret put CODIGO

echo.
echo  [5/5] Publicando...
call npx wrangler deploy

echo.
echo  ================================================
echo   Anote a URL impressa acima. Agora, na pasta
echo   contas, rode:   node heli.mjs envio-config
echo  ================================================
echo.
pause
