import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { Buffer } from "buffer";
import { registerRootComponent } from "expo";

import App from "./App";
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
