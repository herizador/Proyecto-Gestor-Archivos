import {
  Home, FolderOpen, LockKeyhole, Trash2, UserCheck, Star, History, Users,
  Settings, ShieldAlert, ShieldCheck,
} from 'lucide-react'

export type ItemNav = {
  href: string
  texto: string
  icono: React.ReactNode
  descripcion?: string
  admin?: boolean
}

// Las CUATRO puertas de la app. Todo lo demás vive en el menú de la cuenta
// o en los accesos rápidos de Inicio: la familia no tiene que aprenderse
// diez entradas para hacer lo de cada día.
export const NAV_PRINCIPAL: ItemNav[] = [
  { href: '/inicio', texto: 'Inicio', icono: <Home size={18} />, descripcion: 'Tu resumen' },
  { href: '/todos', texto: 'Mis archivos', icono: <FolderOpen size={18} />, descripcion: 'Todo tu contenido' },
  { href: '/mi-caja-fuerte', texto: 'Caja fuerte', icono: <LockKeyhole size={18} />, descripcion: 'Solo para ti' },
  { href: '/papelera', texto: 'Papelera', icono: <Trash2 size={18} />, descripcion: 'Recupera o borra' },
]

// Accesos que no caben en la barra principal pero siguen a un toque.
export const NAV_SECUNDARIA: ItemNav[] = [
  { href: '/compartido', texto: 'Compartido conmigo', icono: <UserCheck size={17} />, descripcion: 'Lo que te han cedido' },
  { href: '/favoritos', texto: 'Favoritos', icono: <Star size={17} />, descripcion: 'Tus marcas personales' },
  { href: '/recientes', texto: 'Recientes', icono: <History size={17} />, descripcion: 'Lo último de la familia' },
  { href: '/familia', texto: 'Mi familia', icono: <Users size={17} />, descripcion: 'Miembros y archivos públicos' },
]

export const NAV_CUENTA: ItemNav[] = [
  { href: '/ajustes', texto: 'Ajustes', icono: <Settings size={17} />, descripcion: 'Explorador y dispositivos' },
  { href: '/admin/historial', texto: 'Historial', icono: <ShieldAlert size={17} />, descripcion: 'Auditoría de la familia', admin: true },
  { href: '/admin/usuarios', texto: 'Usuarios', icono: <ShieldCheck size={17} />, descripcion: 'Roles y accesos', admin: true },
]

export function rutaActiva(pathname: string, href: string): boolean {
  if (pathname === href) return true
  // El explorador clásico (/) cuelga de Mis archivos; el detalle de un
  // miembro, de Familia; y las subcarpetas privadas, de la Caja fuerte.
  if (href === '/todos' && pathname === '/') return true
  if (href === '/familia' && pathname.startsWith('/familia/')) return true
  if (href === '/mi-caja-fuerte' && pathname.startsWith('/mi-caja-fuerte/')) return true
  return false
}
