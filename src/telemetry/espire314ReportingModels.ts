// src/telemetry/espire314ReportingModels.ts
//
// SCAFFOLD. keystone-controller-logic assigns each device family its own
// SunSpec-style model number for ss40k-style telemetry export (e.g. Mini
// PCS fault/status words are reported under model "50103" — see
// keystone-controller-logic/src/telemetry/reportingStrategy.ts and
// .../src/templates/Sinexcel_Mini_PCS_ss40k.json).
//
// eSpire 314 needs the same treatment once we know:
//   1. What model number(s) the eSpire 314 register map should be reported
//      under (info/monitoring/fault/config split, same as 40100-series).
//   2. Which registers are fault/status words that should be event-driven
//      (FAULT_MODELS-style: report immediately on change) vs. periodic.
//
// Fill in ESPIRE314_FAULT_MODELS below once that's decided, then wire it
// into a reportingStrategy equivalent (copy the shape of
// keystone-controller-logic's filterSs40kPayloadsForReporting).

export const ESPIRE314_INFO_MODELS: ReadonlySet<string> = new Set([
  // TODO: e.g. "60100"
]);

export const ESPIRE314_MONITORING_MODELS: ReadonlySet<string> = new Set([
  // TODO: e.g. "60101", "60102"
]);

export const ESPIRE314_FAULT_MODELS: ReadonlySet<string> = new Set([
  // TODO: e.g. "60103" — model(s) carrying fault/status bitfield words,
  // reported immediately on change rather than on the periodic interval.
]);

export const ESPIRE314_CONFIG_MODELS: ReadonlySet<string> = new Set([
  // TODO: e.g. "60104"
]);
