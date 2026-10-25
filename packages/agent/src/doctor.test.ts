import { describe, expect, it } from "vitest";
import { collectDoctorReport, renderDoctorReport } from "./doctor";

const emptyEnv = {} as Record<string, string | undefined>;

describe("doctor report", () => {
  it("reports heuristic mode as a working state, not an error", async () => {
    const doctor = await collectDoctorReport({ env: emptyEnv, probeLocal: false });
    expect(doctor.report.resolvedMode).toBe("heuristic");
    expect(doctor.report.localAvailable).toBe(false);
    expect(doctor.report.capabilities).toHaveLength(5);
    expect(doctor.report.warnings.join(" ")).toContain("No AI provider configured");
  });

  it("renders an aligned table in English", async () => {
    const doctor = await collectDoctorReport({ env: emptyEnv, probeLocal: false });
    const output = renderDoctorReport(doctor, "en");
    expect(output).toContain("LedgerPilot capability report");
    expect(output).toMatch(/^Document extraction\s{2}heuristic/m);
    expect(output).toContain("Next steps");
  });

  it("renders the same report in Spanish", async () => {
    const doctor = await collectDoctorReport({ env: emptyEnv, probeLocal: false });
    const output = renderDoctorReport(doctor, "es");
    expect(output).toContain("Informe de capacidades de LedgerPilot");
    expect(output).toMatch(/^Extracción de documentos\s{2}heurístico/m);
    expect(output).toContain("Plantillas de respuesta respaldadas por datos");
    expect(output).toContain("No hay proveedor de IA configurado");
    expect(output).toContain("Siguientes pasos");
  });

  it("reports cloud keys when they exist", async () => {
    const doctor = await collectDoctorReport({
      env: { GEMINI_API_KEY: "abc", AI_MODE: "auto" },
      probeLocal: false,
    });
    expect(doctor.report.resolvedMode).toBe("cloud");
    expect(doctor.report.cloudKeysPresent).toContain("GEMINI_API_KEY");
    expect(renderDoctorReport(doctor, "en")).toContain("GEMINI_API_KEY");
  });
});
