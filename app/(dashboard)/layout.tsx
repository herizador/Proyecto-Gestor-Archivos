import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import NavegacionSuperior from '@/components/NavegacionSuperior'
import NavegacionInferior from '@/components/NavegacionInferior'
import PaletaComandos from '@/components/PaletaComandos'
import AnimacionesScroll from '@/components/AnimacionesScroll'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const isAdmin = perfil?.rol === 'admin'

  return (
    <div className="dashboard-layout">
      <NavegacionSuperior perfil={perfil} isAdmin={isAdmin} />

      <main className="main-content">
        {children}
      </main>

      <NavegacionInferior />
      <PaletaComandos />
      <AnimacionesScroll />
    </div>
  )
}
