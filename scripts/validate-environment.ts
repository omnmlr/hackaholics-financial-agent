import { validateEnvironment } from "../src/lib/environment";
try {
  console.log(JSON.stringify(validateEnvironment()));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid environment");
  process.exitCode = 1;
}
