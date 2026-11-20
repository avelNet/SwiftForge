import { Channel, invoke } from "@tauri-apps/api/core";
import { ArrowsClockwiseIcon, TerminalWindowIcon, XIcon } from "@phosphor-icons/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({ root, visible, hide }: { root: string; visible: boolean; hide: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null);
  const [started, setStarted] = useState(visible);
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (visible) setStarted(true); }, [visible]);

  useEffect(() => {
    if (!started || !container.current) return;
    const host = container.current;
    const terminal = new Terminal({
      fontFamily: '"Geist Mono", monospace', fontSize: 13, cursorBlink: true, screenReaderMode: true,
      scrollback: 2000, theme: { background: "#181818", foreground: "#e9e6e1", cursor: "#f1ab83" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    instance.current = { terminal, fit };
    let current = true;
    let connected = false;
    const output = new Channel<{ bytes: string | null }>();
    output.onmessage = event => {
      if (!current) return;
      if (event.bytes !== null) {
        terminal.write(Uint8Array.from(atob(event.bytes), value => value.charCodeAt(0)));
      } else {
        connected = false;
        terminal.writeln("\r\nShell exited. Use Restart terminal to open a new session.");
      }
    };
    let sends = Promise.resolve();
    const input = terminal.onData(text => {
      if (!connected) return;
      sends = sends.then(async () => {
        if (current && connected) await invoke("terminal_input", { text });
      }).catch(error => {
        if (current) terminal.writeln(`\r\n${String(error)}`);
      });
    });
    const observer = new ResizeObserver(() => {
      if (!host.offsetWidth || !host.offsetHeight) return;
      fit.fit();
      if (connected) void invoke("terminal_resize", { cols: terminal.cols, rows: terminal.rows }).catch(() => {});
    });
    observer.observe(host);
    void invoke("terminal_start", { root, cols: terminal.cols, rows: terminal.rows, output }).then(() => {
      if (current) connected = true;
    }).catch(error => {
      if (current) terminal.writeln(String(error));
    });
    return () => {
      current = false;
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      instance.current = null;
    };
  }, [root, started, revision]);

  useEffect(() => {
    if (!visible || !instance.current) return;
    const frame = window.requestAnimationFrame(() => {
      instance.current?.fit.fit();
      instance.current?.terminal.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible, started]);

  return <section className="output-pane terminal-pane" hidden={!visible} aria-label="Project terminal">
    <div className="output-toolbar">
      <h2><TerminalWindowIcon size={16} /> Terminal</h2>
      <div>
        <button className="icon-button" aria-label="Restart terminal" title="Restart terminal"
          onClick={() => setRevision(value => value + 1)}><ArrowsClockwiseIcon size={16} /></button>
        <button className="icon-button" onClick={hide} aria-label="Hide terminal" title="Hide terminal"><XIcon size={16} /></button>
      </div>
    </div>
    <div className="terminal-host" ref={container} />
  </section>;
}
