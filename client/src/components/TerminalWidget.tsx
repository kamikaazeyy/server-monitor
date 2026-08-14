import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

export default function TerminalWidget() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0f0f11',
        foreground: '#e5e5e5',
        cursor: '#dfff4f',
        selectionBackground: '#ffffff33',
        black: '#0f0f11',
        brightBlack: '#5a5a5a',
        red: '#ff6b6b',
        brightRed: '#ff8585',
        green: '#dfff4f',
        brightGreen: '#e9ff80',
        yellow: '#f7e463',
        brightYellow: '#fff493',
        blue: '#6b8eff',
        brightBlue: '#93aeff',
        magenta: '#d66bff',
        brightMagenta: '#e79aff',
        cyan: '#6beeff',
        brightCyan: '#9cf3ff',
        white: '#e5e5e5',
        brightWhite: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    term.focus();

    const socketUrl = import.meta.env.VITE_TERMINAL_URL || window.location.origin;
    const socket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        socket.emit('terminal:resize', { cols: dims.cols, rows: dims.rows });
      }
    });

    term.onData((data) => {
      socket.emit('terminal:input', data);
    });

    socket.on('terminal:data', (data: string) => {
      term.write(data);
    });

    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        socket.emit('terminal:resize', { cols: dims.cols, rows: dims.rows });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-screen-2xl p-4 md:h-[calc(100vh-6rem)]">
      <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-black/5 bg-surface p-4 shadow-sm dark:border-white/10 dark:bg-surface-dark dark:shadow-none">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink dark:text-white">Terminal</h2>
          <span className="text-xs text-muted dark:text-gray-400">xterm.js / node-pty</span>
        </div>
        <div ref={terminalRef} className="min-h-0 flex-1 overflow-hidden rounded-2xl" />
      </div>
    </div>
  );
}
