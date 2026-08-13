export interface CpuData {
  usage: number;
  cores: number;
  load: number[];
  error?: string;
}

export interface MemoryData {
  total: number;
  free: number;
  used: number;
  percent: number;
  totalHuman: string;
  usedHuman: string;
  freeHuman: string;
}

export interface DiskData {
  path: string;
  total: number;
  available: number;
  used: number;
  percent: number;
  totalHuman: string;
  usedHuman: string;
  availableHuman: string;
}

export interface NetInterface {
  name: string;
  rxSpeed: number;
  txSpeed: number;
  rxTotal: number;
  txTotal: number;
  rxSpeedHuman: string;
  txSpeedHuman: string;
}

export interface OverviewData {
  cpu: CpuData;
  memory: MemoryData;
  disk: DiskData;
  uptime: number;
}

export interface NetworkData {
  interfaces: NetInterface[];
  timestamp: number;
}

export interface ContainerData {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  labels: Record<string, string>;
  project: string | null;
  service: string;
  cpu: number;
  memory: number;
  memoryUsage: string;
  netIO: string;
  pids: number;
}

export interface ProjectData {
  project: string;
  containers: ContainerData[];
}

export interface ServiceData {
  unit: string;
  state: string;
  sub: string;
  description: string;
}

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  state: string;
  status: string;
  checks: number | string;
  url: string;
}

export interface WorkflowRun {
  name: string;
  branch: string;
  event: string;
  status: string;
  conclusion?: string;
  url: string;
  updatedAt: string;
}

export interface GitHubData {
  repo: string;
  pulls: PullRequest[];
  runs: WorkflowRun[];
  error?: string;
}

export interface SpeedTestResult {
  speedMbps: number;
  duration: number;
  source: string;
  error?: string;
}

export interface HistoryPoint {
  time: number;
  cpu: number;
  memory: number;
  networkRx: number;
  networkTx: number;
}
