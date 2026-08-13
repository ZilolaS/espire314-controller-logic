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

## Template format — matches `keystone-controller-logic`'s real schema

[`src/templates/eSpire314_ESMU_ss_TEMPLATE.json`](src/templates/eSpire314_ESMU_ss_TEMPLATE.json)
is **one** file (`{version, device, telemetry[], commands[]}`), following the exact
shape `keystone-controller-logic`'s `src/telemetry/templateAdapter.ts` requires
(`TelemetryTemplateDocument`/`TelemetryTemplateEntry`) — not the ad hoc `{points:[...]}`
shape this repo started with. [`src/__tests__/templateConformance.spec.ts`](src/__tests__/templateConformance.spec.ts)
ports that adapter's actual validation rules (`id` required, one of
`constant`/`calc`/`function+address`/virtual-placeholder per entry, no duplicate ids)
so template drift gets caught by `npm test`, not discovered at compile time in the
other repo.

Per convention (see `AMPACE_Mini_BCU_42k.json`'s `device.notes`), address-offset
formulas for repeated blocks (per-string, per-cell) are documented as prose in
`device.notes` and in the register-map doc, rather than enumerated as thousands of
near-identical JSON points.

### A real gap this comparison found: no discrete-input (02H) support

ESMU's 80 system alarm bits (§4.1) are true Modbus **discrete-input register reads**
(function `02H`) — a genuinely different wire operation from the holding/input
registers (`03H`/`04H`) every other product template in `keystone-controller-logic`
uses for its alarms (they pack alarm bits into `HR`/`IR` words instead, via
`bitfieldStatus`). Checking `keystone-controller-logic/src/types.ts`:

```ts
export type ModbusNumericType =
  | 'HR' | 'HRUS' | 'HRI' | 'HRUI' | 'HRI_64' | 'HRUI_64' | 'HRF'
  | 'IR' | 'IRUS' | 'IRI' | 'IRUI' | 'IRI_64' | 'IRUI_64' | 'IRF'
  | 'C';
```

**there is no discrete-input member**, and `reader.ts` has no `02H` request path. The
80 `SystemAlarm_*` entries in the template use `"function": "DI"` as an intent marker
(each has a `notes` field saying so explicitly) — they'll pass this repo's structural
validation but **won't actually be pollable** until `keystone-controller-logic` gets a
`DI` (or similarly-named) `ModbusNumericType` added and wired through `reader.ts`. That
core-library change is a prerequisite for eSpire 314's alarm map specifically — no
other current product needed it.

| File | Content | Confidence |
|---|---|---|
| [`src/templates/eSpire314_ESMU_ss_TEMPLATE.json`](src/templates/eSpire314_ESMU_ss_TEMPLATE.json) | Full device template: 51 system telemetry points (incl. System State enum), 80 system alarm bits, 6 control commands (string select, fault reset, breaker control, +3 flagged `TODO`) | Per-point `confidence` field; HIGH for registers 500/501/502/43/46/47 |
| [`src/coreControl/espire314FaultRecovery.ts`](src/coreControl/espire314FaultRecovery.ts) | Fault classification + recovery sequencer, built around the real System State enum (Fault `0x08` → Fault recovery `0x09`) and the real fault-reset (501) / breaker (502) registers | — |
| [`src/telemetry/espire314ReportingModels.ts`](src/telemetry/espire314ReportingModels.ts) | Info/monitoring/fault/config model-ID buckets, mirroring `reportingStrategy.ts`'s `FAULT_MODELS` pattern (e.g. Mini's `"50103"`) | Still `TODO` — internal Keystone EMS naming decision, not in the vendor PDF |

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

## Not yet true — known gaps before this is wire-ready

1. **Discrete-input support doesn't exist yet in `keystone-controller-logic`** (see
   above) — the 80 system alarm points are structurally valid but not pollable until
   that core-library change lands there.
2. **Spot-check the HIGH-confidence registers** (500, 501, 502, 43, 46, 47) against the
   source PDF pages cited in the doc before any live write — extraction was clean for
   these, but a five-minute manual check on a breaker-control register is cheap
   insurance.
3. **Resolve the LOW-confidence holding-register block** (503, 525-527, the RTC/heartbeat
   registers 528-530) by reading PDF pages A336-A337 directly.
4. **Decide and fill in eSpire 314's ss-model numbers** in `espire314ReportingModels.ts`
   and the template's `ss40k.model: "TODO"` fields.
5. **Expand the per-string/per-cell formulas** into concrete point templates once a
   specific project needs that resolution.
6. If eSpire 314 needs to plug into cmsandbox's ingestion side
   (`equipment_points_matcher`, `ss50k_minispecific.yaml`-style bit meanings, portal
   fault charts), that's a separate change in the `cmsandbox` repo — see how Mini's
   model `50103` is wired there for the pattern to follow.

## Dev
```
npm install
npm test
npm run build
```
