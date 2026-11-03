import type { NextConfig } from "next";

const esProduccion = process.env.NODE_ENV === "production";

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
      {
        // Cabeceras de seguridad para todas las respuestas (también estáticos).
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          {
            // CSP mínima: no limita scripts (Next usa inline), pero impide
            // enmarcar la app, cargar plugins y enviar formularios fuera.
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
          ...(esProduccion
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
