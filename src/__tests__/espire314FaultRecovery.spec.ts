import {
  classifyEspire314Faults,
  evaluateEspire314FaultRecovery,
  espire314FaultRecoveryCommandsToWriterEnvelopes,
  type Espire314FaultRecoveryState,
} from "../coreControl";

describe("eSpire 314 (ESMU) fault recovery", () => {
  test("classifies BMS fault and contactor fault independently", () => {
    const result = classifyEspire314Faults({
      systemState: 8, // Fault
      contactorOpenFault: 1,
    });

    expect(result).toEqual(
      expect.objectContaining({
        faulted: true,
        recoverable: true,
        bmsFault: true,
        contactorFault: true,
      })
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(["espire314-bms-fault", "espire314-contactor-fault"])
    );
  });

  test("comm faults are never auto-recoverable", () => {
    const result = classifyEspire314Faults({ pcsBmsCommFault: 1 });
    expect(result).toEqual(
      expect.objectContaining({ faulted: true, recoverable: false, commFault: true })
    );
  });

  test("runs a recoverable fault through reset -> verify -> normal", () => {
    let state: Espire314FaultRecoveryState = { mode: "normal", attempts: 0 };

    let result = evaluateEspire314FaultRecovery({ systemState: 8 }, state, { retryMs: 0 });
    state = result.state;
    expect(state).toEqual(expect.objectContaining({ mode: "reset-sent", attempts: 1 }));
    expect(result.commands).toEqual([{ kind: "fault-reset" }]);

    result = evaluateEspire314FaultRecovery({ systemState: 8 }, state, { retryMs: 0 });
    state = result.state;
    expect(state.mode).toBe("verify-recovered");
    expect(result.commands).toEqual([]);

    // Device reports it's clearing the fault itself — controller should just wait.
    result = evaluateEspire314FaultRecovery({ systemState: 9 }, state, { retryMs: 0 });
    expect(result.commands).toEqual([]);
    expect(result.reasons).toContain("espire314-device-self-recovering");

    // Fault clears entirely.
    result = evaluateEspire314FaultRecovery({}, state, { retryMs: 0 });
    expect(result.state).toEqual({ mode: "normal", attempts: 0 });
    expect(result.reasons).toContain("espire314-fault-recovered");
  });

  test("locks out and opens the breaker after max attempts", () => {
    const state: Espire314FaultRecoveryState = { mode: "fault-detected", attempts: 3 };
    const result = evaluateEspire314FaultRecovery({ systemState: 8 }, state, { retryMs: 0 });

    expect(result.state.mode).toBe("lockout");
    expect(result.commands).toEqual([{ kind: "open-breaker" }]);
  });

  test("locks out immediately on a non-recoverable comm fault", () => {
    const result = evaluateEspire314FaultRecovery(
      { emsBmsCommFault: 1 },
      { mode: "normal", attempts: 0 },
      { retryMs: 0 }
    );

    expect(result.state.mode).toBe("lockout");
    expect(result.commands).toEqual([{ kind: "open-breaker" }]);
    expect(result.reasons).toContain("espire314-fault-not-auto-recoverable");
  });

  test("maps commands to an ESMU control envelope using the real holding registers", () => {
    const envelopes = espire314FaultRecoveryCommandsToWriterEnvelopes([
      { kind: "fault-reset" },
      { kind: "open-breaker" },
    ]);

    expect(envelopes).toEqual([
      {
        topic: "ESMU",
        payload: [
          { tagID: "SystemFaultReset", value: 1 },
          { tagID: "MainCircuitBreakerControl", value: 2 },
        ],
      },
    ]);
  });
});
