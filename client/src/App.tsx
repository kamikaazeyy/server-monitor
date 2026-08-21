import { useState, type ReactNode } from 'react';
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
import FitsoBuilds from './components/FitsoBuilds';
import Database from './components/Database';

type Tab = 'overview' | 'containers' | 'projects' | 'services' | 'github' | 'builds' | 'speed' | 'terminal' | 'database';

function View({ tab, setTab }: { tab: Tab; setTab: (tab: string) => void }): ReactNode {
  return (
    <>
      <div className={tab === 'overview' ? '' : 'hidden'}><Dashboard setTab={setTab} /></div>
      <div className={tab === 'containers' ? '' : 'hidden'}><Containers /></div>
      <div className={tab === 'projects' ? '' : 'hidden'}><Projects /></div>
      <div className={tab === 'services' ? '' : 'hidden'}><Services /></div>
      <div className={tab === 'github' ? '' : 'hidden'}><GitHubCI /></div>
      <div className={tab === 'builds' ? '' : 'hidden'}><FitsoBuilds /></div>
      <div className={tab === 'speed' ? '' : 'hidden'}><SpeedTest /></div>
      <div className={tab === 'terminal' ? '' : 'hidden'}><TerminalWidget /></div>
      <div className={tab === 'database' ? '' : 'hidden'}><Database /></div>
    </>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const setTab = (tab: string) => setActiveTab(tab as Tab);

  return (
    <div className="flex h-screen overflow-hidden bg-bg dark:bg-bg-dark">
      <Sidebar active={activeTab} onChange={setActiveTab} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <MobileNav active={activeTab} onChange={setActiveTab} />
        <main className="flex-1 overflow-y-auto">
          <View tab={activeTab} setTab={setTab} />
        </main>
      </div>
    </div>
  );
}

export default App;
