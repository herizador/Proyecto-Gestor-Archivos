import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Sin caché en vistas dinámicas, pero NUNCA en estáticos versionados
        // (/_next/static, iconos): Next los sirve inmutables y pisarlos con
        // no-store obligaba a re-descargar JS/CSS en cada navegación.
        source: '/((?!_next/static|_next/image|icons).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
