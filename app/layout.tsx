import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Gestor de Archivos Familiar',
  description: 'Plataforma segura y privada para centralizar los documentos importantes de tu familia.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
