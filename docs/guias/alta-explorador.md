# Ver tus archivos en el Explorador (unidad de red)

Tus archivos viven en la nube familiar, pero puedes verlos y abrirlos como una
carpeta más de tu ordenador, **sin descargarlos antes**. Es de **solo lectura**:
desde ahí no se puede borrar, renombrar ni subir nada (para eso está la app).

## 1. Crea tu contraseña de Explorador (una vez por dispositivo)

1. Entra en la app → **Ajustes** → *Explorador de Windows (WebDAV)*.
2. Escribe un nombre (p. ej. "Portátil") y pulsa **Crear contraseña**.
3. **Copia el código `gf_...` en ese momento**: no volverá a mostrarse.
4. Si pierdes el dispositivo o dejas de usarlo, vuelve aquí y pulsa **Revocar**.

## 2. Conectar en Windows

1. Abre el Explorador → *Este equipo* → botón derecho → **Conectar a unidad de red**
   (o "..." → *Conectar a unidad de red* en Windows 11).
2. Carpeta: `https://gestor-familiar.id386827.workers.dev`
3. Marca **"Conectar con otras credenciales"** y pulsa Finalizar.
4. Usuario: **tu email**. Contraseña: **el código `gf_...`**.
5. Verás dos carpetas: **Área común** y **Mi caja fuerte**.

> Si falla con error de red: abre *Servicios* (`services.msc`), busca
> **WebClient**, ponlo en Automático e Inícialo. Si ya lo intentaste con una
> contraseña mal escrita: Panel de control → *Administrador de credenciales* →
> *Credenciales de Windows* → borra la de `*.workers.dev` y reintenta.

## 3. Conectar en macOS

Finder → *Ir* → *Conectar al servidor* → `https://gestor-familiar.id386827.workers.dev`
→ usuario tu email, contraseña el código `gf_...`.

## 4. En Android

Apps como *Solid Explorer*, *Material Files* o *CX Explorador* permiten añadir
una cuenta **WebDAV** con la misma dirección, email y código.

## Preguntas frecuentes

- **¿Ocupa espacio en mi disco?** No: los archivos se abren en streaming.
- **¿Puedo editar o borrar desde ahí?** No, abre en solo lectura. Los cambios se
  hacen en la app.
- **¿Qué significa "Sistema de archivos: FAT"?** Nada: Windows etiqueta así
  todas las unidades de red. Ignóralo.
- **¿Hasta qué tamaño puedo abrir?** Hasta 20 MB por archivo (límite de la app).
- **¿Quién puede ver qué?** Lo mismo que en la app: Área común para todos,
  tu Caja fuerte solo tú. Cada apertura queda registrada en el historial.
