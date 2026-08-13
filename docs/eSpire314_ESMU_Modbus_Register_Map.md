# eSpire 314 — ESMU Modbus TCP Register Map (extracted from vendor PDF)

Source: [`docs/vendor/高特ESMU_MODBUS通信协议(TCP分卷_中英双语20230630)_V2.1_EN.pdf`](vendor/高特ESMU_MODBUS通信协议(TCP分卷_中英双语20230630)_V2.1_EN.pdf)
(doc code `GE-Q730-1-141-A`, No.1-181207-3H-01, V2.1, 2023-06-30).

**Naming note:** the document identifies the device as **ESMU** (Energy Storage
Management Unit — a battery *stack* management unit, i.e. a BMS controller) from a
Chinese OEM, communicating with an **ESBCM** (battery *string* management unit) per
battery string. This is being treated as the eSpire 314 register map per the request
that produced it — flag if that identification is wrong, since nothing in the PDF
itself says "eSpire" or "314".

**Extraction quality:** pulled via `pdftotext -layout` from a bilingual (Chinese/English)
table-heavy PDF. Table rows where a label wraps 2–3 lines but its address/type/scale sits
on one line are prone to a one-row visual shift during text extraction. Confidence is
flagged per section below — anything marked **MEDIUM** or lower should be checked against
the source PDF pages (cited) before being trusted for a live write.

## 1. Transport & addressing

- Modbus **TCP**, ESMU is the **server**, default port **502**. Background
  monitoring/EMS is the client (port >1024) and is the only side that initiates queries.
- Idle timeout: if ESMU receives no command from the client within **30s**, it disconnects.
- **Unit identifier (device addressing) — HIGH confidence, stated explicitly (§3.4.2):**
  - `1` = the ESMU object itself (acts as a Modbus gateway/forwarder).
  - `N + 1` = the ESBCM object for battery string `N` (string 1 → unit id `2`, string 2 →
    unit id `3`, ... string 20 → unit id `21`).

## 2. Function codes (HIGH confidence — standard Modbus, explicitly documented)

| Code | Meaning | Notes |
|---|---|---|
| `02H` | Read discrete input registers | Max 2000 per request. Bit-packed response (LSB-first per byte, low address first). |
| `03H` | Read holding registers | Max 120 registers per request. |
| `04H` | Read input registers | Max 120 registers per request. |
| `06H` | Write single holding register | |
| `10H` | Write multiple holding registers (block) | |
| `41H` | Timing/broadcast write | Vendor-specific extension, §4.3.1 — not detailed further here. |

Standard Modbus exception-response mechanism applies (§4.4) — not itemized here since
it's the standard illegal-function/illegal-address/illegal-value/device-failure set.

## 3. Data types & byte order (HIGH confidence, explicit in §3.1/§3.3)

- `BYTE` 0–255, `UINT` 0–65535, `INT` −32768–32767, `UDINT`/`DINT`/`FLOAT` 32-bit
  (two consecutive registers), `String` (16 or 32 bytes), `BOOL` (discrete inputs only).
- 16-bit values: high byte first.
- 32-bit values: **high 16-bit word at the lower register address**, low word at the
  higher address (e.g. `0x8DF377A2` stored at regs 12–13 → reg 12 = `0x8DF3`, reg 13 = `0x77A2`).
- Discrete inputs are bit-packed into bytes, **low address = LSB, transmitted first**.

## 4. Discrete input registers (function `02H`) — alarm/status bits

### 4.1 System-level alarms, addresses 1–80 — MEDIUM confidence (PDF pp. A325–A331)

Sequential, monotonically increasing 1→80 in the source with no reordering — the
overall order is trustworthy; individual label↔number pairing has ±1-row extraction
jitter in a few spots, so treat exact bit numbers as a strong draft, not gospel.

| Addr | Alarm |
|---|---|
| 1–3 | Total voltage undervoltage: slight / medium / serious |
| 4–6 | Total voltage overvoltage: slight / medium / serious |
| 7–9 | Overcurrent: slight / medium / serious |
| 10–12 | Low insulation resistance: slight / medium / serious |
| 13–15 | Module low temperature: slight / medium / serious |
| 16–18 | Module over temperature: slight / medium / serious |
| 19–21 | Cell overvoltage: slight / medium / serious |
| 22–24 | Cell undervoltage: slight / medium / serious |
| 25–27 | Cell voltage differential: slight / medium / serious |
| 28–30 | Cell low temperature: slight / medium / serious |
| 31–33 | Cell over temperature: slight / medium / serious |
| 34–36 | Cell temperature differential: slight / medium / serious |
| 37–39 | Cell SOC low: slight / medium / serious |
| 40–42 | Cell SOC high: slight / medium / serious |
| 43–45 | Cell SOH low: slight / medium / serious |
| 46–48 | Cell SOH high: slight / medium / serious |
| 49 | ESBCM lost communication |
| 50 | ESBMM lost communication |
| 51 | Abnormal voltage between strings (diff > 20V) |
| 52 | **Abnormal disconnection of contactor** |
| 53 | **Abnormal closing of contactor** |
| 54 | **Charging prohibited** |
| 55 | **Discharging prohibited** |
| 56 | **BMS system alarm summary** |
| 57 | **BMS system fault summary** |
| 58–61 | Digital input IN0–IN3 (project-specific: air conditioning / e-stop / other hardware) |
| 62–69 | Reserved |
| 70–72 | Terminal over temperature: slight / medium / serious |
| 73–75 | Pack voltage overvoltage: slight / medium / serious |
| 76–78 | Pack voltage undervoltage: slight / medium / serious |
| 79 | Cell voltage acquisition fault |
| 80 | Cell temperature acquisition fault |

### 4.2 Per-string alarms — LOW-MEDIUM confidence (PDF pp. A331–A335)

Base address for string `N` = **`100 × (N + 1)`** (string 1 → 200, string 2 → 300, ...
string 20 → 2100), block length **88 registers**. This block-start formula is
HIGH confidence — it's corroborated by two independent tables in the source (the
block-length table and the explicit "String N ... 200" opening entry lining up).

Within each string's 88-register block, the *order* of alarms closely mirrors the
system-level list above (per-string total-voltage/overcurrent/cell-level slight-medium-
serious triads), followed by per-ESBMM lost-communication bits (one register per ESBMM
module, up to 40: offsets ~37–76 of the block), then terminal-temperature and
pack-voltage alarms, ending with cell voltage/temperature acquisition faults. The exact
offset-to-label pairing inside the block has visible extraction jitter — **do not wire
a specific in-block offset into control logic without checking the source PDF pages
first.**

## 5. Holding registers (function `03H` read / `06H`, `10H` write) — control/config

PDF pp. A335–A338.

| Addr | Field | Confidence | Notes |
|---|---|---|---|
| 500 | String number selector | **HIGH** | `UINT`, 1–20. Selects which string subsequent per-string commands target. |
| 501 | System fault reset | **HIGH** | `UINT`, `0` = do not reset, `1` = reset, other = invalid. |
| 502 | **Main circuit breaker (contactor) control** | **HIGH** | `UINT`, `0` = no operation, `1` = close, `2` = open, other = invalid. |
| 503 | System power up/down control command | LOW | Garbled in extraction — verify against PDF before use. |
| 504–523 | System power up/down control command (one register per string?) | LOW | Range shown as 504~523 (20 registers, matches 20 strings) but the exact per-register semantics are unclear from extraction. |
| 524 | String N maintenance mode control | MEDIUM | `UINT`, `0` = no operation, `1` = power on, `2` = power off. Targets the string selected via reg 500. Registers 525–527 also appear adjacent to this field in the source and may be padding/reserved rather than distinct fields — verify. |
| 528–530 | RTC (year/month/day/hour/minute/second) + heartbeat | **LOW — genuinely garbled** | Year is offset+2000, month 1–12, day 1–31, hour 0–23, minute/second 0–59. Exact register-to-field split across 528–530 did not extract cleanly; a heartbeat register (range 0–65535) is also mentioned in this vicinity. **Needs a direct look at PDF p. A336–A337.** |
| 1000–2000 | "Project peripheral information" | N/A | Explicitly reserved/custom per-project — not a fixed map. |

**The three registers safe to build controller set-points against right now are 500
(string select), 501 (fault reset), and 502 (breaker open/close)** — these had clean,
unambiguous text in the source. Everything else in this table should be spot-checked
before being wired into a write path.

## 6. Input registers (function `04H`) — telemetry

PDF pp. A337–A349.

### 6.1 Block layout — HIGH confidence (explicit, clean table)

| Block | Start | Length |
|---|---|---|
| System data | 1 | 47 |
| String `N` data | `100 + 3000 × (N − 1)` | 2991 |

String 1 → 100, string 2 → 3100, string 3 → 6100, ... string 20 → 57100.

### 6.2 System data fields (addr 1–~50) — MEDIUM confidence

Order is reliable; exact address-per-field has the same row-shift risk noted above.

| Addr | Field | Scale/notes |
|---|---|---|
| 1 | System circuit breaker status | 1 = closed, 0 = open |
| 2 | System total voltage | 0.1 V/bit |
| 3 | System current | 0.1 A/bit, offset −1600.0A |
| 4 | System SOC | 1%/bit |
| 5 | System SOH | 1%/bit |
| 6–8 | Max battery voltage, its string #, its point # | 0.001V/bit |
| 9–11 | Min battery voltage, its string #, its point # | 0.001V/bit |
| 12–14 | Max battery temperature, its string #, its point # | 1/bit, offset −40 |
| 15–17 | Min battery temperature, its string #, its point # | 1/bit, offset −40 |
| 18–19, 20–21 | Accumulated charge / discharge capacity | `UINT32`, 0.1kWh/bit |
| 22–23, 24–25 | Accumulated charge / discharge for a single cycle | `UINT32`, 0.1kWh/bit |
| ~30–31 | Available discharge / charge time | min/bit |
| ~32–33 | Rechargeable / dischargeable capacity | 0.1kW/bit |
| ~34–35 | Allowable max charge / discharge power | 0.1kW/bit |
| ~36–37 | Allowable max charge / discharge current | 0.1A/bit, offset −1600.0A |
| ~38–41 | Daily discharge/charge times & quantities | mixed `UINT`/`UINT32` |
| 42 | Operating temperature | 1/bit, offset −40 |
| **43** | **BMS / System State** | **HIGH confidence — clean enum, see §6.3** |
| 44 | Charge/discharge state | `0x00` other, `0x01` discharge, `0x02` charge |
| 45 | Insulation resistance | 1KΩ/bit |
| 46 | **PCS↔BMS communication failure** | `0x01` = comm loss, `0x00` = normal |
| 47 | **EMS↔BMS communication failure** | `0x01` = comm loss, `0x00` = normal |
| 48–49, 50–51 | Pile cumulative charging / discharging time | `UINT32`, seconds |

### 6.3 System State enum (input register 43) — HIGH confidence, explicit

| Value | State |
|---|---|
| `0x00` | Initial state (relay not closed, self-test) |
| `0x01` | Charging |
| `0x02` | Discharging |
| `0x03` | Ready (relay closed, no charge/discharge) |
| `0x04` | Cluster maintenance |
| `0x05` | Charge prohibited |
| `0x06` | Discharge prohibited |
| `0x07` | Charging and discharging prohibited |
| `0x08` | **Fault** — serious fault, high-voltage alarm |
| `0x09` | **Fault recovery** — after the alarm clears, serious faults are cleared |
| `0x0A` | Test mode (forced DO control — bypasses normal battery protection) |
| `0x0B` | Power-off (in progress) |
| `0x0C` | Power-off complete |
| other | reserved |

This is the key insight for controller logic: **the device already tracks its own
fault/recovery lifecycle** (`0x08` → `0x09` → normal) — the controller mostly needs to
watch this register and pulse the fault-reset holding register (501), rather than
choreograph a multi-step clear/start sequence the way `keystone-controller-logic`'s
Mini PCS fault recovery does.

### 6.4 Per-string data block (base per §6.1, 2991 registers) — MEDIUM/LOW confidence

Order reliable, offsets approximate (row-shift risk), relative to string base:

| Rel. offset | Field | Scale |
|---|---|---|
| 100 | String state | same enum as §6.3 |
| 101–106 | Max/min allowable charge/discharge power, voltage, current | 0.1kW / 0.1V / 0.1A |
| 107–114 | Digital inputs DI1–DI8 | 1 = input, 0 = no input |
| 115–120 | Total voltage, current, ESBCM module temp, SOC, SOH, insulation resistance | mixed |
| 121–139 | Avg/max/min cell voltage, temp, SOC, SOH + which cell # each extreme is at | mixed |
| 139–150 | Accumulated charge/discharge capacity (this string) | `UINT32`, 0.1kWh/bit |
| 151–190 | Per-pack SOC array (up to 40 packs) | 1%/bit |
| 890–1590 | Per-cell voltage array (up to 700 cells) | 0.001V/bit |
| 1591–2290 | Per-cell temperature array (up to 700 cells) | 1/bit, offset −40 |
| 2291–2990 | Per-cell SOC array (up to 700 cells) | 1%/bit |
| (tail) | Per-cell SOH array, per-terminal temperature array (up to 100 terminals) | 1%/bit, 1/bit offset −40 |

Given the size (700 cells × 20 strings), these are represented here as **array
formulas**, not enumerated as individual JSON points — see
`src/templates/eSpire314_ESMU_PerStringTelemetry_IR.json` for the block-level
definition and the formula to expand it per string/cell.

## 7. What's implemented in this repo vs. still open

Templates now follow `keystone-controller-logic`'s actual schema
(`{version, device, telemetry[], commands[]}`, per `src/telemetry/templateAdapter.ts`),
verified against a ported copy of its structural validator in
`src/__tests__/templateConformance.spec.ts` — not the ad hoc shape this repo started
with.

| Area | File | Status |
|---|---|---|
| System discrete-input alarms (§4.1, 80 points) | `src/templates/eSpire314_ESMU_ss_TEMPLATE.json` (`telemetry[]`, `function: "DI"`) | Filled in, MEDIUM confidence for addresses. **Not actually pollable yet** — see §8, `keystone-controller-logic` has no discrete-input (`02H`) `ModbusNumericType`. |
| Control registers 500–502 (§5) | same file, `commands[]` | Filled in, HIGH confidence for 500/501/502; 503–530 left `TODO` |
| System telemetry (§6.2, incl. System State enum) | same file, `telemetry[]` | Filled in, MEDIUM confidence (HIGH for System State/comm faults) |
| Per-string alarms (§4.2) / per-string+per-cell telemetry (§6.4) | not yet templated as individual points | Documented as formulas above; expand once the block-offset ambiguity is resolved |
| Fault classification + recovery | `src/coreControl/espire314FaultRecovery.ts` | Rewritten around the real System State enum (§6.3) and control registers 501/502 |
| ss-model numbers for `keystone-controller-logic`-style telemetry export | `src/telemetry/espire314ReportingModels.ts` + each point's `ss40k.model: "TODO"` | Still `TODO` — this is an internal Keystone EMS naming decision, not something in the vendor PDF |

## 8. Gap found by comparing against `keystone-controller-logic`'s other product templates

`keystone-controller-logic/src/types.ts` defines `ModbusNumericType` as only
`HR*`/`IR*`/`C` (holding registers, input registers, coils) — **no discrete-input
(`02H`) member**, and `reader.ts` has no `02H` request path. Every other product
template in that repo represents its alarm bits by packing them into an `HR`/`IR`
word with `bitfieldStatus`, because none of those devices expose alarms as literal
Modbus discrete-input registers the way ESMU does. This repo's 80 system-alarm points
use `"function": "DI"` as an explicit intent marker (each carries a `notes` field
saying so) — they're structurally valid but need a `keystone-controller-logic` core
change (new `ModbusNumericType` member + `reader.ts` wiring) before they can actually
be read.

**Before any of registers 500–502 are used to actually open/close a contactor or reset
faults on real hardware, do a side-by-side check against the source PDF pages cited
above** — this map was reconstructed from an automated text extraction of a bilingual
table-heavy PDF, and while the three control registers had clean, unambiguous source
text, an extraction error on a breaker-control register is the kind of mistake worth
a five-minute manual check to rule out.
