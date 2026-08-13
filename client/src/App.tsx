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

type Tab = 'overview' | 'containers' | 'projects' | 'services' | 'github' | 'speed';

function View({ tab, setTab }: { tab: Tab; setTab: (tab: string) => void }): ReactNode {
  switch (tab) {
    case 'overview':
      return <Dashboard setTab={setTab} />;
    case 'containers':
      return <Containers />;
    case 'projects':
      return <Projects />;
    case 'services':
      return <Services />;
    case 'github':
      return <GitHubCI />;
    case 'speed':
      return <SpeedTest />;
  }
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
