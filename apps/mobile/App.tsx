import CryptoDeviceHarness from "./CryptoDeviceHarness";
import DeveloperHarness from "./DeveloperHarness";

export default process.env.EXPO_PUBLIC_AGUS_CRYPTO_DEVICE_TEST === "true"
  ? CryptoDeviceHarness
  : DeveloperHarness;
