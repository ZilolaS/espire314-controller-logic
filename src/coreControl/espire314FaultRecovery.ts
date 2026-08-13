// src/coreControl/espire314FaultRecovery.ts
//
// SCAFFOLD — the state machine shape (safe-zero -> clear-fault -> start ->
// verify -> lockout) is carried over from keystone-controller-logic's
// src/coreControl/miniFaultRecovery.ts, which is the closest existing
// pattern for a PCS fault/auto-recovery sequencer in this codebase.
//
// What is NOT carried over on purpose: Mini-specific topology (PVDC combiner
// clear/start steps, BMS-HV/LV split faults) and Mini-specific tagIDs
// ("TotalStart", "PVDCClearFault", ...). eSpire 314's actual fault sources,
// write-point tagIDs, and whether it even has a PV-DC stage are unknown
// until the eSpire 314 Modbus register map is reviewed. Every place that
// assumes something Mini-specific is marked TODO below — fill in from the
// register map, then delete this comment block.

import type { ControlEnvelope } from "../writer/writer";

export interface Espire314FaultTelemetry {
  pcsFault?: unknown;
  gridFault?: unknown;
  backupFault?: unknown;
  bmsFault?: unknown;
  fireAlarm?: unknown;
  criticalTelemetryMissing?: boolean;
  // TODO: add/rename fault channels once the register map's fault/status
  // words (and their bit meanings) are known — see keystone-controller-logic's
  // ss50k_minispecific.yaml-equivalent for the pattern (one bitfield word per
  // ss40k point, decoded meaning-by-bit).
}

export interface Espire314FaultClassification {
  faulted: boolean;
  recoverable: boolean;
  pcsFault: boolean;
  bmsFault: boolean;
  gridFault: boolean;
  backupFault: boolean;
  fireAlarm: boolean;
  criticalTelemetryMissing: boolean;
  reasons: string[];
}

export type Espire314FaultRecoveryMode =
  | "normal"
  | "fault-detected"
  | "safe-zero"
  | "clear-pcs-fault"
  | "start-pcs"
  | "verify-recovered"
  | "lockout";

export interface Espire314FaultRecoveryState {
  mode: Espire314FaultRecoveryMode;
  attempts: number;
  waitUntilMs?: number;
  lastSendMs?: number;
}

export type Espire314FaultRecoveryCommand =
  | { kind: "safe-zero" }
  | { kind: "pcs-clear-fault" }
  | { kind: "pcs-start" };

export interface Espire314FaultRecoveryOptions {
  maxAttempts?: number;
  retryMs?: number;
  settleMs?: number;
}

export interface Espire314FaultRecoveryResult {
  state: Espire314FaultRecoveryState;
  commands: Espire314FaultRecoveryCommand[];
  classification: Espire314FaultClassification;
  reasons: string[];
}

export interface Espire314FaultRecoveryWriterOptions {
  pcsTopic?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 2_000;
const DEFAULT_SETTLE_MS = 5_000;

export function classifyEspire314Faults(
  telemetry: Espire314FaultTelemetry
): Espire314FaultClassification {
  const pcsFault = isActive(telemetry.pcsFault);
  const gridFault = isActive(telemetry.gridFault);
  const backupFault = isActive(telemetry.backupFault);
  const bmsFault = isActive(telemetry.bmsFault);
  const fireAlarm = isActive(telemetry.fireAlarm);
  const criticalTelemetryMissing = telemetry.criticalTelemetryMissing === true;
  const reasons: string[] = [];

  if (pcsFault) reasons.push("espire314-pcs-fault");
  if (gridFault) reasons.push("espire314-grid-fault");
  if (backupFault) reasons.push("espire314-backup-fault");
  if (bmsFault) reasons.push("espire314-bms-fault");
  if (fireAlarm) reasons.push("espire314-fire-alarm");
  if (criticalTelemetryMissing) reasons.push("espire314-critical-telemetry-missing");

  const faulted = reasons.length > 0;
  // TODO: confirm which fault classes are safe to auto-recover for eSpire 314.
  // Mirroring Mini's policy for now: fire alarm, missing telemetry, and BMS
  // faults are never auto-recovered.
  const recoverable =
    faulted && !fireAlarm && !criticalTelemetryMissing && !bmsFault;

  return {
    faulted,
    recoverable,
    pcsFault,
    bmsFault,
    gridFault,
    backupFault,
    fireAlarm,
    criticalTelemetryMissing,
    reasons,
  };
}

export function evaluateEspire314FaultRecovery(
  telemetry: Espire314FaultTelemetry,
  previousState: Espire314FaultRecoveryState = { mode: "normal", attempts: 0 },
  options: Espire314FaultRecoveryOptions = {}
): Espire314FaultRecoveryResult {
  const nowMs = Date.now();
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const classification = classifyEspire314Faults(telemetry);
  const commands: Espire314FaultRecoveryCommand[] = [];
  const reasons: string[] = [...classification.reasons];
  const state: Espire314FaultRecoveryState = {
    ...previousState,
    mode: previousState.mode || "normal",
    attempts: previousState.attempts || 0,
  };

  if (!classification.faulted) {
    if (state.mode !== "normal") reasons.push("espire314-fault-recovered");
    return {
      state: { mode: "normal", attempts: 0 },
      commands,
      classification,
      reasons: reasons.length ? reasons : ["espire314-fault-normal"],
    };
  }

  if (!classification.recoverable || state.attempts >= maxAttempts) {
    commands.push({ kind: "safe-zero" });
    return {
      state: { ...state, mode: "lockout" },
      commands,
      classification,
      reasons: [
        ...reasons,
        classification.recoverable
          ? "espire314-recovery-attempts-exhausted"
          : "espire314-fault-not-auto-recoverable",
      ],
    };
  }

  switch (state.mode) {
    case "normal":
    case "fault-detected":
      state.mode = "safe-zero";
      state.attempts += 1;
      commands.push({ kind: "safe-zero" });
      reasons.push("espire314-recovery-safe-zero");
      break;

    case "safe-zero":
      state.mode = "clear-pcs-fault";
      state.lastSendMs = undefined;
      reasons.push("espire314-recovery-clear-next");
      break;

    case "clear-pcs-fault":
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pcs-clear-fault" });
        state.lastSendMs = nowMs;
        state.mode = "start-pcs";
        reasons.push("espire314-recovery-pcs-clear");
      }
      break;

    case "start-pcs":
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "pcs-start" });
        state.lastSendMs = nowMs;
        state.mode = "verify-recovered";
        state.waitUntilMs = nowMs + settleMs;
        reasons.push("espire314-recovery-pcs-start");
      }
      break;

    case "verify-recovered":
      if (state.waitUntilMs == null || nowMs >= state.waitUntilMs) {
        state.mode = "fault-detected";
        reasons.push("espire314-recovery-verify-still-faulted");
      } else {
        reasons.push("espire314-recovery-verify-wait");
      }
      break;

    case "lockout":
      commands.push({ kind: "safe-zero" });
      reasons.push("espire314-recovery-lockout");
      break;
  }

  return { state, commands, classification, reasons };
}

export function espire314FaultRecoveryCommandsToWriterEnvelopes(
  commands: Espire314FaultRecoveryCommand[],
  options: Espire314FaultRecoveryWriterOptions = {}
): ControlEnvelope[] {
  const pcsPayload: ControlEnvelope["payload"] = [];

  for (const command of commands) {
    switch (command.kind) {
      case "safe-zero":
        // TODO: confirm real tagIDs from the eSpire 314 register map.
        pcsPayload.push(
          { tagID: "ActivePowerSetpoint", value: 0 },
          { tagID: "MaxChgCurrent", value: 0 },
          { tagID: "MaxDsgCurrent", value: 0 }
        );
        break;
      case "pcs-clear-fault":
        // TODO: confirm real clear-fault coil/register tagID.
        pcsPayload.push({ tagID: "ClearFault", value: 1 });
        break;
      case "pcs-start":
        // TODO: confirm real start coil/register tagID.
        pcsPayload.push({ tagID: "TotalStart", value: 1 });
        break;
    }
  }

  const envelopes: ControlEnvelope[] = [];
  if (pcsPayload.length > 0) {
    envelopes.push({ topic: options.pcsTopic ?? "PCS", payload: pcsPayload });
  }
  return envelopes;
}

function readyToRetry(
  state: Espire314FaultRecoveryState,
  nowMs: number,
  retryMs: number
): boolean {
  return state.lastSendMs == null || nowMs - state.lastSendMs >= retryMs;
}

function isActive(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (value === true) return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric !== 0 : Boolean(value);
}
