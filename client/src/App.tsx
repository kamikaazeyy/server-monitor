import { useEffect, useState, type ReactNode } from 'react';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import Containers from './components/Containers';
import Projects from './components/Projects';
import Services from './components/Services';
import GitHubCI from './components/GitHubCI';
import SpeedTest from './components/SpeedTest';
import TerminalWidget from './components/TerminalWidget';
import EasBuilds from './components/Builds';
import Database from './components/Database';
import AuthScreen from './components/AuthScreen';
import { NotificationProvider } from './context/NotificationContext';
import { getToken, authFetch } from './lib/auth';

type Tab = 'overview' | 'containers' | 'projects' | 'services' | 'github' | 'builds' | 'speed' | 'terminal' | 'database';

function View({ tab, setTab, showBuilds }: { tab: Tab; setTab: (tab: string) => void; showBuilds: boolean }): ReactNode {
  return (
    <>
      <div className={tab === 'overview' ? '' : 'hidden'}><Dashboard setTab={setTab} /></div>
      <div className={tab === 'containers' ? '' : 'hidden'}><Containers /></div>
      <div className={tab === 'projects' ? '' : 'hidden'}><Projects /></div>
      <div className={tab === 'services' ? '' : 'hidden'}><Services /></div>
      <div className={tab === 'github' ? '' : 'hidden'}><GitHubCI /></div>
      {showBuilds && <div className={tab === 'builds' ? '' : 'hidden'}><EasBuilds /></div>}
      <div className={tab === 'speed' ? '' : 'hidden'}><SpeedTest /></div>
      <div className={tab === 'terminal' ? '' : 'hidden'}><TerminalWidget /></div>
      <div className={tab === 'database' ? '' : 'hidden'}><Database /></div>
    </>
  );
}

type AuthState = 'loading' | 'setup' | 'login' | 'authed';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [showBuilds, setShowBuilds] = useState(true);
  const setTab = (tab: string) => setActiveTab(tab as Tab);

  useEffect(() => {
    fetch('/api/auth/status')
      .then((res) => res.json())
      .then((status) => {
        setAuthState(status.authDisabled ? 'authed' : status.needsSetup ? 'setup' : getToken() ? 'authed' : 'login');
      })
      .catch(() => setAuthState(getToken() ? 'authed' : 'login'));
  }, []);

  useEffect(() => {
    if (authState !== 'authed') return;
    authFetch('/api/features')
      .then((res) => (res.ok ? res.json() : null))
      .then((f) => {
        if (f && f.builds === false) setShowBuilds(false);
      })
      .catch(() => {});
  }, [authState]);

  if (authState === 'loading') {
    return <div className="h-screen bg-bg dark:bg-bg-dark" />;
  }

  if (authState !== 'authed') {
    return <AuthScreen needsSetup={authState === 'setup'} onSuccess={() => setAuthState('authed')} />;
  }

  // NotificationProvider lives inside the authed tree so its socket only
  // connects once a token exists — otherwise it would auth-fail and loop.
  return (
    <NotificationProvider>
      <div className="flex h-screen overflow-hidden bg-bg dark:bg-bg-dark">
        <Sidebar active={activeTab} onChange={setActiveTab} showBuilds={showBuilds} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <MobileNav active={activeTab} onChange={setActiveTab} showBuilds={showBuilds} />
          <main className="flex-1 overflow-y-auto">
            <View tab={activeTab} setTab={setTab} showBuilds={showBuilds} />
          </main>
        </div>
      </div>
    </NotificationProvider>
  );
}

export default App;
