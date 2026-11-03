import { useEffect, useRef, useState, useCallback } from 'react';
import { session, api, wsUrl, API_BASE, reloadIfStale } from './lib.js';

// One live connection to a table. Reconnects on its own.
export function useTable(code) {
  const [state, setState] = useState(null);
  const [chat, setChat] = useState([]);
  const [status, setStatus] = useState('connecting'); // connecting | open | closed | gone
  const [toast, setToast] = useState(null);
  const [history, setHistory] = useState(null);
  const wsRef = useRef(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let timer = null;

    const connect = () => {
      const ws = new WebSocket(wsUrl(`/ws/${code}?token=${encodeURIComponent(session.token() ?? '')}`));
      wsRef.current = ws;
      setStatus((s) => (s === 'open' ? 'connecting' : s));
      let opened = false;
      ws.onopen = () => { if (retry > 0) reloadIfStale(); opened = true; retry = 0; setStatus('open'); };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') {
          offsetRef.current = msg.state.serverNow - Date.now();
          setState(msg.state);
        } else if (msg.type === 'chat') {
          setChat((c) => (msg.append ? [...c, ...msg.messages] : msg.messages).slice(-50));
        } else if (msg.type === 'error') {
          setToast({ id: Date.now(), text: msg.message });
        } else if (msg.type === 'history') {
          setHistory(msg.hands);
        }
      };
      ws.onclose = (ev) => {
        if (stopped) return;
        // a socket refused before opening may mean the session expired
        if (!opened) {
          api('/api/me').catch((e) => {
            if (e.status === 401) { stopped = true; session.clear(); location.reload(); }
          });
        }
        if (ev.code === 1006 && retry > 4) setStatus('closed');
        else setStatus('connecting');
        retry++;
        timer = setTimeout(connect, Math.min(8000, 400 * 2 ** Math.min(retry, 5)));
      };
    };

    // check the table exists before opening a socket
    fetch(`${API_BASE}/api/tables/${code}`).then((r) => {
      if (stopped) return;
      if (r.status === 404) setStatus('gone');
      else connect();
    }).catch(() => !stopped && connect());

    const onVisible = () => { if (document.visibilityState === 'visible') reloadIfStale(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => { stopped = true; clearTimeout(timer); wsRef.current?.close(); document.removeEventListener('visibilitychange', onVisible); };
  }, [code]);

  const send = useCallback((type, payload = {}) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
    else setToast({ id: Date.now(), text: 'Reconnecting… try again in a second.' });
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { state, chat, status, toast, setToast, send, serverNow, history };
}
