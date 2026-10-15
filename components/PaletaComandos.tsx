'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  Search, FileText, Folder, LayoutDashboard, Lock, Trash2, Users, Star,
  History, Settings, Loader2,
} from 'lucide-react'
import { buscarArchivos, visualizarArchivo } from '@/actions/files'
import { buscarCarpetas } from '@/actions/folders'
import { buscarAccesos } from '@/actions/accesos'
import { avisar } from '@/components/Avisos'
import type { AccesoConObjetivo, ArchivoConAutor, Carpeta } from '@/types/database'

type ItemPaleta = {
  id: string
  grupo: string
  icono: React.ReactNode
  titulo: string
  subtitulo?: string
  ejecutar: () => void | Promise<void>
}

const oyentesApertura = new Set<() => void>()

// Permite abrirla desde botones (p. ej. el ⌘K de la fila de búsqueda)
export function abrirPaleta() {
  oyentesApertura.forEach((fn) => fn())
}

// Paleta de comandos (Ctrl+K / Cmd+K): búsqueda global + saltos. Solo lectura
// y navegación; las acciones destructivas siguen en sus tarjetas.
export default function PaletaComandos() {
  const [abierta, setAbierta] = useState(false)
  const [query, setQuery] = useState('')
  const [cargando, setCargando] = useState(false)
  const [items, setItems] = useState<ItemPaleta[]>([])
  const [activo, setActivo] = useState(0)
  const [buscado, setBuscado] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const baseCarpetas = pathname.startsWith('/mi-caja-fuerte') ? '/mi-caja-fuerte' : '/'
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function atajo(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAbierta(true)
      }
    }
    function abrir() {
      setAbierta(true)
    }
    window.addEventListener('keydown', atajo)
    oyentesApertura.add(abrir)
    return () => {
      window.removeEventListener('keydown', atajo)
      oyentesApertura.delete(abrir)
    }
  }, [])

  function cerrar() {
    setAbierta(false)
    setQuery('')
    setItems([])
    setActivo(0)
    setBuscado(false)
  }

  async function buscar(texto: string) {
    const q = texto.trim()
    if (q.length < 2) {
      setItems([])
      setBuscado(false)
      setCargando(false)
      return
    }
    setCargando(true)
    const [rArchivos, rCarpetas, rAccesos] = await Promise.all([
      buscarArchivos(q),
      buscarCarpetas(q),
      buscarAccesos(q),
    ])
    const encontrados: ItemPaleta[] = [
      ...((rCarpetas.data ?? []).slice(0, 6).map((c: Carpeta) => ({
        id: `c:${c.id}`,
        grupo: 'Carpetas',
        icono: <Folder size={16} />,
        titulo: c.nombre,
        subtitulo: 'Abrir carpeta',
        ejecutar: () => router.push(`${baseCarpetas}?carpeta=${c.id}`),
      }))),
      ...((rArchivos.data ?? []).slice(0, 6).map((a: ArchivoConAutor) => ({
        id: `a:${a.id}`,
        grupo: 'Archivos',
        icono: <FileText size={16} />,
        titulo: a.nombre_original,
        subtitulo: a.subido_por_perfil?.nombre_completo ?? undefined,
        ejecutar: async () => {
          const res = await visualizarArchivo(a.id)
          if ('url' in res && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
          else avisar('error', ('error' in res && res.error) || 'No se pudo abrir.')
        },
      }))),
      ...((rAccesos.data ?? []).slice(0, 4).map((acc: AccesoConObjetivo) => {
        const nombre = acc.nombre_personalizado || acc.archivo_objetivo?.nombre_original || acc.carpeta_objetivo?.nombre || 'Enlace'
        return {
          id: `x:${acc.id}`,
          grupo: 'Enlaces',
          icono: <FileText size={16} />,
          titulo: nombre,
          subtitulo: 'Abrir enlace',
          ejecutar: async () => {
            const res = await visualizarArchivo(acc.id)
            if ('url' in res && res.url) window.open(res.url, '_blank', 'noopener,noreferrer')
            else avisar('error', ('error' in res && res.error) || 'No se pudo abrir.')
          },
        }
      })),
    ]
    setItems(encontrados)
    setActivo(0)
    setBuscado(true)
    setCargando(false)
  }

  function onCambio(v: string) {
    setQuery(v)
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => buscar(v), 300)
  }

  function onTecla(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      cerrar()
      return
    }
    const lista = query.trim() ? items : ATAJOS(router, cerrar)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo((i) => (e.key === 'ArrowDown' ? (i + 1) % Math.max(lista.length, 1) : (i - 1 + lista.length) % Math.max(lista.length, 1)))
      return
    }
    if (e.key === 'Enter' && lista[activo]) {
      lista[activo].ejecutar()
      cerrar()
    }
  }

  if (!abierta || typeof document === 'undefined') return null
  const lista = query.trim() ? items : ATAJOS(router, cerrar)
  return createPortal(
    <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onClick={cerrar}>
      <div
        className="modal"
        style={{ padding: '12px', maxWidth: '560px' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda rápida"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px 12px' }}>
          <Search size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            className="input"
            style={{ border: 'none', background: 'transparent', padding: '4px', boxShadow: 'none' }}
            placeholder="Buscar archivos, carpetas o ir a…"
            value={query}
            onChange={(e) => onCambio(e.target.value)}
            onKeyDown={onTecla}
            autoFocus
            aria-label="Búsqueda rápida"
          />
          {cargando && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-accent)', flexShrink: 0 }} />}
          <kbd style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '2px 6px', flexShrink: 0 }}>
            ESC
          </kbd>
        </div>
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {query.trim() && buscado && lista.length === 0 && !cargando && (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', padding: '12px 8px' }}>
              Sin resultados para «{query.trim()}».
            </p>
          )}
          {lista.map((it, i) => {
            const cabecera = i === 0 || lista[i - 1].grupo !== it.grupo ? it.grupo : null
            const esActivo = i === activo
            return (
              <div key={it.id}>
                {cabecera && (
                  <p style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', padding: '10px 8px 4px' }}>
                    {cabecera}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    it.ejecutar()
                    cerrar()
                  }}
                  onMouseEnter={() => setActivo(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '10px 12px',
                    background: esActivo ? 'var(--color-accent-dim)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text)',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: esActivo ? 'var(--color-accent)' : 'var(--color-text-muted)', display: 'flex', flexShrink: 0 }}>
                    {it.icono}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.titulo}
                    </span>
                    {it.subtitulo && (
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {it.subtitulo}
                      </span>
                    )}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ATAJOS(router: ReturnType<typeof useRouter>, cerrar: () => void): ItemPaleta[] {
  const ir = (href: string) => () => {
    router.push(href)
    cerrar()
  }
  return [
    { id: 'ir-comun', grupo: 'Ir a', icono: <LayoutDashboard size={16} />, titulo: 'Área común', ejecutar: ir('/') },
    { id: 'ir-recientes', grupo: 'Ir a', icono: <History size={16} />, titulo: 'Recientes', ejecutar: ir('/recientes') },
    { id: 'ir-favoritos', grupo: 'Ir a', icono: <Star size={16} />, titulo: 'Favoritos', ejecutar: ir('/favoritos') },
    { id: 'ir-caja', grupo: 'Ir a', icono: <Lock size={16} />, titulo: 'Mi caja fuerte', ejecutar: ir('/mi-caja-fuerte') },
    { id: 'ir-familia', grupo: 'Ir a', icono: <Users size={16} />, titulo: 'Mi familia', ejecutar: ir('/familia') },
    { id: 'ir-papelera', grupo: 'Ir a', icono: <Trash2 size={16} />, titulo: 'Papelera', ejecutar: ir('/papelera') },
    { id: 'ir-ajustes', grupo: 'Ir a', icono: <Settings size={16} />, titulo: 'Ajustes', ejecutar: ir('/ajustes') },
  ]
}
