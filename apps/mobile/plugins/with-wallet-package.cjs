/* global module, require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// MWA 3.0.2 exposes baseUri, but its Android bridge launches an unscoped intent.
// Preserve the SDK's transport and protocol. Change only how the intent resolves
// and remove request parameters from native logs (they contain auth tokens).
module.exports = function withWalletPackage(config) {
  return withDangerousMod(config, [
    "android",
    ({ modRequest, ...config }) => {
      const entry = require.resolve(
        "@solana-mobile/mobile-wallet-adapter-protocol",
        {
          paths: [modRequest.projectRoot],
        },
      );
      const root = path.resolve(path.dirname(entry), "../..");
      const version = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
      ).version;
      if (version !== "3.0.2")
        throw new Error(
          "Review the AGUS MWA Android patch for the new SDK version.",
        );
      const file = path.join(
        root,
        "android/src/main/java/com/solanamobile/mobilewalletadapter/reactnative/SolanaMobileWalletAdapterModule.kt",
      );
      let source = fs.readFileSync(file, "utf8");
      if (source.includes("// AGUS: package-scoped MWA"))
        return { ...config, modRequest };
      const replacements = [
        [
          "private const val ASSOCIATION_TIMEOUT_MS = 10000",
          "private const val ASSOCIATION_TIMEOUT_MS = 45000",
        ],
        [
          "    // Used to ensure that you can't start more than one session at a time.",
          "    private class WalletActivityUnavailable : IllegalStateException()\n\n    // Used to ensure that you can't start more than one session at a time.",
        ],
        [
          'Log.d(TAG, "startSession with config $config")',
          'Log.d(TAG, "Wallet association started")',
        ],
        [
          `                reactApplicationContext.currentActivity?.apply {
                    startActivityForResult(intent, REQUEST_LOCAL_ASSOCIATION)
                } ?: throw NullPointerException(
                    "Could not find a current activity from which to launch a local association"
                )`,
          `                withContext(Dispatchers.Main.immediate) {
                    val activity = reactApplicationContext.currentActivity
                        ?: throw WalletActivityUnavailable()
                    activity.startActivityForResult(intent, REQUEST_LOCAL_ASSOCIATION)
                }`,
        ],
        [
          "            } catch (e: ActivityNotFoundException) {",
          `            } catch (e: WalletActivityUnavailable) {
                finishHeadlessTask(sessionTaskId)
                cleanup()
                promise.reject("ERROR_WALLET_ACTIVITY_UNAVAILABLE", e)
            } catch (e: ActivityNotFoundException) {`,
        ],
        [
          '"Session not established: Local association cancelled by user",',
          '"ERROR_ASSOCIATION_CANCELLED",',
        ],
        [
          'promise.reject("Timed out waiting for local association to be ready", e)',
          'promise.reject("ERROR_ASSOCIATION_TIMEOUT", e)',
        ],
        [
          'val uriPrefix = config?.getString("baseUri")?.let { Uri.parse(it) }',
          `// AGUS: package-scoped MWA. An unpatched client rejects this non-HTTPS URI.
                val route = config?.getString("baseUri")?.let { Uri.parse(it) }
                val walletPackage = if (route?.scheme == "agus-mwa-package") {
                    requireNotNull(route.schemeSpecificPart).also {
                        require(it.matches(Regex("[a-z][a-z0-9_]*(\\\\.[a-z][a-z0-9_]*)+")))
                    }
                } else null
                val uriPrefix = if (walletPackage == null) route else null`,
        ],
        [
          "                withContext(Dispatchers.Main) {",
          "                if (walletPackage != null) intent.setPackage(walletPackage)\n                withContext(Dispatchers.Main) {",
        ],
        [
          'Log.d(TAG, "invoke `$method` with params $params")',
          'Log.d(TAG, "invoke wallet method")',
        ],
        [
          'Log.e(TAG, "Failed to invoke `$method` with params $params", e)',
          'Log.e(TAG, "Wallet method failed")',
        ],
      ];
      for (const [before, after] of replacements) {
        if (source.split(before).length !== 2)
          throw new Error("AGUS MWA Android patch anchor changed.");
        source = source.replace(before, () => after);
      }
      fs.writeFileSync(file, source);
      return { ...config, modRequest };
    },
  ]);
};
