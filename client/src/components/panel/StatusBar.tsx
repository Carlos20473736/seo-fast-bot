import {
  Shield,
  UserCheck,
  Mail,
  Loader2,
  Check,
  X,
  Minus,
  Globe,
  Link as LinkIcon,
  Wallet,
} from "lucide-react";
import type { StatusState, StepStatus } from "@/pages/Panel";

interface Props {
  status: StatusState;
}

type StepDef = { key: keyof StatusState; label: string; icon: typeof Shield };

const STEPS: StepDef[] = [
  { key: "captcha", label: "Captcha", icon: Shield },
  { key: "register", label: "Registro", icon: UserCheck },
  { key: "activate", label: "Ativação", icon: Mail },
  { key: "seofast_register", label: "SEO Registro", icon: Globe },
  { key: "seofast_verify", label: "Verificação", icon: LinkIcon },
  { key: "seofast_wallet", label: "Carteira", icon: Wallet },
];

function getStatusConfig(status: StepStatus) {
  switch (status) {
    case "idle":
      return {
        dotColor: "bg-[oklch(0.4_0.01_260)]",
        textColor: "text-[oklch(0.5_0.01_260)]",
        barColor: "bg-[oklch(0.25_0.01_260)]",
        icon: Minus,
        label: "Pendente",
      };
    case "running":
      return {
        dotColor: "bg-[oklch(0.7_0.18_250)]",
        textColor: "text-[oklch(0.7_0.18_250)]",
        barColor: "bg-[oklch(0.7_0.18_250)]",
        icon: Loader2,
        label: "Executando",
        pulse: true,
      };
    case "done":
      return {
        dotColor: "bg-emerald-500",
        textColor: "text-emerald-400",
        barColor: "bg-emerald-500",
        icon: Check,
        label: "Concluído",
      };
    case "failed":
      return {
        dotColor: "bg-red-500",
        textColor: "text-red-400",
        barColor: "bg-red-500",
        icon: X,
        label: "Falhou",
      };
  }
}

export default function StatusBar({ status }: Props) {
  // Calcular progresso
  const total = STEPS.length;
  const done = STEPS.filter((s) => status[s.key] === "done").length;
  const failed = STEPS.filter((s) => status[s.key] === "failed").length;
  const running = STEPS.filter((s) => status[s.key] === "running").length;
  const progressPercent = Math.round(((done) / total) * 100);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header com progresso */}
      <div className="px-5 py-4 border-b border-border/60">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">Pipeline</h3>
          <div className="flex items-center gap-2">
            {running > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[oklch(0.7_0.18_250)]">
                <Loader2 className="w-3 h-3 animate-spin" />
                Em progresso
              </span>
            )}
            {failed > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-red-400">
                <X className="w-3 h-3" />
                {failed} falha{failed > 1 ? "s" : ""}
              </span>
            )}
            <span className="text-[11px] font-mono text-muted-foreground">
              {done}/{total}
            </span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1 rounded-full bg-[oklch(0.2_0.01_260)] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[oklch(0.6_0.18_250)] to-[oklch(0.7_0.18_250)] transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="px-5 py-3 space-y-0">
        {STEPS.map((step, i) => {
          const currentStatus = status[step.key];
          const config = getStatusConfig(currentStatus);
          const StepIcon = step.icon;
          const StatusIcon = config.icon;
          const isLast = i === STEPS.length - 1;

          return (
            <div key={step.key} className="flex items-stretch gap-3">
              {/* Timeline */}
              <div className="flex flex-col items-center w-5">
                <div
                  className={`w-2.5 h-2.5 rounded-full mt-3 shrink-0 transition-all duration-300 ${config.dotColor} ${
                    (config as any).pulse ? "animate-pulse ring-2 ring-[oklch(0.7_0.18_250)]/30" : ""
                  }`}
                />
                {!isLast && (
                  <div className="w-px flex-1 my-1 bg-[oklch(0.25_0.01_260)]" />
                )}
              </div>

              {/* Content */}
              <div className={`flex-1 flex items-center justify-between py-2.5 ${!isLast ? "border-b border-border/30" : ""}`}>
                <div className="flex items-center gap-2.5">
                  <StepIcon className={`w-4 h-4 ${config.textColor}`} />
                  <span className="text-sm text-foreground font-medium">{step.label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusIcon
                    className={`w-3.5 h-3.5 ${config.textColor} ${
                      currentStatus === "running" ? "animate-spin" : ""
                    }`}
                  />
                  <span className={`text-[11px] font-medium ${config.textColor}`}>
                    {config.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
