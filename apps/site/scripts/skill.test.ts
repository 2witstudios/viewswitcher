import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SKILL_DIR, skillFiles, skillZip, verifySkillZip } from "./skill";
import { listZip, storedZip } from "@viewswitcher/packs";

describe("the scenes skill download", () => {
  test("is the library kit's skill folder, zipped the way Claude's skill upload expects", async () => {
    const files = await skillFiles(SKILL_DIR);
    expect(files.map((f) => f.name)).toContain("viewswitcher-scenes/SKILL.md");
    const zip = skillZip(files);
    expect(verifySkillZip(zip)).toEqual({ name: "viewswitcher-scenes", files: files.length });
    // One folder at the root, holding SKILL.md: nothing loose beside it.
    for (const e of listZip(zip)) expect(e.name.startsWith("viewswitcher-scenes/")).toBe(true);
    // The same bytes as the kit, so the download never drifts from what libraries get.
    const kit = await Bun.file(join(SKILL_DIR, "SKILL.md")).text();
    expect(new TextDecoder().decode(files.find((f) => f.name.endsWith("SKILL.md"))!.data)).toBe(kit);
  });

  test("a zip that wouldn't upload fails the build", () => {
    const skill = (name: string, description = "Make scenes.") => `---\nname: ${name}\ndescription: ${description}\n---\n# x\n`;
    expect(() => verifySkillZip(storedZip([{ name: "SKILL.md", data: skill("viewswitcher-scenes") }]))).toThrow(/folder/);
    expect(() => verifySkillZip(storedZip([{ name: "viewswitcher-scenes/README.md", data: "x" }]))).toThrow(/SKILL\.md/);
    expect(() => verifySkillZip(storedZip([{ name: "other/SKILL.md", data: skill("viewswitcher-scenes") }]))).toThrow(/match/);
    expect(() => verifySkillZip(storedZip([{ name: "a/SKILL.md", data: skill("a") }, { name: "b/x.md", data: "x" }]))).toThrow(/one folder/);
    expect(() => verifySkillZip(storedZip([{ name: "viewswitcher-scenes/SKILL.md", data: "# no frontmatter" }]))).toThrow(/frontmatter/);
    expect(() => verifySkillZip(storedZip([{ name: "viewswitcher-scenes/SKILL.md", data: skill("viewswitcher-scenes", "x".repeat(1025)) }]))).toThrow(/description/);
  });
});
