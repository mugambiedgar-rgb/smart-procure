import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

const RealtimeContext = createContext({ subscribe: () => () => {}, connected: false });
export const useRealtime = () => useContext(RealtimeContext);

/** One Socket.IO connection per signed-in user. Components subscribe to events (inventory:update, data:changed, notification:new). */
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const listeners = useRef(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    const socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    ['inventory:update', 'data:changed', 'notification:new'].forEach((evt) => {
      socket.on(evt, (payload) => (listeners.current.get(evt) || new Set()).forEach((fn) => fn(payload)));
    });
    return () => { socket.disconnect(); socketRef.current = null; setConnected(false); };
  }, [user]);

  const subscribe = useCallback((evt, fn) => {
    if (!listeners.current.has(evt)) listeners.current.set(evt, new Set());
    listeners.current.get(evt).add(fn);
    return () => listeners.current.get(evt)?.delete(fn);
  }, []);

  return <RealtimeContext.Provider value={{ subscribe, connected }}>{children}</RealtimeContext.Provider>;
}
