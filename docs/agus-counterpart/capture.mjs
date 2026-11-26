/* global console, document, innerWidth */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
const output = fileURLToPath(new URL("./previews/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const [device, viewport] of [
    ["desktop", { width: 1440, height: 1040 }],
    ["mobile", { width: 390, height: 900 }],
  ]) {
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const screen of [
      "home",
      "conversation",
      "accounts",
      "obligations",
      "activity",
      "review",
    ]) {
      await page.goto(`http://127.0.0.1:4190/?screen=${screen}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${output}${device}-${screen}.png`,
        fullPage: false,
      });
      if (device === "mobile")
        await page.screenshot({
          path: `${output}${device}-${screen}-full.png`,
          fullPage: true,
        });
      results.push({
        device,
        screen,
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        errors: [...errors],
      });
    }
    if (device === "mobile") {
      await page
        .getByRole("button", { name: "Continue to authorization" })
        .click();
      await page.screenshot({ path: `${output}mobile-authorization.png` });
    }
    await page.close();
  }
  for (const [screen] of [
    ["home"],
    ["conversation"],
    ["accounts"],
    ["obligations"],
    ["activity"],
    ["review"],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      reducedMotion: "reduce",
    });
    await page.goto(`http://127.0.0.1:4190/board.html?screen=${screen}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({ path: `${output}board-${screen}.png` });
    await page.close();
  }
  for (const type of ["desktop", "mobile"]) {
    const page = await browser.newPage({
      viewport: { width: 1800, height: 1200 },
      reducedMotion: "reduce",
    });
    await page.goto(`http://127.0.0.1:4190/board.html?type=${type}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.screenshot({
      path: `${output}${type}-overview.png`,
      fullPage: true,
    });
    await page.close();
  }
  const pdf = await browser.newPage({
    viewport: { width: 1600, height: 1100 },
    reducedMotion: "reduce",
  });
  await pdf.goto("http://127.0.0.1:4190/board.html");
  await pdf.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await pdf.pdf({
    path: fileURLToPath(new URL("./AGUS-Counterpart.pdf", import.meta.url)),
    printBackground: true,
    preferCSSPageSize: true,
  });
  await pdf.close();
} finally {
  await browser.close();
}
await writeFile(
  `${output}capture-results.json`,
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
