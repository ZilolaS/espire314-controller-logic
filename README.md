# espire314-controller-logic

Typed helper library for the eSpire 314 PCS controller (Keystone EMS / Node-RED).
Structure mirrors [`keystone-controller-logic`](../keystone-controller-logic), which is
the reference implementation for how a device family (Mini, Nano, Envy, Delta, ...)
gets its Modbus points, fault classification, auto-recovery sequencer, and telemetry
reporting wired up in this ecosystem.

## Status: scaffold, awaiting the register map

This repo was created ahead of the actual eSpire 314 Modbus register map. The map
currently only exists as a video walkthrough
(SharePoint: `TestingDepartment`); it needs to be exported as a document
(Excel/CSV/PDF register table) before the real points can be filled in.

Everything below is a placeholder to be replaced once that document is available:

| File | What it's standing in for |
|---|---|
| [`src/templates/eSpire314_PCS_ss_TEMPLATE.json`](src/templates/eSpire314_PCS_ss_TEMPLATE.json) | The Modbus point map — mirrors `Sinexcel_Mini_PCS_ss40k.json`'s per-point schema (`id`, `function`, `address`, `ss40k` block). Rename once a real ss-model number is assigned. |
| [`src/coreControl/espire314FaultRecovery.ts`](src/coreControl/espire314FaultRecovery.ts) | Fault classification + auto-recovery state machine — mirrors `miniFaultRecovery.ts`'s state machine shape (safe-zero → clear-fault → start → verify → lockout), stripped of Mini-specific topology (PVDC combiner steps, HV/LV BMS split) until eSpire 314's real fault sources and write-point tagIDs are known. |
| [`src/telemetry/espire314ReportingModels.ts`](src/telemetry/espire314ReportingModels.ts) | Info/monitoring/fault/config model-ID buckets — mirrors `reportingStrategy.ts`'s `FAULT_MODELS` (event-driven reporting on change, e.g. Mini's `"50103"`) vs. periodic models. Empty until eSpire 314's model numbers are assigned. |

### Next steps once the register map document lands
1. Fill in `eSpire314_PCS_ss_TEMPLATE.json` with real registers (address, function code,
   scaling, alarm/bitfield flags) and rename it to match the assigned ss-model number.
2. Replace the `TODO` tagIDs and fault channels in `espire314FaultRecovery.ts` with the
   real clear-fault / start / setpoint registers and fault words.
3. Assign eSpire 314's model-ID buckets in `espire314ReportingModels.ts`.
4. If eSpire 314 needs to plug into cmsandbox's ingestion side (equipment-points-matcher,
   `ss50k_minispecific.yaml`-style bit meanings, portal fault charts), that's a separate
   change in the `cmsandbox` repo — see how Mini's model `50103` is wired there for the
   pattern to follow.

## Dev
```
npm install
npm test
npm run build
```
