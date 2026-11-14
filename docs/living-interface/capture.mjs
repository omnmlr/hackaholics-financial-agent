/* global process, console, document, innerWidth */
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const out = fileURLToPath(new URL("./previews/", import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const direction of ["orbit", "margin"]) {
    for (const [device, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const page = await browser.newPage({
        viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const view of ["home", "assistant"]) {
        await page.goto(
          `http://127.0.0.1:4173/?direction=${direction}&view=${view}`,
        );
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${out}${direction}-${device}-${view}.png`,
          fullPage: device === "desktop",
        });
        if (device === "mobile" && view === "home")
          await page.screenshot({
            path: `${out}${direction}-${device}-${view}-full.png`,
            fullPage: true,
          });
        results.push({
          direction,
          device,
          view,
          overflow: await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          errors: [...errors],
        });
      }
      if (device === "desktop") {
        await page.getByRole("button", { name: "Companion states" }).click();
        await page.screenshot({
          path: `${out}${direction}-companion-states.png`,
          fullPage: true,
        });
      }
      await page.close();
    }
  }
  if (process.env.INSPECT_CURRENT_APP === "1") {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await page.goto("http://127.0.0.1:3108");
    await page.screenshot({ path: `${out}existing-login.png` });
    const password = await readFile("/tmp/agus-inspection-password", "utf8");
    await page.getByLabel("Operator password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .waitFor({ timeout: 60000 });
    await page.screenshot({ path: `${out}existing-assistant.png` });
    await page.getByRole("button", { name: "Supplier payments" }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}existing-payment-preparation.png` });
    const navigation = await page.locator("nav").innerText();
    results.push({
      existingApp: true,
      navigation,
      note: "Fixture-only local instance. No transfer prepared, authorized or submitted.",
    });
    await page.close();
  }
  for (const direction of ["orbit", "margin"]) {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      reducedMotion: "reduce",
    });
    await page.goto(`http://127.0.0.1:4173/board.html?direction=${direction}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({
      path: `${out}${direction}-board.png`,
      fullPage: true,
    });
    await page.close();
  }
} finally {
  await writeFile(
    `${out}capture-results.json`,
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
