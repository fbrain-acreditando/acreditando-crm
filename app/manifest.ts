import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Acreditando CRM',
    short_name: 'Acreditando CRM',
    description: 'CRM Inteligente para Gestão de Vendas',
    start_url: '/boards',
    display: 'standalone',
    background_color: '#ffffff',
    // Azul-ardosia da marca Acreditando, amostrado do logo oficial do site.
    theme_color: '#1F3C51',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        // Zona segura de 80%: o simbolo tem margem extra para nao ser cortado
        // quando o sistema aplica mascara circular/squircle.
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

