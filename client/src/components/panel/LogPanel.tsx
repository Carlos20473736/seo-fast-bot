import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Terminal, Info, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { LogEntry } from "@/pages/Panel";

interface Props {
  logs: LogEntry[];
}

function getLogStyles(type: LogEntry["type"]) {
  switch (type) {
    case "info":
      return { color: "text-[oklch(0.75_0.1_250)]", icon: Info };
    case "success":
      return { color: "text-emerald-400", icon: CheckCircle };
    case "warn":
      return { color: "text-amber-400", icon: AlertTriangle };
    case "error":
      return { color: "text-red-400", icon: XCircle };
  }
}

export default function LogPanel({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-[oklch(0.1_0.006_260)]">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-[oklch(0.2_0.01_260)] bg-[oklch(0.13_0.008_260)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[oklch(0.6_0.2_25)]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[oklch(0.7_0.17_80)]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[oklch(0.65_0.17_155)]" />
          </div>
          <div className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-[oklch(0.5_0.01_260)]" />
            <span className="text-[11px] font-medium text-[oklch(0.55_0.01_260)]">
              output
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono text-[oklch(0.4_0.01_260)]">
          {logs.length} ln
        </span>
      </div>

      {/* Terminal body */}
      <ScrollArea className="h-[340px]">
        <div className="px-4 py-3">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[280px] text-[oklch(0.4_0.01_260)]">
              <Terminal className="w-6 h-6 mb-3 opacity-40" />
              <p className="text-xs font-medium">Aguardando execução...</p>
              <p className="text-[10px] mt-1 opacity-60">
                Os logs aparecerão aqui em tempo real
              </p>
            </div>
          ) : (
            <div className="space-y-px font-mono text-[11px] leading-relaxed">
              {logs.map((log, index) => {
                const styles = getLogStyles(log.type);
                const Icon = styles.icon;
                return (
                  <div
                    key={index}
                    className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-[oklch(0.15_0.01_260)] transition-colors"
                  >
                    <Icon className={`w-3 h-3 mt-[2px] shrink-0 ${styles.color} opacity-70`} />
                    <span className="text-[oklch(0.45_0.01_260)] shrink-0 select-none">
                      {log.timestamp}
                    </span>
                    <span className={`${styles.color} break-all`}>{log.msg}</span>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
