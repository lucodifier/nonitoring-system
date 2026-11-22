import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getEnv } from '../lib/env';

// Obter URL base do WebSocket (remover /api/v1)
const SOCKET_URL = getEnv().API_URL.replace('/api/v1', '');

export const useSocket = (namespace: string) => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    try {
      // Conectar ao namespace específico
      socketRef.current = io(`${SOCKET_URL}/${namespace}`, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socketRef.current.on('connect', () => {
        console.log(`Connected to WebSocket namespace: ${namespace}`);
        setIsConnected(true);
      });

      socketRef.current.on('disconnect', () => {
        console.log(`Disconnected from WebSocket namespace: ${namespace}`);
        setIsConnected(false);
      });

      socketRef.current.on('connect_error', (error) => {
        console.warn(`WebSocket connection error for ${namespace}:`, error);
        setIsConnected(false);
      });
    } catch (error) {
      console.error(`Failed to initialize WebSocket for ${namespace}:`, error);
      setIsConnected(false);
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [namespace]);

  return { socket: socketRef.current, isConnected };
};
