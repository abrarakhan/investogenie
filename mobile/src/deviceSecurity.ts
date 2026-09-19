import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerDeviceNotifications(): Promise<string> {
  if (!Device.isDevice) return "Push alerts require a physical device.";
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("trade-alerts", {
      name: "Trade alerts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return "Push alerts are off. Enable notifications in device settings.";
  const projectId = Constants.easConfig?.projectId
    ?? (Constants.expoConfig?.extra?.eas?.projectId as string | undefined)
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) return "Push alerts will activate after the EAS project is linked.";
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushToken(token, Platform.OS === "ios" ? "ios" : "android");
  return "Push alerts active. Notifications contain no financial details.";
}

export async function unlockWithBiometrics(): Promise<boolean> {
  if (!await LocalAuthentication.hasHardwareAsync() || !await LocalAuthentication.isEnrolledAsync()) return true;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock InvestoGenie",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });
  return result.success;
}
