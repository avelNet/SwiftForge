import { useLocale } from "./i18n";
import { Channel, invoke } from "@tauri-apps/api/core";
import { ArrowClockwiseIcon, DownloadSimpleIcon, PlugsIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type Usb = { count: number; model: string | null; version: string | null };

const iPhoneModels = new Map([
  ["iPhone13,1", "iPhone 12 mini"],
  ["iPhone13,2", "iPhone 12"],
  ["iPhone13,3", "iPhone 12 Pro"],
  ["iPhone13,4", "iPhone 12 Pro Max"],
]);

export function DeviceTools({ artifact, saveIPA, showOutput, write }: {
  artifact: string | null;
  saveIPA: () => Promise<string | null | undefined>;
  showOutput: () => void;
  write: (line: string) => void;
}) {
  const t = useLocale();
  const [usb, setUsb] = useState<Usb | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(false);

  async function refresh() {
    try {
      setUsb(await invoke<Usb>("usb_status"));
      setMessage("");
    } catch (error) {
      setUsb(null);
      setMessage(String(error));
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function install() {
    setBusy(true);
    setMessage("");
    try {
      const path = await saveIPA();
      if (!path) return;
      await invoke("open_iloader");
      setMessage(t("In iLoader, import {file} and choose your iPhone.", { file: path.split("/").at(-1) ?? path }));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleLogs() {
    try {
      if (logging) {
        await invoke("device_logs_stop");
        setLogging(false);
        return;
      }
      if (!artifact) return;
      const process = artifact.split("/").at(-1)!.replace(/\.ipa$/i, "");
      const output = new Channel<string>();
      output.onmessage = line => {
        write(line);
        if (line === "Device log stream ended.") setLogging(false);
      };
      showOutput();
      await invoke("device_logs_start", { process, output });
      setLogging(true);
      write(`Device logs · ${process}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  return <section className="device-tools" aria-label={t("USB device tools")}>
    <div className="device-usb">
      <PlugsIcon size={16} aria-hidden />
      <span>{usb?.count === 1 ? [iPhoneModels.get(usb.model ?? "") ?? (usb.model || "iPhone"), usb.version && `iOS ${usb.version}`].filter(Boolean).join(" · ") :
        usb?.count ? t("{count} devices over USB", { count: usb.count }) : t("No iPhone over USB")}</span>
      <button className="icon-button" aria-label={t("Refresh USB devices")} title={t("Refresh USB devices")} onClick={() => void refresh()}><ArrowClockwiseIcon size={15} /></button>
    </div>
    {artifact && <div className="device-actions">
      <button className="action" disabled={busy} onClick={() => void install()}><DownloadSimpleIcon size={15} /> {t("Install via iLoader")}</button>
      <button className="action" disabled={!logging && usb?.count !== 1} onClick={() => void toggleLogs()}>
        <TerminalWindowIcon size={15} /> {logging ? t("Stop logs") : t("Logs")}
      </button>
    </div>}
    {message && <p className="iphone-status" role="status">{message}</p>}
  </section>;
}
