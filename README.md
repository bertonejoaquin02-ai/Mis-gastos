# Mis gastos

Dirección: https://bertonejoaquin02-ai.github.io/Mis-gastos/

App para anotar los gastos del mes desde el celular. Guarda todo en el dispositivo y funciona sin Internet. Opcionalmente trae los gastos que le mandes al bot de WhatsApp.

## Instalarla en el iPhone
1. Abrir la dirección de la app en **Safari**.
2. Tocar Compartir > **Agregar a pantalla de inicio**.
3. Abrirla siempre desde ese ícono.

En Android: abrirla en Chrome, menú ⋮ > **Instalar app**.

## Copias de seguridad
En la pestaña **Datos** se guarda y se importa una copia de los gastos. Sirve para pasar los datos a otro celular.

## Bot de WhatsApp
Cargar gastos mandando un texto o un audio por WhatsApp. El código está en `bot/worker.js` (Cloudflare Worker) y los pasos para ponerlo en marcha en [bot/INSTRUCCIONES.md](bot/INSTRUCCIONES.md).

## Publicar cambios
GitHub Pages publica la rama `gh-pages`. Al cambiar algo en `main`, subirlo también a `gh-pages` (`git push origin main:gh-pages`) y subir el número de `CACHE` en `sw.js` para que los celulares bajen la versión nueva.
