// src/writer/writer.ts
//
// Minimal writer-side types, mirrored from keystone-controller-logic's
// src/writer/writer.ts so coreControl modules here have the same
// ControlEnvelope/ControlCommand shape the Keystone EMS writer expects.
// Expand with real frame-building logic (buildModbusWriteFrames, etc.)
// once eSpire 314 write points are confirmed.

export interface ControlCommand {
  tagID: string;
  value: number | boolean;
}

export interface ControlEnvelope {
  topic: string; // metadata only: 'PCS', 'BMS', 'PV', 'GEN', etc.
  payload: ControlCommand[];
}
