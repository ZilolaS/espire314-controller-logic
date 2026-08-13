import {
  classifyEspire314Faults,
  evaluateEspire314FaultRecovery,
  espire314FaultRecoveryCommandsToWriterEnvelopes,
  type Espire314FaultRecoveryState,
} from "../coreControl";

describe("eSpire 314 fault recovery (scaffold)", () => {
  test("classifies PCS and BMS faults independently", () => {
    const result = classifyEspire314Faults({ pcsFault: 1, bmsFault: 1 });

    expect(result).toEqual(
      expect.objectContaining({
        faulted: true,
        recoverable: false, // bmsFault blocks auto-recovery
        pcsFault: true,
        bmsFault: true,
      })
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(["espire314-pcs-fault", "espire314-bms-fault"])
    );
  });

  test("runs a recoverable PCS fault through safe-zero, clear, start, verify", () => {
    let state: Espire314FaultRecoveryState = { mode: "normal", attempts: 0 };

    let result = evaluateEspire314FaultRecovery({ pcsFault: 1 }, state, { retryMs: 0 });
    state = result.state;
    expect(state).toEqual(expect.objectContaining({ mode: "safe-zero", attempts: 1 }));
    expect(result.commands).toEqual([{ kind: "safe-zero" }]);

    result = evaluateEspire314FaultRecovery({ pcsFault: 1 }, state, { retryMs: 0 });
    state = result.state;
    expect(state.mode).toBe("clear-pcs-fault");

    result = evaluateEspire314FaultRecovery({ pcsFault: 1 }, state, { retryMs: 0 });
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-clear-fault" }]);
    expect(state.mode).toBe("start-pcs");

    result = evaluateEspire314FaultRecovery({ pcsFault: 1 }, state, { retryMs: 0 });
    state = result.state;
    expect(result.commands).toEqual([{ kind: "pcs-start" }]);
    expect(state.mode).toBe("verify-recovered");
  });

  test("locks out and forces safe-zero after max attempts", () => {
    let state: Espire314FaultRecoveryState = { mode: "lockout", attempts: 3 };
    const result = evaluateEspire314FaultRecovery({ pcsFault: 1 }, state, { retryMs: 0 });

    expect(result.state.mode).toBe("lockout");
    expect(result.commands).toEqual([{ kind: "safe-zero" }]);
  });

  test("clears back to normal once telemetry reports no faults", () => {
    const state: Espire314FaultRecoveryState = { mode: "clear-pcs-fault", attempts: 1 };
    const result = evaluateEspire314FaultRecovery({}, state, { retryMs: 0 });

    expect(result.state).toEqual({ mode: "normal", attempts: 0 });
    expect(result.reasons).toContain("espire314-fault-recovered");
  });

  test("maps commands to a PCS control envelope", () => {
    const envelopes = espire314FaultRecoveryCommandsToWriterEnvelopes([
      { kind: "safe-zero" },
      { kind: "pcs-clear-fault" },
    ]);

    expect(envelopes).toEqual([
      {
        topic: "PCS",
        payload: [
          { tagID: "ActivePowerSetpoint", value: 0 },
          { tagID: "MaxChgCurrent", value: 0 },
          { tagID: "MaxDsgCurrent", value: 0 },
          { tagID: "ClearFault", value: 1 },
        ],
      },
    ]);
  });
});
