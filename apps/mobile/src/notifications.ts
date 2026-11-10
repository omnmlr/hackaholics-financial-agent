import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiRequest } from "./session";
export async function registerNotifications() {
  let id = await SecureStore.getItemAsync("agus_device_id");
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync("agus_device_id", id);
  }
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("updates", {
      name: "AGUS updates",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    return apiRequest("devices", {
      id,
      platform: Platform.OS === "ios" ? "ios" : "android",
      pushState: "denied",
      preferences: { inApp: true, push: false },
    });
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId)
    return apiRequest("devices", {
      id,
      platform: Platform.OS === "ios" ? "ios" : "android",
      pushState: "unavailable",
      preferences: { inApp: true, push: false },
    });
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId }))
      .data;
    return apiRequest("devices", {
      id,
      platform: Platform.OS === "ios" ? "ios" : "android",
      pushState: "registered",
      pushToken: token,
      preferences: { inApp: true, push: true },
    });
  } catch {
    return apiRequest("devices", {
      id,
      platform: Platform.OS === "ios" ? "ios" : "android",
      pushState: "invalid",
      preferences: { inApp: true, push: false },
    });
  }
}
