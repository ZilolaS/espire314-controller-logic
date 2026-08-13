# espire314-controller-logic

Typed helper library for the eSpire 314 controller (Keystone EMS / Node-RED).
Structure mirrors [`keystone-controller-logic`](../keystone-controller-logic), which is
the reference implementation for how a device family (Mini, Nano, Envy, Delta, ...)
gets its Modbus points, fault classification, auto-recovery sequencer, and telemetry
reporting wired up in this ecosystem.

## What eSpire 314 actually is

The register map provided (`高特ESMU_MODBUS通信协议..._V2.1_EN.pdf`) documents a Modbus
**TCP** protocol for an **ESMU** (battery stack management unit — i.e. a **BMS**
controller, not a PCS/inverter), from a Chinese OEM, talking to per-string **ESBCM**
units. That identification is carried through this repo (file/type names use `ESMU`)
on the assumption it's what "eSpire 314" refers to — flag it if that's wrong, since the
PDF itself never uses the name "eSpire" or "314".

**Full register map, with confidence levels per section, is in
[`docs/eSpire314_ESMU_Modbus_Register_Map.md`](docs/eSpire314_ESMU_Modbus_Register_Map.md).**
The source PDF is a bilingual, table-heavy document that doesn't extract perfectly —
some sections are clean and directly usable, others have a known row-alignment risk
and are marked accordingly. **Read the confidence notes before wiring anything
flagged below MEDIUM into a live write**, especially anything touching the main
contactor.

| File | Content | Confidence |
|---|---|---|
| [`src/templates/eSpire314_ESMU_Control_HR.json`](src/templates/eSpire314_ESMU_Control_HR.json) | Holding registers: string selector (500), fault reset (501), **main breaker/contactor control (502)**, string maintenance mode (524) | HIGH for 500/501/502; LOW for 503, 524, RTC block (528-530) — explicitly flagged `TODO` in the file |
| [`src/templates/eSpire314_ESMU_SystemAlarms_DI.json`](src/templates/eSpire314_ESMU_SystemAlarms_DI.json) | 80 system-level alarm bits (function 02H, addr 1-80): voltage/current/temp/SOC/SOH triads, contactor faults, BMS alarm/fault summary, comm-loss bits | MEDIUM |
| [`src/templates/eSpire314_ESMU_SystemTelemetry_IR.json`](src/templates/eSpire314_ESMU_SystemTelemetry_IR.json) | System telemetry (function 04H, addr 1-51): voltage/current/SOC/SOH, the **System State enum** (addr 43), PCS↔BMS / EMS↔BMS comm-fault bits | HIGH for System State (43) and comm faults (46/47); MEDIUM/LOW elsewhere |
| [`src/coreControl/espire314FaultRecovery.ts`](src/coreControl/espire314FaultRecovery.ts) | Fault classification + recovery sequencer, built around the real System State enum (Fault `0x08` → Fault recovery `0x09`) and the real fault-reset (501) / breaker (502) registers | — |
| [`src/telemetry/espire314ReportingModels.ts`](src/telemetry/espire314ReportingModels.ts) | Info/monitoring/fault/config model-ID buckets, mirroring `reportingStrategy.ts`'s `FAULT_MODELS` pattern (e.g. Mini's `"50103"`) | Still `TODO` — this is an internal Keystone EMS naming decision, not something in the vendor PDF |

Per-string alarms (§4.2 of the doc) and the large per-string/per-cell telemetry block
(§6.4 — up to 700 cells × 20 strings) are documented as **address formulas** rather
than enumerated as individual points, since literally enumerating them would mean
thousands of near-duplicate JSON entries. Expand them programmatically once needed.

## Fault recovery design note

Unlike Mini's PCS (which needs a controller-driven clear→start choreography), the ESMU
device tracks its own fault lifecycle in the System State register: `Fault (0x08)` →
`Fault recovery (0x09)` → back to normal once actually cleared. So
`espire314FaultRecovery.ts` is deliberately simpler than `miniFaultRecovery.ts`: detect
the fault, pulse the fault-reset holding register (501), wait for the device to settle,
check again, and open the main breaker (502) after too many failed attempts or on a
non-recoverable class of fault (currently: PCS↔BMS / EMS↔BMS comm loss, since a
register write can't fix a communication link).

## Next steps
1. Spot-check the HIGH-confidence registers (500, 501, 502, 43, 46, 47) against the
   source PDF pages cited in the doc before any live write — the extraction was clean
   for these, but a five-minute manual check on a breaker-control register is cheap
   insurance.
2. Resolve the LOW-confidence holding-register block (503, 525-527, the RTC/heartbeat
   registers 528-530) by reading PDF pages A336-A337 directly.
3. Decide and fill in eSpire 314's ss-model numbers in `espire314ReportingModels.ts`.
4. Expand the per-string (§4.2) and per-cell (§6.4) formulas into concrete point
   templates once a specific project needs that resolution.
5. If eSpire 314 needs to plug into cmsandbox's ingestion side
   (`equipment_points_matcher`, `ss50k_minispecific.yaml`-style bit meanings, portal
   fault charts), that's a separate change in the `cmsandbox` repo — see how Mini's
   model `50103` is wired there for the pattern to follow.

## Dev
```
npm install
npm test
npm run build
```
