# Bot de WhatsApp para "Mis gastos": cómo ponerlo en marcha

Le mandás al bot un mensaje o un audio ("gasté 15 mil en el súper", "ayer nafta 30 lucas") y te contesta lo que anotó. Cuando abrís la app, esos gastos aparecen solos en su categoría.

Todo es gratis. Lo hacés una sola vez desde la compu y lleva unos 40 minutos. Tené a mano un bloc de notas para ir copiando los datos que te piden.

La app ya está actualizada en https://bertonejoaquin02-ai.github.io/Mis-gastos/ con la parte del bot. Vos solo hacés las cuentas de Groq, Cloudflare y Meta, y al final pegás dos datos en la app.

El código del bot está en https://github.com/bertonejoaquin02-ai/Mis-gastos/blob/main/bot/worker.js

---

## Paso 1. Clave de Groq (entiende los audios y los mensajes)

1. Entrá a https://console.groq.com y creá una cuenta (podés usar Google).
2. En el menú, entrá a **API Keys** y tocá **Create API Key**. Ponele de nombre `gastos`.
3. Copiá la clave (empieza con `gsk_`) y guardala en el bloc de notas como **GROQ_API_KEY**. Solo se muestra una vez.

## Paso 2. Inventá dos palabras clave

Anotá en el bloc de notas dos palabras largas inventadas, sin espacios ni tildes:
- **VERIFY_TOKEN**: por ejemplo `pepito-verifica-2026`.
- **APP_KEY**: por ejemplo `naranja-tigre-4471-gastos`. Esta es la que vas a pegar en la app. Que sea difícil de adivinar.

## Paso 3. El "buzón" en Cloudflare

1. Entrá a https://dash.cloudflare.com y creá una cuenta gratis.
2. Menú de la izquierda: **Storage & Databases > KV** (o **Workers KV**). Tocá **Create** y ponele de nombre `buzon`.
3. Menú de la izquierda: **Workers & Pages** > **Create** > **Start with Hello World** (o "Create Worker"). Ponele de nombre `mis-gastos-bot` y tocá **Deploy**.
4. Tocá **Edit code**. Borrá todo lo que hay. Abrí https://raw.githubusercontent.com/bertonejoaquin02-ai/Mis-gastos/main/bot/worker.js en otra pestaña, seleccioná todo (Ctrl+A), copiá y pegalo ahí. Tocá **Deploy**.
5. Arriba a la izquierda aparece la dirección del bot, algo como `https://mis-gastos-bot.tunombre.workers.dev`. Anotala como **DIRECCIÓN DEL BOT**. Si la abrís en el navegador tiene que decir "Bot de Mis gastos funcionando ✔".
6. Volvé al Worker > pestaña **Bindings** (o **Settings > Bindings**) > **Add binding** > **KV namespace**. En "Variable name" escribí `BUZON` (en mayúsculas) y elegí `buzon`. Guardá.
7. Pestaña **Settings > Variables and Secrets** > **Add**. Cargá estas, eligiendo tipo **Secret** en todas:

   | Nombre | Valor |
   |---|---|
   | `GROQ_API_KEY` | la clave del paso 1 |
   | `VERIFY_TOKEN` | la palabra del paso 2 |
   | `APP_KEY` | la otra palabra del paso 2 |
   | `NUMEROS_PERMITIDOS` | tu número de WhatsApp con código de país, sin + ni espacios. Ej: `5491122334455`. Si lo va a usar más de una persona, separalos con coma. |

   Las dos que faltan (`WHATSAPP_TOKEN` y `PHONE_NUMBER_ID`) las cargás en el paso 5. Tocá **Deploy** / **Save** al terminar.

## Paso 4. El número de WhatsApp en Meta

1. Entrá a https://developers.facebook.com con tu cuenta de Facebook y tocá **Empezar / Get started** para registrarte como desarrollador.
2. **Mis apps > Crear app**. Cuando te pregunte el caso de uso, elegí **Conectar con clientes a través de WhatsApp** (Connect with customers through WhatsApp). Ponele de nombre `Mis gastos`. Si te pide un "portfolio comercial", creá uno con tu nombre.
3. Dentro de la app, entrá a **WhatsApp > Configuración de la API** (API Setup). Ahí Meta te da un **número de prueba gratis**.
   - Anotá el **Identificador del número de teléfono** (Phone number ID) como **PHONE_NUMBER_ID**.
   - En **Para / To**, agregá tu número de celular y confirmalo con el código que te llega por WhatsApp. Solo los números que agregues acá pueden hablar con el bot.
   - Guardá el número de prueba en los contactos de tu celular como "Bot gastos".

### Token que no se vence

El token que aparece en esa página dura solo 24 horas. Para tener uno permanente:

1. Entrá a https://business.facebook.com/settings > **Usuarios > Usuarios del sistema** > **Agregar**. Nombre `bot`, rol **Administrador**.
2. Con ese usuario elegido, tocá **Asignar activos** > **Apps** > `Mis gastos` > activá **Control total**. Guardá.
3. Tocá **Generar token**. Elegí la app `Mis gastos`, vencimiento **Nunca**, y marcá los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Copiá el token y anotalo como **WHATSAPP_TOKEN**.

## Paso 5. Conectar Meta con el buzón

1. En Cloudflare, Worker > **Settings > Variables and Secrets**, agregá como **Secret**:
   - `WHATSAPP_TOKEN` = el token permanente.
   - `PHONE_NUMBER_ID` = el identificador del número.
2. En Meta, dentro de la app: **WhatsApp > Configuración** (Configuration) > **Webhook** > **Editar**:
   - URL de devolución de llamada: tu DIRECCIÓN DEL BOT + `/webhook`. Ej: `https://mis-gastos-bot.tunombre.workers.dev/webhook`
   - Token de verificación: tu VERIFY_TOKEN.
   - Tocá **Verificar y guardar**.
3. Más abajo, en **Campos del webhook**, buscá **messages** y activá **Suscribirse**.

**Probalo:** mandale "hola" al número de prueba desde tu WhatsApp. Te tiene que contestar con la ayuda. Después mandale "gasté 15 mil en el súper" o un audio.

## Paso 6. Conectar la app

1. En el celular, abrí la app desde el ícono. Cerrala del todo y volvela a abrir, así baja la versión nueva (puede hacer falta repetirlo una vez).
2. Andá a **Datos > Bot de WhatsApp**. Si no aparece esa sección, cerrala y abrila otra vez.
3. Pegá la **DIRECCIÓN DEL BOT** y la **APP_KEY**, y tocá **Guardar y traer gastos del bot**.

Listo. Cada vez que abras la app (y cada minuto mientras está abierta) trae los gastos nuevos y te avisa "Llegó 1 gasto de WhatsApp".

---

## Cómo usarlo

- Texto o audio: "gasté 15 mil en el súper", "nafta 30000", "ayer pagué la luz 42.500", "2 lucas el kiosco".
- Varios en un mensaje: "súper 20 mil y farmacia 8 mil".
- Si se equivocó: escribí **borrar** y saca el último (si todavía no abriste la app; si ya está en la app, borralo desde ahí).
- **ayuda** te muestra ejemplos.
- La categoría la elige el bot entre las tuyas. Si no encaja en ninguna, va a "Otros". Podés cambiarla tocando el gasto en la app.

## Importante

- Conectá el bot en **un solo celular**. Cuando una app trae un gasto, sale del buzón, así que otro celular ya no lo vería.
- Solo responde a los números de `NUMEROS_PERMITIDOS`. Si después querés que lo use otra persona, agregá su número ahí y también en Meta (paso 4, "Para / To").

## Si algo no anda

- **El bot no contesta:** revisá que el webhook diga verificado y que "messages" esté suscripto. En Cloudflare, Worker > **Logs** (activá "Real-time logs") y mandá un mensaje: ahí se ve el error.
- **"número no permitido" en los logs:** el número en `NUMEROS_PERMITIDOS` no coincide. Ponelo como aparece en el log.
- **Dejó de contestar después de un día:** estás usando el token de 24 horas. Hacé el "Token que no se vence".
- **La app dice "La clave del bot no es correcta":** lo que pegaste no es igual a `APP_KEY`.
