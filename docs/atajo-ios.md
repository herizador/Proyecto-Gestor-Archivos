# Enviar archivos desde iPhone con un Atajo (sin pasar por Archivos)

En iPhone ninguna web puede aparecer en el menú Compartir (límite de Apple).
Este Atajo hace de puente: desde Fotos, Archivos o cualquier app → Compartir →
el Atajo → el archivo sube directo a tu Gestor Familiar con tu token.

## Requisitos (una vez)

1. En la PWA ve a **Ajustes** y crea una contraseña de Explorador (vale la misma
   que la de Windows). Cópiala (`gf_...`).
2. Anota tu dominio, p. ej. `https://tu-app.vercel.app`.

## Crear el Atajo (una vez)

1. Abre la app **Atajos** → **+** → ponle de nombre `Guardar en Gestor Familiar`.
2. Abajo pulsa la **(i)** (detalles) → activa **Mostrar en hoja de compartir** y
   marca como tipos: *Imágenes y multimedia*, *Archivos* y *PDF*.
3. Añade la acción **Obtener contenido de URL** y configúrala así:
   - URL: `https://tu-app.vercel.app/api/subir`
   - Método: **POST**
   - Cuerpo: **Formulario** → **+ Añadir campo nuevo**:
     - Clave `archivo`, valor **Entrada del atajo** (elige la variable de entrada).
     - (Opcional) Clave `scope`, valor `comun` o `privado`.
   - Cabeceras: **+ Añadir** → clave `Authorization`, valor `Bearer gf_pegatutoken`
     (con un espacio tras `Bearer`).
4. Añade después **Mostrar notificación** con el **Contenido de URL** para ver el
   resultado (`{"ok":true,...}` = subido).
5. Pulsa **OK**. Ya sale en Compartir → baja hasta **Atajos** → tu atajo.

## Uso diario

Fotos, Archivos, Mail, WhatsApp… → **Compartir** → tu atajo. Para varios a la
vez, el Atajo trae *Repetir con cada elemento* envolviendo el paso 3.

## Límites y notas

- Máximo **20 MB** por archivo; cupo familiar de **9 GB** (si se llena, responde error).
- Sin `carpetaId` va a la **raíz** del ámbito (`comun` por defecto). Avanzado:
  puedes añadir el campo `carpetaId` con el UUID de una carpeta (visible en la
  URL de la PWA como `?carpeta=...`).
- Si pierdes el iPhone: **Ajustes → Revocar** ese token y el Atajo deja de funcionar.
- La subida queda auditada como `SUBIR_ARCHIVO` en el historial, igual que las manuales.
