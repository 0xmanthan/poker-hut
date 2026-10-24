import React, { useEffect, useState } from 'react';
import { session, api } from './lib.js';
import Login from './components/Login.jsx';
import Lobby from './components/Lobby.jsx';
import TableScreen from './components/TableScreen.jsx';

const tableCodeFromPath = () => (location.pathname.match(/^\/t\/([A-Za-z0-9]{6})$/)?.[1] ?? null)?.toUpperCase() ?? null;

export default function App() {
  const [user, setUser] = useState(session.user());
  const [code, setCode] = useState(tableCodeFromPath());

  useEffect(() => {
    const onPop = () => setCode(tableCodeFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // drop a stale or revoked session
  useEffect(() => {
    if (!session.token()) return;
    api('/api/me').catch((e) => { if (e.status === 401) { session.clear(); setUser(null); } });
  }, []);

  const go = (next) => {
    history.pushState(null, '', next ? `/t/${next}` : '/');
    setCode(next);
  };

  if (!user) return <Login onSignedIn={setUser} joining={code} />;
  if (code) return <TableScreen key={code} code={code} user={user} onLeave={() => go(null)} />;
  return <Lobby user={user} onOpen={go} onRenamed={setUser} />;
}
