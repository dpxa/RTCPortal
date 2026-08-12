const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const REGRESSION_DIR = path.join(__dirname, "regression");

function discoverTests() {
  return fs
    .readdirSync(REGRESSION_DIR)
    .filter((f) => f.endsWith(".test.js") || f.endsWith(".test.mjs"))
    .sort();
}

function runTestFile(file, coverage) {
  return new Promise((resolve) => {
    console.log("\n" + "=".repeat(70));
    console.log(`▶ Running: ${file}`);
    console.log("=".repeat(70));

    const args = ["--test"];
    if (coverage) args.push("--experimental-test-coverage");
    args.push(path.join(REGRESSION_DIR, file));

    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      console.error(`  [${file}] failed to start: ${err.message}`);
      resolve({ file, passed: false });
    });
    child.on("exit", (code) => {
      const passed = code === 0;
      console.log(passed ? `  ✔ ${file} PASSED` : `  ✘ ${file} FAILED`);
      resolve({ file, passed });
    });
  });
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const onlyName = onlyArg ? onlyArg.split("=")[1] : null;
  const coverage = process.argv.includes("--coverage");

  let files = discoverTests();
  if (onlyName) {
    files = files.filter((f) => f.includes(onlyName));
    if (files.length === 0) {
      console.error(`No test file matches: ${onlyName}`);
      process.exit(1);
    }
  }

  console.log(`Discovered ${files.length} regression test file(s):`);
  for (const f of files) console.log(`  - ${f}`);

  const results = [];
  for (const file of files) {
    results.push(await runTestFile(file, coverage));
  }

  console.log("\n" + "=".repeat(70));
  console.log("REGRESSION SUITE SUMMARY");
  console.log("=".repeat(70));
  let allPassed = true;
  for (const r of results) {
    console.log(`  [${r.passed ? "PASS" : "FAIL"}] ${r.file}`);
    if (!r.passed) allPassed = false;
  }
  console.log("=".repeat(70));
  console.log(
    allPassed ? "All regression tests passed." : "Some tests failed.",
  );
  process.exit(allPassed ? 0 : 1);
}

main();
