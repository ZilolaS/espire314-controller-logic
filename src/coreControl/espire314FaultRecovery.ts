// src/coreControl/espire314FaultRecovery.ts
//
// Fault classification + recovery sequencer for the eSpire 314 (ESMU battery
// stack controller). Built from the real register semantics in
// docs/eSpire314_ESMU_Modbus_Register_Map.md — NOT a copy of Mini's PCS
// state machine. Key difference from keystone-controller-logic's
// miniFaultRecovery.ts: ESMU already tracks its own fault lifecycle in the
// System State input register (43): Fault (0x08) -> Fault recovery (0x09) ->
// back to a normal state once cleared. So the controller's job is mostly to
// detect the Fault state, pulse the fault-reset holding register (501), wait
// for the device to settle, and check again — not to choreograph a
// multi-step clear/start sequence the way a PCS requires.
//
// Confidence: System State (43), BMS fault summary (DI 57), contactor
// abnormal open/close (DI 52/53), and control registers 501/502 are all
// HIGH confidence per the register map doc. PCS/EMS comm-fault registers
// (IR 46/47) are also HIGH confidence but are treated as non-recoverable
// here since a register write can't fix a communication link.

import type { ControlEnvelope } from "../writer/writer";

export interface Espire314FaultTelemetry {
  /** Input register 43 — BMS/System State enum, 0-12. */
  systemState?: number;
  /** Discrete input 57 — BMS system fault summary. */
  bmsFaultSummary?: unknown;
  /** Discrete input 56 — BMS system alarm summary (informational, less severe than fault). */
  bmsAlarmSummary?: unknown;
  /** Discrete input 52 — abnormal disconnection of contactor. */
  contactorOpenFault?: unknown;
  /** Discrete input 53 — abnormal closing of contactor. */
  contactorCloseFault?: unknown;
  /** Discrete input 54 — charging prohibited. */
  chargeProhibited?: unknown;
  /** Discrete input 55 — discharging prohibited. */
  dischargeProhibited?: unknown;
  /** Input register 46 — PCS<->BMS communication failure. Not auto-recoverable. */
  pcsBmsCommFault?: unknown;
  /** Input register 47 — EMS<->BMS communication failure. Not auto-recoverable. */
  emsBmsCommFault?: unknown;
  criticalTelemetryMissing?: boolean;
}

export interface Espire314FaultClassification {
  faulted: boolean;
  recoverable: boolean;
  bmsFault: boolean;
  contactorFault: boolean;
  commFault: boolean;
  chargeDischargeProhibited: boolean;
  criticalTelemetryMissing: boolean;
  reasons: string[];
}

export type Espire314FaultRecoveryMode =
  | "normal"
  | "fault-detected"
  | "reset-sent"
  | "verify-recovered"
  | "lockout";

export interface Espire314FaultRecoveryState {
  mode: Espire314FaultRecoveryMode;
  attempts: number;
  waitUntilMs?: number;
  lastSendMs?: number;
}

export type Espire314FaultRecoveryCommand =
  | { kind: "fault-reset" }
  | { kind: "open-breaker" };

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
  topic?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 2_000;
const DEFAULT_SETTLE_MS = 5_000;

/** System State (input register 43) value for "Fault" — see register map doc §6.3. */
const SYSTEM_STATE_FAULT = 8;
/** System State value for "Fault recovery" (device is clearing the fault itself). */
const SYSTEM_STATE_FAULT_RECOVERY = 9;

export function classifyEspire314Faults(
  telemetry: Espire314FaultTelemetry
): Espire314FaultClassification {
  const bmsFault =
    isActive(telemetry.bmsFaultSummary) ||
    telemetry.systemState === SYSTEM_STATE_FAULT;
  const contactorFault =
    isActive(telemetry.contactorOpenFault) || isActive(telemetry.contactorCloseFault);
  const commFault =
    isActive(telemetry.pcsBmsCommFault) || isActive(telemetry.emsBmsCommFault);
  const chargeDischargeProhibited =
    isActive(telemetry.chargeProhibited) || isActive(telemetry.dischargeProhibited);
  const criticalTelemetryMissing = telemetry.criticalTelemetryMissing === true;

  const reasons: string[] = [];
  if (bmsFault) reasons.push("espire314-bms-fault");
  if (contactorFault) reasons.push("espire314-contactor-fault");
  if (commFault) reasons.push("espire314-comm-fault");
  if (chargeDischargeProhibited) reasons.push("espire314-charge-discharge-prohibited");
  if (criticalTelemetryMissing) reasons.push("espire314-critical-telemetry-missing");

  const faulted = reasons.length > 0;
  // Comm faults aren't fixable by a register write (external link issue), and
  // missing telemetry means we can't safely judge state — never auto-recover those.
  const recoverable = faulted && !commFault && !criticalTelemetryMissing;

  return {
    faulted,
    recoverable,
    bmsFault,
    contactorFault,
    commFault,
    chargeDischargeProhibited,
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

  // The device itself may still be mid-recovery (System State 0x09) even
  // though the fault bits haven't cleared yet — don't fight it, just wait.
  if (telemetry.systemState === SYSTEM_STATE_FAULT_RECOVERY && state.mode !== "normal") {
    reasons.push("espire314-device-self-recovering");
    return { state, commands, classification, reasons };
  }

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
    commands.push({ kind: "open-breaker" });
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
      if (readyToRetry(state, nowMs, retryMs)) {
        commands.push({ kind: "fault-reset" });
        state.attempts += 1;
        state.lastSendMs = nowMs;
        state.mode = "reset-sent";
        reasons.push("espire314-recovery-fault-reset");
      }
      break;

    case "reset-sent":
      state.mode = "verify-recovered";
      state.waitUntilMs = nowMs + settleMs;
      reasons.push("espire314-recovery-verify-wait");
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
      commands.push({ kind: "open-breaker" });
      reasons.push("espire314-recovery-lockout");
      break;
  }

  return { state, commands, classification, reasons };
}

export function espire314FaultRecoveryCommandsToWriterEnvelopes(
  commands: Espire314FaultRecoveryCommand[],
  options: Espire314FaultRecoveryWriterOptions = {}
): ControlEnvelope[] {
  const payload: ControlEnvelope["payload"] = [];

  for (const command of commands) {
    switch (command.kind) {
      case "fault-reset":
        // Holding register 501 — see docs/eSpire314_ESMU_Modbus_Register_Map.md §5.
        payload.push({ tagID: "SystemFaultReset", value: 1 });
        break;
      case "open-breaker":
        // Holding register 502, value 2 = open — see §5.
        payload.push({ tagID: "MainCircuitBreakerControl", value: 2 });
        break;
    }
  }

  const envelopes: ControlEnvelope[] = [];
  if (payload.length > 0) {
    envelopes.push({ topic: options.topic ?? "ESMU", payload });
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
