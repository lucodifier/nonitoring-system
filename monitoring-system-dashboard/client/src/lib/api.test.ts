import { describe, it, expect } from 'vitest';
import axios from 'axios';

describe('API Connection', () => {
  it('should connect to the backend API', async () => {
    const apiUrl = process.env.VITE_API_URL || 'http://localhost:3001/api/v1';
    try {
      // Tenta acessar um endpoint público ou de health check
      // Como não temos um endpoint específico de health, vamos tentar o login com credenciais inválidas
      // para verificar se a API responde (esperamos 401, não erro de conexão)
      await axios.post(`${apiUrl}/auth/login`, {
        username: 'test',
        password: 'test'
      });
    } catch (error: any) {
      // Se recebermos uma resposta da API (mesmo erro 401), a conexão está funcionando
      if (error.response) {
        expect(error.response.status).toBeDefined();
      } else {
        // Se for erro de rede (ECONNREFUSED), falha o teste
        throw new Error(`Failed to connect to API at ${apiUrl}: ${error.message}`);
      }
    }
  });
});
