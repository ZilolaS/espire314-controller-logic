// Validates src/templates/*.json against the same structural rules
// keystone-controller-logic's src/telemetry/templateAdapter.ts enforces
// (validateTelemetryTemplate / validateTemplateEntry), ported here rather
// than imported so this repo doesn't need a cross-repo dependency on a
// sibling checkout. If keystone-controller-logic's schema changes, re-sync
// this file against it.

import * as fs from "fs";
import * as path from "path";

// Mirrors keystone-controller-logic/src/types.ts ModbusNumericType.
const MODBUS_NUMERIC_TYPES = new Set([
  "HR", "HRUS", "HRI", "HRUI", "HRI_64", "HRUI_64", "HRF",
  "IR", "IRUS", "IRI", "IRUI", "IRI_64", "IRUI_64", "IRF",
  "C",
]);
// Function codes used in this repo's templates that are NOT yet part of
// keystone-controller-logic's ModbusNumericType (see docs/eSpire314_ESMU_Modbus_Register_Map.md
// and the device.notes field in the template itself). Tracked explicitly so this
// test documents the gap instead of silently accepting an unrecognized code.
const KNOWN_UNSUPPORTED_FUNCTION_CODES = new Set(["DI"]);

interface TemplateEntry {
  id: string;
  function?: string | null;
  address?: number | null;
  constant?: unknown;
  calc?: { expr: string };
  ss40k?: { name: string; model: string | number };
}

interface TemplateDocument {
  version: string;
  device: {
    vendor: string;
    model: string;
    protocol: string;
    defaultByteOrder?: string;
    defaultWordOrder32?: string;
  };
  telemetry: TemplateEntry[];
  commands?: TemplateEntry[];
}

function validateEntry(fileName: string, section: string, index: number, entry: TemplateEntry) {
  expect(entry && typeof entry === "object").toBe(true);
  expect(typeof entry.id).toBe("string");
  expect(entry.id.trim().length).toBeGreaterThan(0);

  const hasConstant = Object.prototype.hasOwnProperty.call(entry, "constant");
  const hasCalc = !!entry.calc;
  const hasFunction = typeof entry.function === "string" && !!entry.function.trim();
  const hasAddress = typeof entry.address === "number" && Number.isFinite(entry.address);
  const hasPhysical = hasFunction && hasAddress;
  const isVirtualPlaceholder =
    entry.function == null && entry.address == null && !hasConstant && !hasCalc;

  const sourceCount =
    Number(hasConstant) + Number(hasCalc) + Number(hasPhysical) + Number(isVirtualPlaceholder);

  expect(sourceCount).toBeGreaterThanOrEqual(1);

  if (hasFunction) {
    const fn = (entry.function as string).trim();
    const recognized = MODBUS_NUMERIC_TYPES.has(fn) || KNOWN_UNSUPPORTED_FUNCTION_CODES.has(fn);
    if (!recognized) {
      throw new Error(
        `${fileName} ${section}[${index}] "${entry.id}" uses function code "${fn}", which is ` +
          `neither a recognized keystone-controller-logic ModbusNumericType nor listed in ` +
          `KNOWN_UNSUPPORTED_FUNCTION_CODES here — likely a naming typo.`
      );
    }
  }
}

const templatesDir = path.join(__dirname, "..", "templates");
const templateFiles = fs
  .readdirSync(templatesDir)
  .filter((f) => f.endsWith(".json"));

describe("template conformance (mirrors keystone-controller-logic's template schema)", () => {
  test("at least one template exists", () => {
    expect(templateFiles.length).toBeGreaterThan(0);
  });

  for (const fileName of templateFiles) {
    describe(fileName, () => {
      const doc: TemplateDocument = JSON.parse(
        fs.readFileSync(path.join(templatesDir, fileName), "utf8")
      );

      test("has version and device metadata", () => {
        expect(typeof doc.version).toBe("string");
        expect(doc.device).toBeTruthy();
        expect(typeof doc.device.vendor).toBe("string");
        expect(typeof doc.device.model).toBe("string");
        expect(doc.device.protocol).toBe("modbus-tcp");
      });

      test("has a telemetry array", () => {
        expect(Array.isArray(doc.telemetry)).toBe(true);
        expect(doc.telemetry.length).toBeGreaterThan(0);
      });

      test("every telemetry entry is structurally valid", () => {
        doc.telemetry.forEach((entry, i) => validateEntry(fileName, "telemetry", i, entry));
      });

      test("every command entry is structurally valid (if commands[] present)", () => {
        if (doc.commands === undefined) return;
        expect(Array.isArray(doc.commands)).toBe(true);
        doc.commands.forEach((entry, i) => validateEntry(fileName, "commands", i, entry));
      });

      test("no duplicate ids within telemetry, and none collide with commands", () => {
        const allIds = [...doc.telemetry, ...(doc.commands || [])].map((e) => e.id);
        const seen = new Set<string>();
        const duplicates = allIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
        expect(duplicates).toEqual([]);
      });
    });
  }
});
