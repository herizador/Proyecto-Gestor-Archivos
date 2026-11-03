'use server'

import { createClient } from '@/lib/supabase/server'
import { crearServiceClient } from '@/lib/supabase/service'
import { logActivity } from '@/actions/storage'
import { archivosDeCarpetas } from '@/actions/seleccion'
import { archivosDeCarpetasConCliente } from '@/lib/archivos-carpetas'
import { getPresignedViewUrl } from '@/lib/r2/client'
import { idsUuidValidos, keyValidaParaFila } from '@/lib/archivos-seguros'
import { revalidatePath } from 'next/cache'

// Tope de archivos dentro de un enlace: más allá, la página tendría que firmar
// cientos de URLs en cada visita. Los archivos elegidos a mano van primero.
const MAX_ARCHIVOS_ENLACE = 200
const UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ArchivoCompartible = {
  id: string
  subido_por: string
  ruta_r2: string
}

// Un miembro solo puede enlazar sus propios archivos o los que ya están en un
// ámbito no privado. Lo privado compartido con él no se re-comparte por enlace.
function esCompartible(archivo: ArchivoCompartible, userId: string): boolean {
  if (archivo.subido_por === userId) return true
  return !archivo.ruta_r2.includes('/privado/')
}

function parsearIds(valor: unknown): string[] {
  let bruto: unknown = valor
  if (typeof valor === 'string') {
    try {
      bruto = JSON.parse(valor)
    } catch {
      return []
    }
  }
  return idsUuidValidos(bruto, MAX_ARCHIVOS_ENLACE)
}

export async function generarEnlaceCompartido(params: {
  archivoIds: string[]
  carpetaIds: string[]
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'No autenticado.' }

  const archivoIdsPedidos = idsUuidValidos(params.archivoIds, MAX_ARCHIVOS_ENLACE)
  const carpetaIds = idsUuidValidos(params.carpetaIds, MAX_ARCHIVOS_ENLACE)

  if (archivoIdsPedidos.length === 0 && carpetaIds.length === 0) {
    return { error: 'Selecciona al menos un archivo o carpeta para compartir.' }
  }

  // Los ids enviados por el cliente deben existir, ser visibles (RLS) y ser
  // compartibles. Sin esta comprobación se podría crear un enlace a un archivo
  // privado ajeno solo conociendo su UUID.
  let seleccionados: string[] = []
  if (archivoIdsPedidos.length > 0) {
    const { data, error } = await supabase
      .from('archivos')
      .select('id, subido_por, ruta_r2')
      .in('id', archivoIdsPedidos)
      .eq('estado', 'activo')
    if (error) return { error: 'No se pudieron leer los archivos seleccionados.' }
    const validos = (data ?? []).filter((a) => esCompartible(a, user.id))
    if (validos.length !== archivoIdsPedidos.length) {
      return { error: 'Alguno de los archivos seleccionados ya no está disponible.' }
    }
    seleccionados = validos.map((a) => a.id)
  }

  // Las carpetas elegidas también deben ser propias o públicas: una carpeta
  // privada compartida conmigo no se puede volver a enlazar.
  if (carpetaIds.length > 0) {
    const { data, error } = await supabase
      .from('carpetas')
      .select('id, creado_por, es_privada')
      .in('id', carpetaIds)
    if (error || !data || data.length !== carpetaIds.length) {
      return { error: 'Alguna de las carpetas seleccionadas ya no está disponible.' }
    }
    if (data.some((c) => c.es_privada && c.creado_por !== user.id)) {
      return { error: 'No puedes enlazar una carpeta privada que no es tuya.' }
    }
  }

  // Las carpetas aportan los archivos que contienen (incluidas subcarpetas).
  // Se guardan ya expandidas en archivos_ids: /compartir solo resuelve esa
  // lista y así los enlaces antiguos y nuevos funcionan igual.
  let dentroDeCarpetas: string[] = []
  let truncado = false
  if (carpetaIds.length > 0) {
    const contenido = await archivosDeCarpetas(carpetaIds, MAX_ARCHIVOS_ENLACE)
    if ('error' in contenido) return { error: contenido.error }
    dentroDeCarpetas = contenido.archivos
      .filter((a) => keyValidaParaFila(a.ruta_r2, a.subido_por))
      .filter((a) => esCompartible(a, user.id))
      .map((a) => a.id)
    truncado = contenido.truncado
  }

  let archivosIds = [...new Set([...seleccionados, ...dentroDeCarpetas])]
  if (archivosIds.length > MAX_ARCHIVOS_ENLACE) {
    archivosIds = archivosIds.slice(0, MAX_ARCHIVOS_ENLACE)
    truncado = true
  }

  if (archivosIds.length === 0) {
    return {
      error: carpetaIds.length > 0
        ? 'Las carpetas seleccionadas no contienen archivos.'
        : 'Selecciona al menos un archivo para compartir.',
    }
  }

  const token = crypto.randomUUID()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const shareUrl = `${baseUrl}/compartir?token=${token}`

  let tipoRecurso = 'multiple'
  if (seleccionados.length === 1 && carpetaIds.length === 0) tipoRecurso = 'archivo'
  else if (carpetaIds.length === 1 && seleccionados.length === 0) tipoRecurso = 'carpeta'

  const { error: insertError } = await supabase.from('enlaces_compartidos').insert({
    creado_por: user.id,
    tipo_recurso: tipoRecurso,
    archivos_ids: JSON.stringify(archivosIds),
    carpetas_ids: JSON.stringify(carpetaIds),
    token_acceso: token,
    expiracion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (insertError) return { error: 'No se pudo crear el enlace. Inténtalo de nuevo.' }

  await logActivity({
    accion: 'COMPARTIR_ENLACE',
    detalles: {
      token,
      tipo_recurso: tipoRecurso,
      archivos_ids: archivosIds,
      archivos_seleccionados: seleccionados,
      carpetas_ids: carpetaIds,
    },
  })

  revalidatePath('/')
  return {
    url: shareUrl,
    token,
    totalArchivos: archivosIds.length,
    aviso: truncado
      ? `El enlace incluye los primeros ${MAX_ARCHIVOS_ENLACE} archivos de las carpetas seleccionadas.`
      : undefined,
  }
}

export async function obtenerEnlaceCompartido(token: string) {
  // El token llega de la URL pública: se valida el formato antes de consultar.
  if (typeof token !== 'string' || !UUID_TOKEN.test(token)) {
    return { error: 'Enlace no válido o expirado.' }
  }

  // Lectura con service-role: la policy ya no permite listar enlaces con la
  // anon key. La autorización se aplica aquí, archivo a archivo.
  const servicio = crearServiceClient()
  if (!servicio) {
    return { error: 'Los enlaces compartidos no están configurados en el servidor.' }
  }

  const { data: enlace, error } = await servicio
    .from('enlaces_compartidos')
    .select('*')
    .eq('token_acceso', token)
    .maybeSingle()

  if (error || !enlace) return { error: 'Enlace no válido o expirado.' }

  if (enlace.expiracion && new Date(enlace.expiracion) < new Date()) {
    return { error: 'Este enlace ha expirado.' }
  }

  let archivoIds = parsearIds(enlace.archivos_ids)

  // Enlaces antiguos: solo guardaban carpetas_ids. Se expanden al leer para
  // que sigan mostrando el contenido de la carpeta.
  if (archivoIds.length === 0) {
    const carpetaIds = parsearIds(enlace.carpetas_ids)
    if (carpetaIds.length > 0) {
      const contenido = await archivosDeCarpetasConCliente(
        servicio,
        carpetaIds,
        MAX_ARCHIVOS_ENLACE
      )
      if (!('error' in contenido)) {
        archivoIds = contenido.archivos.map((a) => a.id)
      }
    }
  }

  if (archivoIds.length === 0) return { error: 'No hay archivos en este enlace.' }

  const { data: archivos, error: archivosError } = await servicio
    .from('archivos')
    .select('id, nombre_original, ruta_r2, tamano_bytes, tipo_mime, subido_por')
    .in('id', archivoIds)
    .eq('estado', 'activo')

  if (archivosError) return { error: 'No se pudieron leer los archivos del enlace.' }

  // Un enlace solo puede exponer archivos del creador o de ámbito no privado.
  // Sin este filtro, una fila de enlace manipulada serviría archivos ajenos.
  const autorizados = (archivos ?? []).filter(
    (a) =>
      esCompartible(a, enlace.creado_por) &&
      keyValidaParaFila(a.ruta_r2, a.subido_por)
  )

  const archivosConUrl = await Promise.all(
    autorizados.map(async (archivo) => {
      try {
        const url = await getPresignedViewUrl(archivo.ruta_r2, archivo.tipo_mime)
        return {
          id: archivo.id,
          nombre_original: archivo.nombre_original,
          tamano_bytes: archivo.tamano_bytes,
          tipo_mime: archivo.tipo_mime,
          url,
        }
      } catch {
        return {
          id: archivo.id,
          nombre_original: archivo.nombre_original,
          tamano_bytes: archivo.tamano_bytes,
          tipo_mime: archivo.tipo_mime,
          url: null,
        }
      }
    })
  )

  return {
    enlace: {
      tipo_recurso: enlace.tipo_recurso,
      expiracion: enlace.expiracion,
      fecha_creacion: enlace.fecha_creacion,
    },
    archivos: archivosConUrl,
  }
}
