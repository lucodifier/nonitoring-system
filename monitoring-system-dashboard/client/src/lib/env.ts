// Helper para acessar variáveis de ambiente de forma centralizada
// Prioridade: window.__ENV__ (runtime) > import.meta.env (build time) > fallback

export const getEnv = () => {
  const env = typeof window !== 'undefined' ? window.__ENV__ : undefined;
  
  return {
    API_URL: env?.API_URL || import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1',
    APP_TITLE: env?.APP_TITLE || import.meta.env.VITE_APP_TITLE || 'Monitoring System Dashboard',
    APP_LOGO: env?.APP_LOGO || import.meta.env.VITE_APP_LOGO || '/logo.svg',
    ANALYTICS_ENDPOINT: env?.ANALYTICS_ENDPOINT || import.meta.env.VITE_ANALYTICS_ENDPOINT || '',
    ANALYTICS_WEBSITE_ID: env?.ANALYTICS_WEBSITE_ID || import.meta.env.VITE_ANALYTICS_WEBSITE_ID || '',
  };
};
