import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';

function getTerminalFontSize(width: number): number {
  if (width < 480) return 13;
  return 14;
}

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
      fontSize: getTerminalFontSize(terminalRef.current.clientWidth),
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

    let resizeRaf: number;
    const handleResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!terminalRef.current) return;
        const width = terminalRef.current.clientWidth;
        const nextFontSize = getTerminalFontSize(width);
        if (term.options.fontSize !== nextFontSize) {
          term.options.fontSize = nextFontSize;
        }
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          socket.emit('terminal:resize', { cols: dims.cols, rows: dims.rows });
        }
      });
    };

    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    return () => {
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="mx-auto h-[calc(100dvh-8rem)] max-w-screen-2xl p-3 sm:h-[calc(100dvh-7.5rem)] sm:p-4 md:h-[calc(100dvh-6rem)]">
      <div className="z-0 flex h-full w-full flex-col rounded-xl border border-black/5 bg-surface shadow-sm dark:border-white/10 dark:bg-surface-dark dark:shadow-none">
        <div className="flex flex-col gap-y-2 border-b border-black/5 p-3 dark:border-white/10 sm:p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink dark:text-white sm:text-lg">Terminal</h2>
            <div className="flex flex-row gap-x-2">
              <div className="h-2 w-2 rounded-full bg-red-500" />
              <div className="h-2 w-2 rounded-full bg-yellow-500" />
              <div className="h-2 w-2 rounded-full bg-green-500" />
            </div>
          </div>
          <span className="text-xs text-muted dark:text-gray-400">xterm.js / node-pty</span>
        </div>
        <div className="min-h-0 flex-1 p-3 sm:p-4">
          <div ref={terminalRef} className="h-full w-full overflow-hidden rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
