import type { CapacitorConfig } from "@capacitor/cli";

// ViewSwitcher: the Daisy switcher on the iPad. The bundled www/ is only a connector page;
// the real UI is served by the Mac, over USB-C (127.0.0.1:7420 via the app's tunnel) or the network.
const config: CapacitorConfig = {
  appId: "com.twowitstudios.viewswitcher",
  appName: "ViewSwitcher",
  webDir: "www",
  appendUserAgent: "ViewSwitcher",
  backgroundColor: "#0a120d",
  server: {
    allowNavigation: ["127.0.0.1", "*.ts.net", "*.local"],
  },
  ios: {
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
