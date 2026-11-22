// Declarações de tipos globais

declare global {
  interface Window {
    __ENV__?: {
      API_URL?: string;
      APP_TITLE?: string;
      APP_LOGO?: string;
      ANALYTICS_ENDPOINT?: string;
      ANALYTICS_WEBSITE_ID?: string;
    };
  }
}

export {};
